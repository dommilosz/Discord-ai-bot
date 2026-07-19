import type {
  Channel,
  Guild,
  Message,
  ChatInputCommandInteraction,
} from "discord.js";
import type { MentionContext } from "./snapshot.js";

export function resolveMentionsFromMessage(message: Message): MentionContext {
  return {
    roles: [...message.mentions.roles.values()].map((r) => ({
      id: r.id,
      name: r.name,
    })),
    users: [...message.mentions.users.values()]
      .filter((u) => u.id !== message.client.user?.id)
      .map((u) => ({
        id: u.id,
        username: u.username,
      })),
    channels: [...message.mentions.channels.values()]
      .filter((c): c is Channel & { name: string } => "name" in c)
      .map((c) => ({
        id: c.id,
        name: c.name,
      })),
  };
}

export function resolveMentionsFromInteraction(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  prompt: string,
): MentionContext {
  const roles: { id: string; name: string }[] = [];
  const users: { id: string; username: string }[] = [];
  const channels: { id: string; name: string }[] = [];

  const roleMatches = prompt.matchAll(/<@&(\d+)>/g);
  for (const match of roleMatches) {
    const role = guild.roles.cache.get(match[1]!);
    if (role) roles.push({ id: role.id, name: role.name });
  }

  const userMatches = prompt.matchAll(/<@!?(\d+)>/g);
  for (const match of userMatches) {
    const member = guild.members.cache.get(match[1]!);
    if (member) {
      users.push({ id: member.id, username: member.user.username });
    } else {
      users.push({ id: match[1]!, username: match[1]! });
    }
  }

  const channelMatches = prompt.matchAll(/<#(\d+)>/g);
  for (const match of channelMatches) {
    const channel = guild.channels.cache.get(match[1]!);
    if (channel && "name" in channel) {
      channels.push({ id: channel.id, name: channel.name });
    }
  }

  void interaction;
  return { roles, users, channels };
}

export function stripBotMention(content: string, botId: string): string {
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .trim();
}
