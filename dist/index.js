"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const config_1 = require("./config");
const ai_1 = require("./ai");
const plan_1 = require("./plan");
const executor_1 = require("./executor");
const config = (0, config_1.loadConfig)();
const client = new discord_js_1.Client({
    intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMembers],
});
const pendingPlans = new Map();
// Purge expired plans every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingPlans) {
        if (entry.expiresAt < now)
            pendingPlans.delete(id);
    }
}, 5 * 60_000);
// ──────────────────────────────────────────────────────────────────────────────
// Slash command definitions
// ──────────────────────────────────────────────────────────────────────────────
const adminCommand = new discord_js_1.SlashCommandBuilder()
    .setName('admin')
    .setDescription('Plan and execute Discord admin tasks from a natural language prompt')
    .addStringOption((opt) => opt
    .setName('prompt')
    .setDescription('Describe what you want, e.g. "create a Moderator role and give it to @alice"')
    .setRequired(true))
    .addBooleanOption((opt) => opt
    .setName('execute')
    .setDescription('Execute immediately without showing a preview (default: false)')
    .setRequired(false));
const listCommand = new discord_js_1.SlashCommandBuilder()
    .setName('admin-list')
    .setDescription('List current channels and roles in this server');
const helpCommand = new discord_js_1.SlashCommandBuilder()
    .setName('admin-help')
    .setDescription('Show usage guide and example prompts for the admin bot');
// ──────────────────────────────────────────────────────────────────────────────
// Command registration
// ──────────────────────────────────────────────────────────────────────────────
async function registerCommands() {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(config.discordToken);
    const body = [adminCommand.toJSON(), listCommand.toJSON(), helpCommand.toJSON()];
    if (config.guildId) {
        await rest.put(discord_js_1.Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
        console.log('Registered guild commands.');
        return;
    }
    await rest.put(discord_js_1.Routes.applicationCommands(config.clientId), { body });
    console.log('Registered global commands (may take up to 1 hour to propagate).');
}
// ──────────────────────────────────────────────────────────────────────────────
// Access control
// ──────────────────────────────────────────────────────────────────────────────
function canUseBot(member) {
    if (member.permissions.has(discord_js_1.PermissionsBitField.Flags.Administrator)) {
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
function guildChannelList(guild) {
    return guild.channels.cache
        .filter((c) => c.type !== discord_js_1.ChannelType.GuildCategory)
        .map((c) => c.name)
        .slice(0, 50);
}
function guildRoleList(guild) {
    return guild.roles.cache
        .filter((r) => r.id !== guild.id)
        .map((r) => r.name)
        .slice(0, 50);
}
function guildMemberSample(guild) {
    return guild.members.cache
        .map((m) => m.displayName)
        .slice(0, 30);
}
// ──────────────────────────────────────────────────────────────────────────────
// /admin handler
// ──────────────────────────────────────────────────────────────────────────────
async function handleAdmin(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }
    const guild = interaction.guild;
    const member = await guild.members.fetch(interaction.user.id);
    if (!canUseBot(member)) {
        await interaction.reply({
            content: 'You need to be a server **Administrator** or have one of the configured bot-manager roles to use this bot.',
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
    }
    catch {
        // Partial member cache is fine; we will search later
    }
    let plan;
    try {
        plan = await (0, ai_1.createPlan)(config, {
            guildName: guild.name,
            prompt,
            existingChannels: guildChannelList(guild),
            existingRoles: guildRoleList(guild),
            memberSample: guildMemberSample(guild),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await interaction.editReply(`❌ Failed to generate a plan: ${message}`);
        return;
    }
    const preview = (0, plan_1.formatPlan)(plan);
    if (executeImmediately) {
        const results = await (0, executor_1.executeActions)(guild, plan.actions, interaction.user.tag);
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
    const confirmBtn = new discord_js_1.ButtonBuilder()
        .setCustomId(`admin:confirm:${planId}`)
        .setLabel('Execute')
        .setStyle(discord_js_1.ButtonStyle.Success)
        .setEmoji('✅');
    const cancelBtn = new discord_js_1.ButtonBuilder()
        .setCustomId(`admin:cancel:${planId}`)
        .setLabel('Cancel')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setEmoji('❌');
    const row = new discord_js_1.ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
    await interaction.editReply({
        content: `${preview}\n\nConfirm to apply these changes, or cancel to discard.`,
        components: [row],
    });
}
// ──────────────────────────────────────────────────────────────────────────────
// /admin-list handler
// ──────────────────────────────────────────────────────────────────────────────
async function handleList(interaction) {
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
    const lines = ['**Channels**'];
    // Categories + their children
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = (c) => c.position ?? 0;
    const categories = guild.channels.cache
        .filter((c) => c.type === discord_js_1.ChannelType.GuildCategory)
        .sort((a, b) => pos(a) - pos(b));
    for (const category of categories.values()) {
        lines.push(`\n📁 **${category.name}**`);
        const children = guild.channels.cache
            .filter((c) => c.parentId === category.id)
            .sort((a, b) => pos(a) - pos(b));
        for (const ch of children.values()) {
            const icon = ch.type === discord_js_1.ChannelType.GuildVoice ? '🔊' : '💬';
            lines.push(`  ${icon} #${ch.name}`);
        }
    }
    // Uncategorised channels
    const uncategorised = guild.channels.cache.filter((c) => c.parentId === null &&
        (c.type === discord_js_1.ChannelType.GuildText || c.type === discord_js_1.ChannelType.GuildVoice));
    if (uncategorised.size > 0) {
        lines.push('\n📁 **[No category]**');
        for (const ch of uncategorised.values()) {
            const icon = ch.type === discord_js_1.ChannelType.GuildVoice ? '🔊' : '💬';
            lines.push(`  ${icon} #${ch.name}`);
        }
    }
    // Roles
    lines.push('\n**Roles**');
    const roles = guild.roles.cache
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.rawPosition - a.rawPosition);
    for (const role of roles.values()) {
        const perms = [];
        if (role.permissions.has(discord_js_1.PermissionsBitField.Flags.Administrator))
            perms.push('Admin');
        else if (role.permissions.has(discord_js_1.PermissionsBitField.Flags.ManageMessages))
            perms.push('Mod');
        const suffix = perms.length ? ` *(${perms.join(', ')})*` : '';
        lines.push(`🏷️ @${role.name}${suffix}`);
    }
    await interaction.reply({ content: truncate(lines.join('\n')), ephemeral: true });
}
// ──────────────────────────────────────────────────────────────────────────────
// /admin-help handler
// ──────────────────────────────────────────────────────────────────────────────
async function handleHelp(interaction) {
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
    const configNote = config.adminRoleIds.length > 0
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
function truncate(text, maxLength = 1990) {
    if (text.length <= maxLength)
        return text;
    return text.slice(0, maxLength - 3) + '...';
}
// ──────────────────────────────────────────────────────────────────────────────
// Bot events
// ──────────────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    try {
        await registerCommands();
    }
    catch (error) {
        console.error('Failed to register commands:', error);
    }
});
client.on('interactionCreate', async (interaction) => {
    // ── Button interactions ───────────────────────────────────────────────────
    if (interaction.isButton()) {
        const parts = interaction.customId.split(':');
        if (parts[0] !== 'admin')
            return;
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
            const results = await (0, executor_1.executeActions)(interaction.guild, pending.plan.actions, interaction.user.tag);
            const body = [(0, plan_1.formatPlan)(pending.plan), '', '**Execution results:**', ...results].join('\n');
            await interaction.editReply({ content: truncate(body), components: [] });
        }
        return;
    }
    // ── Slash commands ────────────────────────────────────────────────────────
    if (!interaction.isChatInputCommand())
        return;
    const handler = {
        admin: handleAdmin,
        'admin-list': handleList,
        'admin-help': handleHelp,
    };
    const fn = handler[interaction.commandName];
    if (!fn)
        return;
    try {
        await fn(interaction);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(`❌ ${message}`);
        }
        else {
            await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
        }
    }
});
client.login(config.discordToken).catch((error) => {
    console.error('Failed to start bot:', error);
    process.exitCode = 1;
});
