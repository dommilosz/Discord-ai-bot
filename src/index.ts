import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { loadConfig } from './config';
import { createPlan } from './ai';
import { formatPlan, BotPlan } from './plan';
import { executeActions } from './executor';

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
      .setDescription(
        'Describe what you want, e.g. "create a Moderator role and give it to @alice"',
      )
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
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  if (config.adminRoleIds.length === 0) {
    return false;
  }

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
  return guild.members.cache
    .map((m) => m.displayName)
    .slice(0, 30);
}

// ──────────────────────────────────────────────────────────────────────────────
// /admin handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);

  if (!canUseBot(member)) {
    await interaction.reply({
      content:
        'You need to be a server **Administrator** or have one of the configured bot-manager roles to use this bot.',
      ephemeral: true,
    });
    return;
  }

  const prompt = interaction.options.getString('prompt', true);
  const executeImmediately = interaction.options.getBoolean('execute') ?? false;

  // Defer so we have time to call the AI
  await interaction.deferReply({ ephemeral: true });

  // Fetch members so we can resolve them by name
  try {
    await guild.members.fetch();
  } catch {
    // Partial member cache is fine; we will search later
  }

  let plan: BotPlan;

  try {
    plan = await createPlan(config, {
      guildName: guild.name,
      prompt,
      existingChannels: guildChannelList(guild),
      existingRoles: guildRoleList(guild),
      memberSample: guildMemberSample(guild),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`❌ Failed to generate a plan: ${message}`);
    return;
  }

  const preview = formatPlan(plan);

  if (executeImmediately) {
    const results = await executeActions(guild, plan.actions, interaction.user.tag);
    const body = [`${preview}`, '', '**Execution results:**', ...results].join('\n');
    await interaction.editReply(truncate(body));
    return;
  }

  // Store plan for button confirmation (expires in 10 minutes)
  const planId = crypto.randomUUID();
  pendingPlans.set(planId, {
    plan,
    userId: interaction.user.id,
    guildId: guild.id,
    expiresAt: Date.now() + 10 * 60_000,
  });

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`admin:confirm:${planId}`)
    .setLabel('Execute')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`admin:cancel:${planId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

  await interaction.editReply({
    content: `${preview}\n\nConfirm to apply these changes, or cancel to discard.`,
    components: [row],
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// /admin-list handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);

  if (!canUseBot(member)) {
    await interaction.reply({ content: 'You do not have permission to use this bot.', ephemeral: true });
    return;
  }

  const lines: string[] = ['**Channels**'];

  // Categories + their children
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

  // Uncategorised channels
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

  // Roles
  lines.push('\n**Roles**');
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.rawPosition - a.rawPosition);

  for (const role of roles.values()) {
    const perms: string[] = [];
    if (role.permissions.has(PermissionsBitField.Flags.Administrator)) perms.push('Admin');
    else if (role.permissions.has(PermissionsBitField.Flags.ManageMessages)) perms.push('Mod');
    const suffix = perms.length ? ` *(${perms.join(', ')})*` : '';
    lines.push(`🏷️ @${role.name}${suffix}`);
  }

  await interaction.reply({ content: truncate(lines.join('\n')), ephemeral: true });
}

// ──────────────────────────────────────────────────────────────────────────────
// /admin-help handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const examplePrompts = [
    '`Create a #general channel (public) and a #staff channel (admins only)`',
    '`Create a Moderator role with manage_messages, kick_members, mute_members`',
    '`Create a Moderator role and assign it to @alice and @bob`',
    '`Create a Staff category. Inside it, add #staff-chat (private, Moderator only) and #announcements (private, Moderator only)`',
    '`Create a voice channel called Gaming Lounge with a 10-user limit`',
    '`Make #general public and #admin-chat admin-only`',
    '`Remove the Moderator role from @charlie`',
    '`Delete the old-bots channel`',
  ].join('\n');

  const configNote =
    config.adminRoleIds.length > 0
      ? `Configured bot-manager roles: ${config.adminRoleIds.length}`
      : 'No bot-manager roles configured — only server Administrators can use this bot.';

  const content = [
    '## Discord Admin Bot',
    'Use `/admin` with a natural language prompt to manage your server.',
    '',
    '**Who can use it**',
    '• Server Administrators',
    '• Members with a role listed in `ADMIN_ROLE_IDS`',
    `*(${configNote})*`,
    '',
    '**Commands**',
    '• `/admin prompt:<text>` — generate a plan; click **Execute** to apply it',
    '• `/admin prompt:<text> execute:true` — apply changes immediately (no preview)',
    '• `/admin-list` — show all channels and roles',
    '• `/admin-help` — show this message',
    '',
    '**Example prompts**',
    examplePrompts,
    '',
    '**Supported actions**',
    '• Create / delete text channels, voice channels, and categories',
    '• Set channel visibility (public, admin-only, or role-specific)',
    '• Create / delete roles with custom permissions and colors',
    '• Assign / remove roles from users',
  ].join('\n');

  await interaction.reply({ content, ephemeral: true });
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────────────────────────

function truncate(text: string, maxLength = 1990): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// ──────────────────────────────────────────────────────────────────────────────
// Bot events
// ──────────────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
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
      await interaction.update({ content: '⏰ This plan has expired. Run `/admin` again.', components: [] });
      return;
    }

    if (interaction.user.id !== pending.userId) {
      await interaction.reply({ content: "You can't confirm another user's plan.", ephemeral: true });
      return;
    }

    if (!interaction.guild || interaction.guild.id !== pending.guildId) {
      await interaction.update({ content: '❌ Guild mismatch.', components: [] });
      return;
    }

    pendingPlans.delete(planId);

    if (action === 'cancel') {
      await interaction.update({ content: '❌ Cancelled — no changes were made.', components: [] });
      return;
    }

    if (action === 'confirm') {
      await interaction.deferUpdate();
      const results = await executeActions(
        interaction.guild,
        pending.plan.actions,
        interaction.user.tag,
      );
      const body = [formatPlan(pending.plan), '', '**Execution results:**', ...results].join('\n');
      await interaction.editReply({ content: truncate(body), components: [] });
    }

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
      await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
    }
  }
});

client.login(config.discordToken).catch((error) => {
  console.error('Failed to start bot:', error);
  process.exitCode = 1;
});
