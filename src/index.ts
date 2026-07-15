import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { loadConfig } from './config';
import { processPrompt, createRefinedPlan } from './ai';
import { formatPlan, BotPlan } from './plan';
import { executeActions } from './executor';
import { dispatchQueryTool } from './query';

const config = loadConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ──────────────────────────────────────────────────────────────────────────────
// In-memory store for pending (unconfirmed) plans
// ──────────────────────────────────────────────────────────────────────────────

interface PendingPlan {
  plan: BotPlan;
  userId: string;
  guildId: string;
  expiresAt: number;
  /** Original /admin prompt, kept so refinement has full context. */
  originalPrompt: string;
  /**
   * The interaction token from the original /admin deferReply.
   * Used to edit the plan preview message when the user refines it.
   * Discord interaction tokens are valid for 15 minutes.
   */
  interactionToken: string;
}

const pendingPlans = new Map<string, PendingPlan>();

// Purge expired plans every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingPlans) {
    if (entry.expiresAt < now) pendingPlans.delete(id);
  }
}, 5 * 60_000);

// ──────────────────────────────────────────────────────────────────────────────
// Slash command definitions
// ──────────────────────────────────────────────────────────────────────────────

const adminCommand = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Plan and execute Discord admin tasks from a natural language prompt')
  .addStringOption((opt) =>
    opt
      .setName('prompt')
      .setDescription('Describe what you want, e.g. "create a Moderator role and give it to @alice"')
      .setRequired(true),
  )
  .addBooleanOption((opt) =>
    opt
      .setName('execute')
      .setDescription('Execute immediately without showing a preview (default: false)')
      .setRequired(false),
  );

const listCommand = new SlashCommandBuilder()
  .setName('admin-list')
  .setDescription('List current channels and roles in this server');

const helpCommand = new SlashCommandBuilder()
  .setName('admin-help')
  .setDescription('Show usage guide and example prompts for the admin bot');

// ──────────────────────────────────────────────────────────────────────────────
// Command registration
// ──────────────────────────────────────────────────────────────────────────────

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const body = [adminCommand.toJSON(), listCommand.toJSON(), helpCommand.toJSON()];

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log('Registered guild commands.');
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log('Registered global commands (may take up to 1 hour to propagate).');
}

// ──────────────────────────────────────────────────────────────────────────────
// Access control
// ──────────────────────────────────────────────────────────────────────────────

function canUseBot(member: GuildMember): boolean {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (config.adminRoleIds.length === 0) return false;
  return config.adminRoleIds.some((id) => member.roles.cache.has(id));
}

// ──────────────────────────────────────────────────────────────────────────────
// Guild context helpers
// ──────────────────────────────────────────────────────────────────────────────

function guildChannelList(guild: Guild): string[] {
  return guild.channels.cache
    .filter((c) => c.type !== ChannelType.GuildCategory)
    .map((c) => c.name)
    .slice(0, 50);
}

function guildRoleList(guild: Guild): string[] {
  return guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => r.name)
    .slice(0, 50);
}

function guildMemberSample(guild: Guild): string[] {
  return guild.members.cache.map((m) => m.displayName).slice(0, 30);
}

// ──────────────────────────────────────────────────────────────────────────────
// UI helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildPlanButtons(planId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin:confirm:${planId}`)
      .setLabel('Execute')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`admin:refine:${planId}`)
      .setLabel('Refine')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️'),
    new ButtonBuilder()
      .setCustomId(`admin:cancel:${planId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌'),
  );
}

function planMessage(plan: BotPlan, refinedFrom?: string): string {
  return (
    formatPlan(plan, refinedFrom) +
    '\n\n> Click **Execute** to apply, **Refine** to adjust, or **Cancel** to discard.'
  );
}

/** Patch the original /admin reply via stored interaction token. */
async function updateOriginalPlanMessage(
  interactionToken: string,
  content: string,
  row?: ActionRowBuilder<ButtonBuilder>,
): Promise<void> {
  await client.rest.patch(Routes.webhookMessage(config.clientId, interactionToken), {
    body: {
      content,
      components: row ? [row.toJSON()] : [],
    },
  });
}

function truncate(text: string, maxLength = 1990): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// ──────────────────────────────────────────────────────────────────────────────
// /admin handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);

  if (!canUseBot(member)) {
    await interaction.reply({
      content:
        'You need to be a server **Administrator** or have one of the configured bot-manager roles to use this bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prompt = interaction.options.getString('prompt', true);
  const executeImmediately = interaction.options.getBoolean('execute') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Populate member cache so name-based lookups work without extra API calls.
  try {
    await guild.members.fetch();
  } catch {
    // Partial cache is fine — individual lookups still work
  }

  const guildContext = {
    guildName: guild.name,
    prompt,
    existingChannels: guildChannelList(guild),
    existingRoles: guildRoleList(guild),
    memberSample: guildMemberSample(guild),
  };

  let result;
  try {
    result = await processPrompt(
      config,
      guildContext,
      (name, args) => dispatchQueryTool(guild, name, args),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ ${message}`);
    return;
  }

  // ── Query answer ───────────────────────────────────────────────────────────
  if (result.kind === 'query') {
    await interaction.editReply(truncate(result.answer));
    return;
  }

  // ── Plan ───────────────────────────────────────────────────────────────────
  const { plan } = result;

  if (executeImmediately) {
    const results = await executeActions(guild, plan.actions, interaction.user.tag);
    const body = [formatPlan(plan), '', '**Execution results:**', ...results].join('\n');
    await interaction.editReply(truncate(body));
    return;
  }

  const planId = crypto.randomUUID();
  pendingPlans.set(planId, {
    plan,
    userId: interaction.user.id,
    guildId: guild.id,
    expiresAt: Date.now() + 10 * 60_000,
    originalPrompt: prompt,
    interactionToken: interaction.token,
  });

  await interaction.editReply({
    content: truncate(planMessage(plan)),
    components: [buildPlanButtons(planId)],
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// /admin-list handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);

  if (!canUseBot(member)) {
    await interaction.reply({ content: 'You do not have permission to use this bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  const lines: string[] = ['**Channels**'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pos = (c: any): number => (c as { position?: number }).position ?? 0;

  const categories = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => pos(a) - pos(b));

  for (const category of categories.values()) {
    lines.push(`\n📁 **${category.name}**`);
    const children = guild.channels.cache
      .filter((c) => c.parentId === category.id)
      .sort((a, b) => pos(a) - pos(b));
    for (const ch of children.values()) {
      const icon = ch.type === ChannelType.GuildVoice ? '🔊' : '💬';
      lines.push(`  ${icon} #${ch.name}`);
    }
  }

  const uncategorised = guild.channels.cache.filter(
    (c) =>
      c.parentId === null &&
      (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice),
  );
  if (uncategorised.size > 0) {
    lines.push('\n📁 **[No category]**');
    for (const ch of uncategorised.values()) {
      const icon = ch.type === ChannelType.GuildVoice ? '🔊' : '💬';
      lines.push(`  ${icon} #${ch.name}`);
    }
  }

  lines.push('\n**Roles**');
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.rawPosition - a.rawPosition);

  for (const role of roles.values()) {
    const tags: string[] = [];
    if (role.permissions.has(PermissionsBitField.Flags.Administrator)) tags.push('Admin');
    else if (role.permissions.has(PermissionsBitField.Flags.ManageMessages)) tags.push('Mod');
    const suffix = tags.length ? ` *(${tags.join(', ')})*` : '';
    lines.push(`🏷️ @${role.name}${suffix}`);
  }

  await interaction.reply({ content: truncate(lines.join('\n')), flags: MessageFlags.Ephemeral });
}

// ──────────────────────────────────────────────────────────────────────────────
// /admin-help handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const examples = [
    '**Making changes:**',
    '`Create a #general channel (public) and a #staff channel (admins only)`',
    '`Create a Moderator role with manage_messages, kick_members, mute_members`',
    '`Create a Moderator role and assign it to @alice and @bob`',
    '`Create a Staff category with #staff-chat and #announcements (Moderator only)`',
    '`Create a voice channel Gaming Lounge with a 10-user limit`',
    '`Make #general public and #admin-chat admin-only`',
    '`Remove the Moderator role from @charlie`',
    '`Delete the old-bots channel`',
    '',
    '**Asking questions (no changes made):**',
    '`Would @everyone have access to #staff?`',
    '`Which channels can the Moderator role see?`',
    '`What permissions does the Moderator role have?`',
    '`Can alice see the #admin-chat channel?`',
    '`Who has the Moderator role?`',
    '`Show me all channels and whether they are public or private`',
  ].join('\n');

  const configNote =
    config.adminRoleIds.length > 0
      ? `${config.adminRoleIds.length} bot-manager role(s) configured`
      : 'No bot-manager roles configured — only server Administrators can use this bot';

  const content = [
    '## Discord Admin Bot',
    'Use natural language to manage channels, roles, and permissions.',
    '',
    '**Commands**',
    '• `/admin prompt:<text>` — ask a question OR request changes; the bot auto-detects which',
    '• `/admin prompt:<text> execute:true` — execute a change plan immediately without preview',
    '• `/admin-list` — show all channels and roles',
    '• `/admin-help` — show this message',
    '',
    '**Plan review buttons**',
    '• ✅ **Execute** — apply all planned changes',
    '• ✏️ **Refine** — open a follow-up prompt to adjust the plan before applying',
    '• ❌ **Cancel** — discard the plan, no changes made',
    '',
    '**Who can use it**',
    '• Server Administrators',
    '• Members holding a role in `ADMIN_ROLE_IDS`',
    `*(${configNote})*`,
    '',
    '**Example prompts**',
    examples,
  ].join('\n');

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

// ──────────────────────────────────────────────────────────────────────────────
// Bot events
// ──────────────────────────────────────────────────────────────────────────────

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  try {
    await registerCommands();
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  // ── Button interactions ───────────────────────────────────────────────────
  if (interaction.isButton()) {
    const parts = interaction.customId.split(':');
    if (parts[0] !== 'admin') return;

    const [, action, planId] = parts;
    const pending = planId ? pendingPlans.get(planId) : undefined;

    if (!pending) {
      await interaction.update({
        content: '⏰ This plan has expired. Run `/admin` again.',
        components: [],
      });
      return;
    }

    if (interaction.user.id !== pending.userId) {
      await interaction.reply({
        content: "You can't interact with another user's plan.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guild || interaction.guild.id !== pending.guildId) {
      await interaction.update({ content: '❌ Guild mismatch.', components: [] });
      return;
    }

    // ── Cancel ───────────────────────────────────────────────────────────────
    if (action === 'cancel') {
      pendingPlans.delete(planId);
      await interaction.update({ content: '❌ Cancelled — no changes were made.', components: [] });
      return;
    }

    // ── Execute ──────────────────────────────────────────────────────────────
    if (action === 'confirm') {
      pendingPlans.delete(planId);
      await interaction.deferUpdate();

      const results = await executeActions(
        interaction.guild,
        pending.plan.actions,
        interaction.user.tag,
      );

      const body = [
        formatPlan(pending.plan),
        '',
        '**Execution results:**',
        ...results,
      ].join('\n');

      await interaction.editReply({ content: truncate(body), components: [] });
      return;
    }

    // ── Refine — open modal ──────────────────────────────────────────────────
    if (action === 'refine') {
      const modal = new ModalBuilder()
        .setCustomId(`admin:refine-modal:${planId}`)
        .setTitle('Refine the plan');

      const input = new TextInputBuilder()
        .setCustomId('followup')
        .setLabel('What would you like to change or add?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
          'e.g. "also add a #rules channel visible to everyone" or "remove the voice channel"',
        )
        .setMinLength(3)
        .setMaxLength(1000)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    return;
  }

  // ── Modal submissions ─────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    const parts = interaction.customId.split(':');
    if (parts[0] !== 'admin' || parts[1] !== 'refine-modal') return;

    const planId = parts[2];
    const pending = planId ? pendingPlans.get(planId) : undefined;

    if (!pending) {
      await interaction.reply({
        content: '⏰ The plan expired while the modal was open. Run `/admin` again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== pending.userId) {
      await interaction.reply({
        content: "You can't refine another user's plan.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const followup = interaction.fields.getTextInputValue('followup');

    // Acknowledge the modal immediately; refinement can take a few seconds
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('❌ Could not access guild context.');
      return;
    }

    let refinedPlan: BotPlan;

    try {
      refinedPlan = await createRefinedPlan(config, {
        guildName: guild.name,
        prompt: pending.originalPrompt,
        existingChannels: guildChannelList(guild),
        existingRoles: guildRoleList(guild),
        memberSample: guildMemberSample(guild),
        currentPlan: pending.plan,
        followupPrompt: followup,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply(`❌ Refinement failed: ${message}`);
      return;
    }

    // Update the stored plan in-place and reset the expiry
    pending.plan = refinedPlan;
    pending.expiresAt = Date.now() + 10 * 60_000;

    // Update the original /admin message with the refined plan
    try {
      await updateOriginalPlanMessage(
        pending.interactionToken,
        truncate(planMessage(refinedPlan, followup)),
        buildPlanButtons(planId),
      );
    } catch {
      // Token may have expired (> 15 min) — fall back to sending a new reply
      await interaction.editReply({
        content: truncate(planMessage(refinedPlan, followup)),
        components: [buildPlanButtons(planId)],
      });
      return;
    }

    // Dismiss the modal's deferred reply silently
    await interaction.deleteReply();
    return;
  }

  // ── Slash commands ────────────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  const handler: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
    admin: handleAdmin,
    'admin-list': handleList,
    'admin-help': handleHelp,
  };

  const fn = handler[interaction.commandName];
  if (!fn) return;

  try {
    await fn(interaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`❌ ${message}`);
    } else {
      await interaction.reply({ content: `❌ ${message}`, flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(config.discordToken).catch((error) => {
  console.error('Failed to start bot:', error);
  process.exitCode = 1;
});
