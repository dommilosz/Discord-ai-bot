import {
  ChannelType,
  Guild,
  PermissionsBitField,
  type ColorResolvable,
  type GuildChannel,
} from 'discord.js';
import { PlannedAction } from './plan';

// ──────────────────────────────────────────────────────────────────────────────
// Permission name → PermissionsBitField flag
// ──────────────────────────────────────────────────────────────────────────────

const PERMISSION_FLAGS: Record<string, bigint> = {
  administrator: PermissionsBitField.Flags.Administrator,
  manage_channels: PermissionsBitField.Flags.ManageChannels,
  manage_roles: PermissionsBitField.Flags.ManageRoles,
  manage_messages: PermissionsBitField.Flags.ManageMessages,
  kick_members: PermissionsBitField.Flags.KickMembers,
  ban_members: PermissionsBitField.Flags.BanMembers,
  mute_members: PermissionsBitField.Flags.MuteMembers,
  move_members: PermissionsBitField.Flags.MoveMembers,
  manage_nicknames: PermissionsBitField.Flags.ManageNicknames,
  view_audit_log: PermissionsBitField.Flags.ViewAuditLog,
  manage_guild: PermissionsBitField.Flags.ManageGuild,
  mention_everyone: PermissionsBitField.Flags.MentionEveryone,
  manage_webhooks: PermissionsBitField.Flags.ManageWebhooks,
  send_messages: PermissionsBitField.Flags.SendMessages,
  read_messages: PermissionsBitField.Flags.ViewChannel,
  view_channel: PermissionsBitField.Flags.ViewChannel,
  connect: PermissionsBitField.Flags.Connect,
  speak: PermissionsBitField.Flags.Speak,
  deafen_members: PermissionsBitField.Flags.DeafenMembers,
};

function resolvePermissionBits(names: string[]): bigint {
  let bits = BigInt(0);
  for (const name of names) {
    const flag = PERMISSION_FLAGS[name.toLowerCase()];
    if (flag !== undefined) {
      bits |= flag;
    }
  }
  return bits;
}

// ──────────────────────────────────────────────────────────────────────────────
// Member resolution (by ID, username, display name, or globalName)
// ──────────────────────────────────────────────────────────────────────────────

async function resolveMember(guild: Guild, reference: string) {
  // Strip Discord mention syntax <@123> or <@!123>
  const cleaned = reference.replace(/^<@!?(\d+)>$/, '$1').trim();

  // Try as a Discord user ID
  if (/^\d{17,20}$/.test(cleaned)) {
    try {
      return await guild.members.fetch(cleaned);
    } catch {
      // not found by ID
    }
  }

  // Search by username / display name
  try {
    const results = await guild.members.search({ query: cleaned, limit: 5 });
    const lower = cleaned.toLowerCase();
    const match = results.find(
      (m) =>
        m.user.username.toLowerCase() === lower ||
        m.displayName.toLowerCase() === lower ||
        m.user.globalName?.toLowerCase() === lower,
    );
    return match ?? null;
  } catch {
    return null;
  }
}

function findRoleByName(guild: Guild, name: string) {
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase() === name.toLowerCase() || r.id === name,
  );
}

function findChannelByName(guild: Guild, name: string) {
  const normalised = name.toLowerCase().replace(/\s+/g, '-');
  return guild.channels.cache.find(
    (c) => c.name.toLowerCase() === normalised || c.id === name,
  ) as GuildChannel | undefined;
}

async function findOrCreateCategory(guild: Guild, categoryName: string) {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase(),
  );
  if (existing) return existing;

  return await guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory,
    reason: 'Created automatically by admin bot',
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Action executors
// ──────────────────────────────────────────────────────────────────────────────

async function execCreateRole(guild: Guild, action: Extract<PlannedAction, { type: 'create_role' }>, reason: string): Promise<string> {
  const bits = resolvePermissionBits(action.permissions ?? []);

  const role = await guild.roles.create({
    name: action.name,
    color: (action.color as ColorResolvable | undefined) ?? undefined,
    hoist: action.hoist ?? true,
    mentionable: action.mentionable ?? false,
    permissions: new PermissionsBitField(bits),
    reason,
  });

  const permList = action.permissions?.join(', ') || 'none';
  return `✅ Created role **@${role.name}** (permissions: ${permList})`;
}

async function execCreateChannel(
  guild: Guild,
  action: Extract<PlannedAction, { type: 'create_channel' }>,
  reason: string,
): Promise<string> {
  const overwrites: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }> = [];

  if (action.private) {
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

  const channelType =
    action.channelType === 'text'
      ? ChannelType.GuildText
      : action.channelType === 'voice'
        ? ChannelType.GuildVoice
        : ChannelType.GuildCategory;

  const parentId =
    action.category && action.channelType !== 'category'
      ? (await findOrCreateCategory(guild, action.category)).id
      : undefined;

  const channel = await guild.channels.create({
    name: action.name,
    type: channelType,
    parent: parentId,
    topic: action.channelType === 'text' ? (action.topic ?? undefined) : undefined,
    userLimit: action.channelType === 'voice' ? (action.userLimit ?? 0) : undefined,
    permissionOverwrites: overwrites,
    reason,
  });

  const access = action.private ? 'private' : 'public';
  const location = action.category ? ` in **${action.category}**` : '';
  return `✅ Created ${action.channelType} channel **#${channel.name}**${location} [${access}]`;
}

async function execAssignRole(
  guild: Guild,
  action: Extract<PlannedAction, { type: 'assign_role' }>,
  reason: string,
): Promise<string> {
  const role = findRoleByName(guild, action.role);
  if (!role) {
    return `❌ Role not found: **${action.role}**`;
  }

  const results: string[] = [];

  for (const userRef of action.users) {
    const member = await resolveMember(guild, userRef);
    if (!member) {
      results.push(`⚠️ User not found: ${userRef}`);
      continue;
    }
    await member.roles.add(role, reason);
    results.push(`✅ Assigned **@${role.name}** → **${member.displayName}**`);
  }

  return results.join('\n');
}

async function execRemoveRole(
  guild: Guild,
  action: Extract<PlannedAction, { type: 'remove_role' }>,
  reason: string,
): Promise<string> {
  const role = findRoleByName(guild, action.role);
  if (!role) {
    return `❌ Role not found: **${action.role}**`;
  }

  const results: string[] = [];

  for (const userRef of action.users) {
    const member = await resolveMember(guild, userRef);
    if (!member) {
      results.push(`⚠️ User not found: ${userRef}`);
      continue;
    }
    await member.roles.remove(role, reason);
    results.push(`✅ Removed **@${role.name}** from **${member.displayName}**`);
  }

  return results.join('\n');
}

async function execSetChannelAccess(
  guild: Guild,
  action: Extract<PlannedAction, { type: 'set_channel_access' }>,
  reason: string,
): Promise<string> {
  const channel = findChannelByName(guild, action.channel);
  if (!channel) {
    return `❌ Channel not found: **${action.channel}**`;
  }

  const overwrites: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }> = [];

  if (action.everyone) {
    overwrites.push({
      id: guild.roles.everyone.id,
      ...(action.everyone === 'allow'
        ? { allow: [PermissionsBitField.Flags.ViewChannel] }
        : { deny: [PermissionsBitField.Flags.ViewChannel] }),
    });
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

  const manageable = channel as GuildChannel & {
    permissionOverwrites: {
      set(overwrites: Array<{ id: string; allow?: bigint[]; deny?: bigint[] }>, reason?: string): Promise<unknown>;
    };
  };

  await manageable.permissionOverwrites.set(overwrites, reason);
  return `✅ Updated access for **#${channel.name}**`;
}

async function execDeleteChannel(
  guild: Guild,
  action: Extract<PlannedAction, { type: 'delete_channel' }>,
  reason: string,
): Promise<string> {
  const channel = findChannelByName(guild, action.name);
  if (!channel) {
    return `❌ Channel not found: **${action.name}**`;
  }
  await channel.delete(reason);
  return `✅ Deleted channel **#${action.name}**`;
}

async function execDeleteRole(
  guild: Guild,
  action: Extract<PlannedAction, { type: 'delete_role' }>,
  reason: string,
): Promise<string> {
  const role = findRoleByName(guild, action.name);
  if (!role) {
    return `❌ Role not found: **${action.name}**`;
  }
  await role.delete(reason);
  return `✅ Deleted role **@${action.name}**`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────────

export async function executeActions(
  guild: Guild,
  actions: PlannedAction[],
  requesterTag: string,
): Promise<string[]> {
  const reason = `Admin bot — requested by ${requesterTag}`;
  const results: string[] = [];

  // Create categories first so channels can reference them
  const sorted = [
    ...actions.filter((a) => a.type === 'create_channel' && a.channelType === 'category'),
    ...actions.filter((a) => !(a.type === 'create_channel' && a.channelType === 'category')),
  ];

  for (const action of sorted) {
    try {
      switch (action.type) {
        case 'create_role':
          results.push(await execCreateRole(guild, action, reason));
          break;
        case 'create_channel':
          results.push(await execCreateChannel(guild, action, reason));
          break;
        case 'assign_role':
          results.push(await execAssignRole(guild, action, reason));
          break;
        case 'remove_role':
          results.push(await execRemoveRole(guild, action, reason));
          break;
        case 'set_channel_access':
          results.push(await execSetChannelAccess(guild, action, reason));
          break;
        case 'delete_channel':
          results.push(await execDeleteChannel(guild, action, reason));
          break;
        case 'delete_role':
          results.push(await execDeleteRole(guild, action, reason));
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push(`❌ Failed (${action.type}): ${message}`);
    }
  }

  return results;
}
