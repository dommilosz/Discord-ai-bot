import {
  PermissionFlagsBits,
  type OverwriteResolvable,
  type PermissionResolvable,
} from "discord.js";

const FLAG_MAP: Record<string, bigint> = {
  CreateInstantInvite: PermissionFlagsBits.CreateInstantInvite,
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers,
  Administrator: PermissionFlagsBits.Administrator,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageGuild: PermissionFlagsBits.ManageGuild,
  AddReactions: PermissionFlagsBits.AddReactions,
  ViewAuditLog: PermissionFlagsBits.ViewAuditLog,
  PrioritySpeaker: PermissionFlagsBits.PrioritySpeaker,
  Stream: PermissionFlagsBits.Stream,
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  SendTTSMessages: PermissionFlagsBits.SendTTSMessages,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
  AttachFiles: PermissionFlagsBits.AttachFiles,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  MentionEveryone: PermissionFlagsBits.MentionEveryone,
  UseExternalEmojis: PermissionFlagsBits.UseExternalEmojis,
  ViewGuildInsights: PermissionFlagsBits.ViewGuildInsights,
  Connect: PermissionFlagsBits.Connect,
  Speak: PermissionFlagsBits.Speak,
  MuteMembers: PermissionFlagsBits.MuteMembers,
  DeafenMembers: PermissionFlagsBits.DeafenMembers,
  MoveMembers: PermissionFlagsBits.MoveMembers,
  UseVAD: PermissionFlagsBits.UseVAD,
  ChangeNickname: PermissionFlagsBits.ChangeNickname,
  ManageNicknames: PermissionFlagsBits.ManageNicknames,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
  ManageEmojisAndStickers: PermissionFlagsBits.ManageGuildExpressions,
  ManageGuildExpressions: PermissionFlagsBits.ManageGuildExpressions,
  UseApplicationCommands: PermissionFlagsBits.UseApplicationCommands,
  RequestToSpeak: PermissionFlagsBits.RequestToSpeak,
  ManageEvents: PermissionFlagsBits.ManageEvents,
  ManageThreads: PermissionFlagsBits.ManageThreads,
  CreatePublicThreads: PermissionFlagsBits.CreatePublicThreads,
  CreatePrivateThreads: PermissionFlagsBits.CreatePrivateThreads,
  UseExternalStickers: PermissionFlagsBits.UseExternalStickers,
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
  UseEmbeddedActivities: PermissionFlagsBits.UseEmbeddedActivities,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  ViewCreatorMonetizationAnalytics:
    PermissionFlagsBits.ViewCreatorMonetizationAnalytics,
  UseSoundboard: PermissionFlagsBits.UseSoundboard,
  CreateGuildExpressions: PermissionFlagsBits.CreateGuildExpressions,
  CreateEvents: PermissionFlagsBits.CreateEvents,
  UseExternalSounds: PermissionFlagsBits.UseExternalSounds,
  SendVoiceMessages: PermissionFlagsBits.SendVoiceMessages,
  SendPolls: PermissionFlagsBits.SendPolls,
  UseExternalApps: PermissionFlagsBits.UseExternalApps,
};

const REVERSE_MAP = new Map<bigint, string>();
for (const [name, bit] of Object.entries(FLAG_MAP)) {
  if (!REVERSE_MAP.has(bit)) {
    REVERSE_MAP.set(bit, name);
  }
}

export function flagsToNames(bitfield: bigint | Readonly<bigint>): string[] {
  const bits = BigInt(bitfield);
  const names: string[] = [];
  for (const [bit, name] of REVERSE_MAP) {
    if ((bits & bit) === bit) {
      names.push(name);
    }
  }
  return names.sort();
}

export function namesToBitfield(names: string[]): bigint {
  let bits = 0n;
  for (const name of names) {
    const bit = FLAG_MAP[name] ?? FLAG_MAP[normalizeFlagName(name)];
    if (bit !== undefined) {
      bits |= bit;
    }
  }
  return bits;
}

function normalizeFlagName(name: string): string {
  return name.replace(/[\s_]/g, "");
}

export function namesToPermissionResolvable(
  names: string[],
): PermissionResolvable {
  return namesToBitfield(names);
}

export type OverwriteInput = {
  id: string;
  type: "role" | "member";
  allow?: string[];
  deny?: string[];
};

export function toOverwriteResolvable(
  overwrites: OverwriteInput[],
): OverwriteResolvable[] {
  return overwrites.map((o) => ({
    id: o.id,
    type: o.type === "member" ? 1 : 0,
    allow: namesToBitfield(o.allow ?? []),
    deny: namesToBitfield(o.deny ?? []),
  }));
}

export function parseColor(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const named: Record<string, number> = {
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    yellow: 0xffff00,
    orange: 0xffa500,
    purple: 0x800080,
    pink: 0xffc0cb,
    cyan: 0x00ffff,
    white: 0xffffff,
    black: 0x000000,
    gold: 0xffd700,
    teal: 0x008080,
  };
  const lower = input.trim().toLowerCase();
  if (named[lower] !== undefined) return named[lower];
  const hex = lower.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return Number.parseInt(hex, 16);
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const expanded = hex
      .split("")
      .map((c) => c + c)
      .join("");
    return Number.parseInt(expanded, 16);
  }
  return undefined;
}

export function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
