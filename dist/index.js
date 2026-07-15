"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const config_1 = require("./config");
const ai_1 = require("./ai");
const plan_1 = require("./plan");
const config = (0, config_1.loadConfig)();
const client = new discord_js_1.Client({
    intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMembers],
});
const command = new discord_js_1.SlashCommandBuilder()
    .setName('admin-plan')
    .setDescription('Plan and optionally execute Discord admin tasks from a prompt')
    .addStringOption((option) => option.setName('prompt').setDescription('Describe the channels, roles, and permissions you want').setRequired(true))
    .addBooleanOption((option) => option.setName('execute').setDescription('Execute the plan immediately after previewing it').setRequired(false));
async function registerCommands() {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(config.discordToken);
    const body = [command.toJSON()];
    if (config.guildId) {
        await rest.put(discord_js_1.Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
        return;
    }
    await rest.put(discord_js_1.Routes.applicationCommands(config.clientId), { body });
}
function canUseBot(member) {
    if (member.permissions.has(discord_js_1.PermissionsBitField.Flags.Administrator)) {
        return true;
    }
    if (config.adminRoleIds.length === 0) {
        return false;
    }
    return config.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
function roleOptionsFromGuildRoles(guild) {
    return Array.from(guild.roles.cache.values())
        .filter((role) => role.id !== guild.id)
        .map((role) => ({ id: role.id, name: role.name }));
}
async function handlePlan(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
    }
    const member = await guild.members.fetch(interaction.user.id);
    if (!canUseBot(member)) {
        await interaction.reply({ content: 'You do not have permission to use this bot.', ephemeral: true });
        return;
    }
    const prompt = interaction.options.getString('prompt', true);
    const execute = interaction.options.getBoolean('execute') ?? false;
    await interaction.deferReply({ ephemeral: true });
    const plan = await (0, ai_1.createPlan)(config, {
        guildName: guild.name,
        prompt,
        roleOptions: roleOptionsFromGuildRoles(guild),
    });
    const preview = (0, plan_1.formatPlan)(plan);
    if (!execute) {
        await interaction.editReply(`${preview}\n\nRe-run with execute:true to apply these changes.`);
        return;
    }
    const results = await executePlan(interaction, plan.actions);
    await interaction.editReply(`${preview}\n\nExecution results:\n${results.join('\n')}`);
}
async function executePlan(interaction, actions) {
    const results = [];
    const guild = interaction.guild;
    if (!guild) {
        throw new Error('Guild context missing');
    }
    for (const action of actions) {
        switch (action.type) {
            case 'create_role': {
                const role = await guild.roles.create({
                    name: action.name,
                    color: action.color,
                    hoist: action.hoist,
                    mentionable: action.mentionable,
                    reason: `Requested by ${interaction.user.tag}`,
                });
                results.push(`Created role ${role.name}`);
                break;
            }
            case 'create_channel': {
                const overwrites = [];
                if (action.private || action.channelType === 'category') {
                    overwrites.push({ id: guild.roles.everyone.id, deny: [discord_js_1.PermissionsBitField.Flags.ViewChannel] });
                }
                for (const roleName of action.allowedRoles ?? []) {
                    const role = findRoleByName(guild, roleName);
                    if (role) {
                        overwrites.push({ id: role.id, allow: [discord_js_1.PermissionsBitField.Flags.ViewChannel] });
                    }
                }
                for (const roleName of action.deniedRoles ?? []) {
                    const role = findRoleByName(guild, roleName);
                    if (role) {
                        overwrites.push({ id: role.id, deny: [discord_js_1.PermissionsBitField.Flags.ViewChannel] });
                    }
                }
                const channel = await guild.channels.create({
                    name: action.name,
                    type: action.channelType === 'text'
                        ? discord_js_1.ChannelType.GuildText
                        : action.channelType === 'voice'
                            ? discord_js_1.ChannelType.GuildVoice
                            : discord_js_1.ChannelType.GuildCategory,
                    parent: action.category ? findCategoryByName(guild, action.category)?.id : undefined,
                    topic: action.channelType === 'text' ? action.topic : undefined,
                    permissionOverwrites: overwrites,
                    reason: `Requested by ${interaction.user.tag}`,
                });
                results.push(`Created channel ${channel.name}`);
                break;
            }
            case 'assign_role': {
                const role = findRoleByName(guild, action.role);
                if (!role) {
                    results.push(`Skipped assigning missing role ${action.role}`);
                    break;
                }
                for (const userRef of action.users) {
                    const member = await resolveMember(guild, userRef);
                    if (!member) {
                        results.push(`Skipped missing user ${userRef}`);
                        continue;
                    }
                    await member.roles.add(role, `Requested by ${interaction.user.tag}`);
                    results.push(`Assigned ${role.name} to ${member.user.tag}`);
                }
                break;
            }
            case 'set_channel_access': {
                const channel = findChannelByName(guild, action.channel);
                if (!channel) {
                    results.push(`Skipped missing channel ${action.channel}`);
                    break;
                }
                const overwrites = {};
                for (const roleName of action.allowedRoles ?? []) {
                    const role = findRoleByName(guild, roleName);
                    if (role) {
                        overwrites[role.id] = { allow: [discord_js_1.PermissionsBitField.Flags.ViewChannel] };
                    }
                }
                for (const roleName of action.deniedRoles ?? []) {
                    const role = findRoleByName(guild, roleName);
                    if (role) {
                        overwrites[role.id] = { deny: [discord_js_1.PermissionsBitField.Flags.ViewChannel] };
                    }
                }
                if (action.everyone) {
                    overwrites[guild.roles.everyone.id] =
                        action.everyone === 'allow'
                            ? { allow: [discord_js_1.PermissionsBitField.Flags.ViewChannel] }
                            : { deny: [discord_js_1.PermissionsBitField.Flags.ViewChannel] };
                }
                const manageableChannel = channel;
                await manageableChannel.permissionOverwrites.set(Object.entries(overwrites).map(([id, permissions]) => ({ id, ...permissions })), `Requested by ${interaction.user.tag}`);
                results.push(`Updated access for ${channel.name}`);
                break;
            }
        }
    }
    return results;
}
function findRoleByName(guild, name) {
    return guild.roles.cache.find((role) => role.name.toLowerCase() === name.toLowerCase() || role.id === name);
}
function findCategoryByName(guild, name) {
    return guild.channels.cache.find((channel) => channel.type === discord_js_1.ChannelType.GuildCategory && channel.name.toLowerCase() === name.toLowerCase());
}
function findChannelByName(guild, name) {
    return guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() || channel.id === name);
}
async function resolveMember(guild, reference) {
    const idMatch = reference.match(/^<?@!?([0-9]+)>?$/);
    const memberId = idMatch?.[1] ?? reference;
    try {
        return await guild.members.fetch(memberId);
    }
    catch {
        return null;
    }
}
client.once('ready', async () => {
    await registerCommands();
    console.log(`Logged in as ${client.user?.tag}`);
});
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'admin-plan') {
        return;
    }
    try {
        await handlePlan(interaction);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(`Failed: ${message}`);
        }
        else {
            await interaction.reply({ content: `Failed: ${message}`, ephemeral: true });
        }
    }
});
client.login(config.discordToken).catch((error) => {
    console.error('Failed to start bot', error);
    process.exitCode = 1;
});
