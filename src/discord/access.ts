import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildChannel,
  type PermissionsBitField,
} from "discord.js";
import { namesToBitfield } from "./overwrites.js";

const DEFAULT_TEXT_PERMS = ["ViewChannel"];
const DEFAULT_VOICE_PERMS = ["ViewChannel", "Connect"];

export async function checkAccess(
  guild: Guild,
  opts: {
    subjectType: "role" | "member";
    subjectId: string;
    channelId: string;
    permissions?: string[];
  },
): Promise<string> {
  const channel = guild.channels.cache.get(opts.channelId);
  if (!channel || channel.isDMBased()) {
    return `Channel \`${opts.channelId}\` was not found.`;
  }

  if (!("permissionsFor" in channel) || !("name" in channel)) {
    return `Cannot check permissions for channel \`${opts.channelId}\`.`;
  }

  const guildChannel = channel as GuildChannel;
  const isVoice =
    channel.type === ChannelType.GuildVoice ||
    channel.type === ChannelType.GuildStageVoice;

  const wanted =
    opts.permissions && opts.permissions.length > 0
      ? opts.permissions
      : isVoice
        ? DEFAULT_VOICE_PERMS
        : DEFAULT_TEXT_PERMS;

  let perms: PermissionsBitField | null;

  if (opts.subjectType === "role") {
    const role = guild.roles.cache.get(opts.subjectId);
    if (!role) {
      return `Role \`${opts.subjectId}\` was not found.`;
    }
    perms = guildChannel.permissionsFor(role);
    const lines = wanted.map((flag) => {
      const bit = namesToBitfield([flag]);
      const allowed = perms?.has(bit) ?? false;
      return `- **${flag}**: ${allowed ? "yes" : "no"}`;
    });
    const canView = perms?.has(PermissionFlagsBits.ViewChannel) ?? false;
    return (
      `Access for role **@${role.name}** in **#${channel.name}**:\n` +
      (canView
        ? "They **can** see this channel.\n"
        : "They **cannot** see this channel.\n") +
      lines.join("\n")
    );
  }

  const member =
    guild.members.cache.get(opts.subjectId) ??
    (await guild.members.fetch(opts.subjectId).catch(() => null));
  if (!member) {
    return `Member \`${opts.subjectId}\` was not found.`;
  }
  perms = guildChannel.permissionsFor(member);
  const lines = wanted.map((flag) => {
    const bit = namesToBitfield([flag]);
    const allowed = perms?.has(bit) ?? false;
    return `- **${flag}**: ${allowed ? "yes" : "no"}`;
  });
  const canView = perms?.has(PermissionFlagsBits.ViewChannel) ?? false;
  return (
    `Access for **${member.user.username}** in **#${channel.name}**:\n` +
    (canView
      ? "They **can** see this channel.\n"
      : "They **cannot** see this channel.\n") +
    lines.join("\n")
  );
}
