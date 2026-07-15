import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type ColorResolvable,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import { loadConfig } from './config';
import { createPlan } from './ai';
import { formatPlan, PlannedAction } from './plan';

const config = loadConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const command = new SlashCommandBuilder()
  .setName('admin-plan')
  .setDescription('Plan and optionally execute Discord admin tasks from a prompt')
  .addStringOption((option) =>
    option.setName('prompt').setDescription('Describe the channels, roles, and permissions you want').setRequired(true),
  )
  .addBooleanOption((option) =>
    option.setName('execute').setDescription('Execute the plan immediately after previewing it').setRequired(false),
  );

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const body = [command.toJSON()];

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body });
}

function canUseBot(member: GuildMember): boolean {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  if (config.adminRoleIds.length === 0) {
    return false;
  }

  return config.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

function roleOptionsFromGuildRoles(guild: NonNullable<ChatInputCommandInteraction['guild']>) {
  return Array.from(guild.roles.cache.values())
    .filter((role) => role.id !== guild.id)
    .map((role) => ({ id: role.id, name: role.name }));
}

async function handlePlan(interaction: ChatInputCommandInteraction): Promise<void> {
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

  const plan = await createPlan(config, {
    guildName: guild.name,
    prompt,
    roleOptions: roleOptionsFromGuildRoles(guild),
  });

  const preview = formatPlan(plan);

  if (!execute) {
    await interaction.editReply(`${preview}\n\nRe-run with execute:true to apply these changes.`);
    return;
  }

  const results = await executePlan(interaction, plan.actions);
  await interaction.editReply(`${preview}\n\nExecution results:\n${results.join('\n')}`);
}

async function executePlan(interaction: ChatInputCommandInteraction, actions: PlannedAction[]): Promise<string[]> {
  const results: string[] = [];
  const guild = interaction.guild;

  if (!guild) {
    throw new Error('Guild context missing');
  }

  for (const action of actions) {
    switch (action.type) {
      case 'create_role': {
        const role = await guild.roles.create({
          name: action.name,
          color: action.color as ColorResolvable | undefined,
          hoist: action.hoist,
          mentionable: action.mentionable,
          reason: `Requested by ${interaction.user.tag}`,
        });
        results.push(`Created role ${role.name}`);
        break;
      }
      case 'create_channel': {
        const overwrites: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }> = [];
        if (action.private || action.channelType === 'category') {
          overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] });
        }
        for (const roleName of action.allowedRoles ?? []) {
          const role = findRoleByName(guild, roleName);
          if (role) {
            overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] });
          }
        }
        for (const roleName of action.deniedRoles ?? []) {
          const role = findRoleByName(guild, roleName);
          if (role) {
            overwrites.push({ id: role.id, deny: [PermissionsBitField.Flags.ViewChannel] });
          }
        }

        const channel = await guild.channels.create({
          name: action.name,
          type:
            action.channelType === 'text'
              ? ChannelType.GuildText
              : action.channelType === 'voice'
                ? ChannelType.GuildVoice
                : ChannelType.GuildCategory,
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

        const overwrites: Record<string, { allow?: bigint[]; deny?: bigint[] }> = {};

        for (const roleName of action.allowedRoles ?? []) {
          const role = findRoleByName(guild, roleName);
          if (role) {
            overwrites[role.id] = { allow: [PermissionsBitField.Flags.ViewChannel] };
          }
        }
        for (const roleName of action.deniedRoles ?? []) {
          const role = findRoleByName(guild, roleName);
          if (role) {
            overwrites[role.id] = { deny: [PermissionsBitField.Flags.ViewChannel] };
          }
        }

        if (action.everyone) {
          overwrites[guild.roles.everyone.id] =
            action.everyone === 'allow'
              ? { allow: [PermissionsBitField.Flags.ViewChannel] }
              : { deny: [PermissionsBitField.Flags.ViewChannel] };
        }

        const manageableChannel = channel as typeof channel & {
          permissionOverwrites: { set: (overwritesToSet: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }>, reason?: string) => Promise<unknown> };
        };

        await manageableChannel.permissionOverwrites.set(
          Object.entries(overwrites).map(([id, permissions]) => ({ id, ...permissions })),
          `Requested by ${interaction.user.tag}`,
        );
        results.push(`Updated access for ${channel.name}`);
        break;
      }
    }
  }

  return results;
}

function findRoleByName(guild: NonNullable<ChatInputCommandInteraction['guild']>, name: string) {
  return guild.roles.cache.find((role) => role.name.toLowerCase() === name.toLowerCase() || role.id === name);
}

function findCategoryByName(guild: NonNullable<ChatInputCommandInteraction['guild']>, name: string) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === name.toLowerCase(),
  );
}

function findChannelByName(guild: NonNullable<ChatInputCommandInteraction['guild']>, name: string) {
  return guild.channels.cache.find((channel) => channel.name.toLowerCase() === name.toLowerCase() || channel.id === name);
}

async function resolveMember(guild: NonNullable<ChatInputCommandInteraction['guild']>, reference: string) {
  const idMatch = reference.match(/^<?@!?([0-9]+)>?$/);
  const memberId = idMatch?.[1] ?? reference;

  try {
    return await guild.members.fetch(memberId);
  } catch {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`Failed: ${message}`);
    } else {
      await interaction.reply({ content: `Failed: ${message}`, ephemeral: true });
    }
  }
});

client.login(config.discordToken).catch((error) => {
  console.error('Failed to start bot', error);
  process.exitCode = 1;
});