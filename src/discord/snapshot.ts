import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Role,
} from "discord.js";
import { colorToHex, flagsToNames } from "./overwrites.js";

export type SnapshotOverwrite = {
  id: string;
  type: "role" | "member";
  allow: string[];
  deny: string[];
};

export type SnapshotChannel = {
  id: string;
  name: string;
  type: string;
  topic: string | null;
  position: number;
  nsfw: boolean;
  parentId: string | null;
  overwrites: SnapshotOverwrite[];
};

export type SnapshotCategory = {
  id: string;
  name: string;
  position: number;
  overwrites: SnapshotOverwrite[];
  channels: SnapshotChannel[];
};

export type SnapshotRole = {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  hoist: boolean;
  mentionable: boolean;
  permissions: string[];
};

export type GuildSnapshot = {
  guildId: string;
  guildName: string;
  everyoneRoleId: string;
  currentChannelId: string | null;
  requester: { id: string; username: string };
  roles: SnapshotRole[];
  categories: SnapshotCategory[];
  uncategorized: SnapshotChannel[];
  mentions: {
    roles: { id: string; name: string }[];
    users: { id: string; username: string }[];
    channels: { id: string; name: string }[];
  };
};

function channelTypeName(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.GuildStageVoice:
      return "stage";
    case ChannelType.GuildCategory:
      return "category";
    default:
      return "other";
  }
}

function serializeOverwrites(
  channel: GuildBasedChannel,
): SnapshotOverwrite[] {
  if (!("permissionOverwrites" in channel) || !channel.permissionOverwrites) {
    return [];
  }
  return [...channel.permissionOverwrites.cache.values()].map((ow) => ({
    id: ow.id,
    type: ow.type === 1 ? ("member" as const) : ("role" as const),
    allow: flagsToNames(ow.allow.bitfield),
    deny: flagsToNames(ow.deny.bitfield),
  }));
}

function serializeChannel(channel: GuildBasedChannel): SnapshotChannel {
  const topic =
    "topic" in channel && typeof channel.topic === "string"
      ? channel.topic
      : null;
  const nsfw = "nsfw" in channel && typeof channel.nsfw === "boolean"
    ? channel.nsfw
    : false;
  return {
    id: channel.id,
    name: channel.name,
    type: channelTypeName(channel.type),
    topic,
    position: "position" in channel ? channel.position : 0,
    nsfw,
    parentId: channel.parentId,
    overwrites: serializeOverwrites(channel),
  };
}

function serializeRole(role: Role): SnapshotRole {
  return {
    id: role.id,
    name: role.name,
    color: colorToHex(role.color),
    position: role.position,
    managed: role.managed,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: flagsToNames(role.permissions.bitfield),
  };
}

export type MentionContext = {
  roles: { id: string; name: string }[];
  users: { id: string; username: string }[];
  channels: { id: string; name: string }[];
};

export function buildSnapshot(
  guild: Guild,
  requester: GuildMember,
  currentChannelId: string | null,
  mentions: MentionContext = { roles: [], users: [], channels: [] },
): GuildSnapshot {
  const categories: SnapshotCategory[] = [];
  const uncategorized: SnapshotChannel[] = [];

  const categoryChannels = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  for (const category of categoryChannels.values()) {
    const children = guild.channels.cache
      .filter((c) => c.parentId === category.id)
      .sort((a, b) => {
        const ap = "position" in a ? a.position : 0;
        const bp = "position" in b ? b.position : 0;
        return ap - bp;
      });

    categories.push({
      id: category.id,
      name: category.name,
      position: category.position,
      overwrites: serializeOverwrites(category),
      channels: [...children.values()].map(serializeChannel),
    });
  }

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) continue;
    if (channel.parentId) continue;
    uncategorized.push(serializeChannel(channel));
  }

  uncategorized.sort((a, b) => a.position - b.position);

  const roles = [...guild.roles.cache.values()]
    .sort((a, b) => b.position - a.position)
    .map(serializeRole);

  return {
    guildId: guild.id,
    guildName: guild.name,
    everyoneRoleId: guild.id,
    currentChannelId,
    requester: {
      id: requester.id,
      username: requester.user.username,
    },
    roles,
    categories,
    uncategorized,
    mentions,
  };
}
