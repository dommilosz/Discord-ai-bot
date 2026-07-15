/**
 * Read-only guild inspection utilities.
 * Each function fetches real data from Discord and returns a human-readable string
 * that is fed back to the AI as a tool result.
 */

import { ChannelType, Guild, PermissionsBitField, type GuildChannel } from 'discord.js';

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function asGuildChannel(channel: { id: string; name?: string }): GuildChannel | undefined {
  if ('permissionOverwrites' in channel) return channel as GuildChannel;
  return undefined;
}

function findChannelByName(guild: Guild, name: string): GuildChannel | undefined {
  const normalised = name.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
  const found = guild.channels.cache.find(
    (c) => c.name.toLowerCase() === normalised || c.id === name,
  );
  return found ? asGuildChannel(found) : undefined;
}

function findRoleByName(guild: Guild, name: string) {
  const normalised = name.toLowerCase().replace(/^@/, '');
  if (normalised === 'everyone') return guild.roles.everyone;
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase() === normalised || r.id === name,
  );
}

async function findMemberByName(guild: Guild, name: string) {
  const cleaned = name.replace(/^<@!?(\d+)>$/, '$1').replace(/^@/, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    try {
      return await guild.members.fetch(cleaned);
    } catch {
      // not found by ID
    }
  }

  const lower = cleaned.toLowerCase();
  try {
    const results = await guild.members.search({ query: cleaned, limit: 5 });
    return (
      results.find(
        (m) =>
          m.user.username.toLowerCase() === lower ||
          m.displayName.toLowerCase() === lower ||
          m.user.globalName?.toLowerCase() === lower,
      ) ?? null
    );
  } catch {
    return null;
  }
}

const KNOWN_PERMISSION_FLAGS: Array<{ flag: bigint; label: string }> = [
  { flag: PermissionsBitField.Flags.Administrator,   label: 'Administrator' },
  { flag: PermissionsBitField.Flags.ManageGuild,     label: 'Manage Server' },
  { flag: PermissionsBitField.Flags.ManageChannels,  label: 'Manage Channels' },
  { flag: PermissionsBitField.Flags.ManageRoles,     label: 'Manage Roles' },
  { flag: PermissionsBitField.Flags.ManageMessages,  label: 'Manage Messages' },
  { flag: PermissionsBitField.Flags.KickMembers,     label: 'Kick Members' },
  { flag: PermissionsBitField.Flags.BanMembers,      label: 'Ban Members' },
  { flag: PermissionsBitField.Flags.MuteMembers,     label: 'Mute Members (voice)' },
  { flag: PermissionsBitField.Flags.DeafenMembers,   label: 'Deafen Members (voice)' },
  { flag: PermissionsBitField.Flags.MoveMembers,     label: 'Move Members (voice)' },
  { flag: PermissionsBitField.Flags.ManageNicknames, label: 'Manage Nicknames' },
  { flag: PermissionsBitField.Flags.ViewAuditLog,    label: 'View Audit Log' },
  { flag: PermissionsBitField.Flags.MentionEveryone, label: 'Mention @everyone' },
  { flag: PermissionsBitField.Flags.ManageWebhooks,  label: 'Manage Webhooks' },
  { flag: PermissionsBitField.Flags.SendMessages,    label: 'Send Messages' },
  { flag: PermissionsBitField.Flags.ViewChannel,     label: 'View Channels' },
  { flag: PermissionsBitField.Flags.Connect,         label: 'Connect (voice)' },
  { flag: PermissionsBitField.Flags.Speak,           label: 'Speak (voice)' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Inspection functions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Detailed breakdown of who can view a channel.
 * Reads actual permission overwrites from Discord.
 */
export function queryChannelAccess(guild: Guild, channelName: string): string {
  const channel = findChannelByName(guild, channelName);
  if (!channel) return `Channel '${channelName}' not found.`;

  const lines: string[] = [`**#${channel.name}** — visibility breakdown:`];

  // @everyone baseline
  const everyoneCanView =
    channel.permissionsFor(guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
  lines.push(`• @everyone: ${everyoneCanView ? '✅ can view' : '❌ cannot view'}`);

  // Per-role / per-member overwrites that touch ViewChannel
  const overwrites = channel.permissionOverwrites.cache;
  for (const [targetId, ow] of overwrites) {
    if (targetId === guild.id) continue; // @everyone already covered

    const hasViewBit =
      ow.allow.has(PermissionsBitField.Flags.ViewChannel) ||
      ow.deny.has(PermissionsBitField.Flags.ViewChannel);
    if (!hasViewBit) continue;

    const role = guild.roles.cache.get(targetId);
    if (role) {
      const canView = channel.permissionsFor(role)?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
      lines.push(`• @${role.name}: ${canView ? '✅ can view' : '❌ cannot view'}`);
      continue;
    }

    const member = guild.members.cache.get(targetId);
    if (member) {
      const canView = channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
      lines.push(`• ${member.displayName} (individual overwrite): ${canView ? '✅ can view' : '❌ cannot view'}`);
    }
  }

  lines.push('• Any role with **Administrator** permission: ✅ always (cannot be denied)');

  return lines.join('\n');
}

/**
 * All permissions a role grants, plus metadata.
 */
export function queryRolePermissions(guild: Guild, roleName: string): string {
  const role = findRoleByName(guild, roleName);
  if (!role) return `Role '${roleName}' not found.`;

  const granted = KNOWN_PERMISSION_FLAGS
    .filter(({ flag }) => role.permissions.has(flag))
    .map(({ label }) => label);

  const hexColor = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'none';
  const memberCount = guild.members.cache.filter((m) => m.roles.cache.has(role.id)).size;

  return [
    `**@${role.name}** role:`,
    `• Color: ${hexColor}`,
    `• Shown separately in member list (hoisted): ${role.hoist ? 'Yes' : 'No'}`,
    `• Mentionable by everyone: ${role.mentionable ? 'Yes' : 'No'}`,
    `• Members with this role: ${memberCount}`,
    `• Permissions: ${granted.length ? granted.join(', ') : 'none (inherits defaults only)'}`,
  ].join('\n');
}

/**
 * Which members currently hold a role.
 */
export function queryRoleMembers(guild: Guild, roleName: string): string {
  const role = findRoleByName(guild, roleName);
  if (!role) return `Role '${roleName}' not found.`;

  const members = guild.members.cache.filter((m) => m.roles.cache.has(role.id));
  if (members.size === 0) return `No members currently have the **@${role.name}** role.`;

  const names = members.map((m) => m.displayName).join(', ');
  return `**@${role.name}** (${members.size} member${members.size === 1 ? '' : 's'}): ${names}`;
}

/**
 * Which channels a role or @everyone can and cannot view.
 */
export function queryChannelsForSubject(guild: Guild, subject: string): string {
  const normalised = subject.toLowerCase().replace(/^@/, '');

  let label: string;
  let getPerms: (ch: GuildChannel) => ReturnType<GuildChannel['permissionsFor']>;

  if (normalised === 'everyone') {
    label = '@everyone';
    getPerms = (ch) => ch.permissionsFor(guild.roles.everyone);
  } else {
    const role = findRoleByName(guild, subject);
    if (!role) {
      return `'${subject}' is not a known role. For a specific member, use query_member_access instead.`;
    }
    label = `@${role.name}`;
    getPerms = (ch) => ch.permissionsFor(role);
  }

  const visible: string[] = [];
  const hidden: string[] = [];

  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) continue;
    const gc = asGuildChannel(ch);
    if (!gc) continue;
    const canView = getPerms(gc)?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
    (canView ? visible : hidden).push(`#${ch.name}`);
  }

  return [
    `**Channels for ${label}:**`,
    `✅ Can view (${visible.length}): ${visible.join(', ') || 'none'}`,
    `❌ Cannot view (${hidden.length}): ${hidden.join(', ') || 'none'}`,
  ].join('\n');
}

/**
 * What channels a specific member can access, or whether they can access one channel.
 */
export async function queryMemberAccess(
  guild: Guild,
  username: string,
  channelName?: string,
): Promise<string> {
  const member = await findMemberByName(guild, username);
  if (!member) return `Member '${username}' not found.`;

  const roleList = member.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => `@${r.name}`)
    .join(', ') || 'none';

  if (channelName) {
    const channel = findChannelByName(guild, channelName);
    if (!channel) return `Channel '${channelName}' not found.`;

    const perms = channel.permissionsFor(member);
    const canView = perms?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
    const canSend = perms?.has(PermissionsBitField.Flags.SendMessages) ?? false;

    return [
      `**${member.displayName}** → **#${channel.name}**:`,
      `• Can view: ${canView ? '✅ Yes' : '❌ No'}`,
      `• Can send messages: ${canView && canSend ? '✅ Yes' : '❌ No'}`,
      `• Their roles: ${roleList}`,
    ].join('\n');
  }

  // List all channels
  const visible: string[] = [];
  const hidden: string[] = [];

  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) continue;
    const gc = asGuildChannel(ch);
    if (!gc) continue;
    const canView = gc.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel) ?? false;
    (canView ? visible : hidden).push(`#${ch.name}`);
  }

  return [
    `**${member.displayName}** (roles: ${roleList})`,
    `✅ Can view (${visible.length}): ${visible.join(', ') || 'none'}`,
    `❌ Cannot view (${hidden.length}): ${hidden.join(', ') || 'none'}`,
  ].join('\n');
}

/**
 * All roles a specific member holds.
 */
export async function queryMemberRoles(guild: Guild, username: string): Promise<string> {
  const member = await findMemberByName(guild, username);
  if (!member) return `Member '${username}' not found.`;

  const roles = member.roles.cache
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.rawPosition - a.rawPosition);

  if (roles.size === 0) return `**${member.displayName}** has no custom roles.`;

  return `**${member.displayName}** has ${roles.size} role(s): ${roles.map((r) => `@${r.name}`).join(', ')}`;
}

/**
 * Overview of all channels with public/private status.
 */
export function queryAllChannels(guild: Guild): string {
  const lines: string[] = ['**All channels:**'];

  for (const cat of guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .values()) {
    lines.push(`\n📁 **${cat.name}**`);
    for (const ch of guild.channels.cache.filter((c) => c.parentId === cat.id).values()) {
      const gc = asGuildChannel(ch);
      const everyoneCanView = gc
        ? (gc.permissionsFor(guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel) ?? false)
        : false;
      const icon = ch.type === ChannelType.GuildVoice ? '🔊' : '💬';
      lines.push(`  ${icon} #${ch.name} [${everyoneCanView ? '🌐 public' : '🔒 restricted'}]`);
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
      const gc = asGuildChannel(ch);
      const everyoneCanView = gc
        ? (gc.permissionsFor(guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel) ?? false)
        : false;
      const icon = ch.type === ChannelType.GuildVoice ? '🔊' : '💬';
      lines.push(`  ${icon} #${ch.name} [${everyoneCanView ? '🌐 public' : '🔒 restricted'}]`);
    }
  }

  return lines.join('\n');
}

/**
 * All roles with permission summary and member counts.
 */
export function queryAllRoles(guild: Guild): string {
  const lines: string[] = ['**All roles:**'];

  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.rawPosition - a.rawPosition);

  for (const role of roles.values()) {
    const tags: string[] = [];
    if (role.permissions.has(PermissionsBitField.Flags.Administrator)) {
      tags.push('Administrator');
    } else {
      if (role.permissions.has(PermissionsBitField.Flags.ManageMessages)) tags.push('Manage Messages');
      if (role.permissions.has(PermissionsBitField.Flags.KickMembers)) tags.push('Kick');
      if (role.permissions.has(PermissionsBitField.Flags.BanMembers)) tags.push('Ban');
      if (role.permissions.has(PermissionsBitField.Flags.MuteMembers)) tags.push('Mute');
    }
    const count = guild.members.cache.filter((m) => m.roles.cache.has(role.id)).size;
    const suffix = tags.length ? ` — ${tags.join(', ')}` : '';
    lines.push(`🏷️ @${role.name}${suffix} (${count} member${count === 1 ? '' : 's'})`);
  }

  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatcher — called by the AI loop in ai.ts
// ──────────────────────────────────────────────────────────────────────────────

export async function dispatchQueryTool(
  guild: Guild,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'query_channel_access':
      return queryChannelAccess(guild, String(args.channel_name ?? ''));

    case 'query_role_permissions':
      return queryRolePermissions(guild, String(args.role_name ?? ''));

    case 'query_role_members':
      return queryRoleMembers(guild, String(args.role_name ?? ''));

    case 'query_channels_for_subject':
      return queryChannelsForSubject(guild, String(args.subject ?? ''));

    case 'query_member_access':
      return queryMemberAccess(
        guild,
        String(args.username ?? ''),
        args.channel_name ? String(args.channel_name) : undefined,
      );

    case 'query_member_roles':
      return queryMemberRoles(guild, String(args.username ?? ''));

    case 'query_all_channels':
      return queryAllChannels(guild);

    case 'query_all_roles':
      return queryAllRoles(guild);

    default:
      return `Unknown query tool: ${name}`;
  }
}
