import {
  ChannelType,
  type CategoryChannel,
  type Guild,
  type GuildChannel,
  type TextChannel,
} from "discord.js";
import type { Action } from "../ai/schema.js";
import {
  toOverwriteResolvable,
  type OverwriteInput,
} from "./overwrites.js";

function mapChannelType(
  type: "text" | "voice" | "forum" | "announcement",
):
  | ChannelType.GuildText
  | ChannelType.GuildVoice
  | ChannelType.GuildForum
  | ChannelType.GuildAnnouncement {
  switch (type) {
    case "voice":
      return ChannelType.GuildVoice;
    case "forum":
      return ChannelType.GuildForum;
    case "announcement":
      return ChannelType.GuildAnnouncement;
    default:
      return ChannelType.GuildText;
  }
}

function overwriteToEditFlags(
  ow: OverwriteInput,
): Record<string, boolean | null> {
  const flags: Record<string, boolean | null> = {};
  for (const name of ow.allow ?? []) flags[name] = true;
  for (const name of ow.deny ?? []) flags[name] = false;
  return flags;
}

async function applyOverwrites(
  channel: GuildChannel,
  overwrites: OverwriteInput[],
  mode: "replace" | "merge" = "replace",
): Promise<void> {
  if (mode === "replace") {
    await channel.permissionOverwrites.set(toOverwriteResolvable(overwrites));
    return;
  }
  for (const ow of overwrites) {
    await channel.permissionOverwrites.edit(ow.id, overwriteToEditFlags(ow));
  }
}

export async function executeChannelAction(
  guild: Guild,
  action: Action,
  createdCategories?: Map<string, string>,
): Promise<string> {
  switch (action.type) {
    case "create_channel": {
      const created = await guild.channels.create({
        name: action.name,
        type: mapChannelType(action.channelType),
        parent: action.parentId ?? undefined,
        topic: action.topic ?? undefined,
        permissionOverwrites: action.overwrites
          ? toOverwriteResolvable(action.overwrites)
          : undefined,
      });
      return `Created ${action.channelType} channel <#${created.id}> (\`${created.name}\`).`;
    }
    case "create_category": {
      const created = await guild.channels.create({
        name: action.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: action.overwrites
          ? toOverwriteResolvable(action.overwrites)
          : undefined,
      });
      createdCategories?.set(action.name.trim().toLowerCase(), created.id);
      createdCategories?.set(created.name.trim().toLowerCase(), created.id);
      return `Created category **${created.name}** (\`${created.id}\`).`;
    }
    case "rename_channel": {
      const channel = guild.channels.cache.get(action.channelId);
      if (!channel || channel.type === ChannelType.GuildCategory) {
        throw new Error(`Channel ${action.channelId} not found.`);
      }
      const old = channel.name;
      await channel.setName(action.name);
      return `Renamed #${old} → **${action.name}**.`;
    }
    case "rename_category": {
      const channel = guild.channels.cache.get(action.categoryId);
      if (!channel || channel.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${action.categoryId} not found.`);
      }
      const old = channel.name;
      await channel.setName(action.name);
      return `Renamed category ${old} → **${action.name}**.`;
    }
    case "move_channel": {
      const channel = guild.channels.cache.get(action.channelId);
      if (
        !channel ||
        channel.type === ChannelType.GuildCategory ||
        channel.isThread()
      ) {
        throw new Error(`Channel ${action.channelId} not found.`);
      }
      if (!("setParent" in channel)) {
        throw new Error(`Channel ${action.channelId} cannot be moved.`);
      }
      await channel.setParent(action.parentId, { lockPermissions: false });
      const parentName = action.parentId
        ? guild.channels.cache.get(action.parentId)?.name ?? action.parentId
        : "uncategorized";
      return `Moved <#${channel.id}> under **${parentName}**.`;
    }
    case "set_topic": {
      const channel = guild.channels.cache.get(action.channelId);
      if (!channel || !("setTopic" in channel)) {
        throw new Error(`Channel ${action.channelId} does not support topics.`);
      }
      await (channel as TextChannel).setTopic(action.topic);
      return `Updated topic on <#${channel.id}>.`;
    }
    case "set_overwrites": {
      const channel = guild.channels.cache.get(action.channelId);
      if (!channel || !("permissionOverwrites" in channel)) {
        throw new Error(`Channel ${action.channelId} not found.`);
      }
      await applyOverwrites(
        channel as GuildChannel,
        action.overwrites,
        action.mode,
      );
      return `Updated permission overwrites on <#${channel.id}>.`;
    }
    case "delete_channel": {
      const channel = guild.channels.cache.get(action.channelId);
      if (!channel || channel.type === ChannelType.GuildCategory) {
        throw new Error(`Channel ${action.channelId} not found.`);
      }
      const name = channel.name;
      await channel.delete("AI server manager plan applied");
      return `Deleted channel **#${name}**.`;
    }
    case "delete_category": {
      const channel = guild.channels.cache.get(action.categoryId);
      if (!channel || channel.type !== ChannelType.GuildCategory) {
        throw new Error(`Category ${action.categoryId} not found.`);
      }
      const cat = channel as CategoryChannel;
      const name = cat.name;
      await cat.delete("AI server manager plan applied");
      return `Deleted category **${name}**.`;
    }
    default:
      throw new Error(`Not a channel action: ${action.type}`);
  }
}
