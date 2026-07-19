import {
  PermissionFlagsBits,
  type GuildMember,
  type Guild,
} from "discord.js";
import { config } from "../config.js";
import type { Action } from "../ai/schema.js";
import { isMutatingAction } from "../ai/schema.js";

export function isCallerAllowed(member: GuildMember): boolean {
  if (config.allowedUserIds.length > 0 || config.allowedRoleIds.length > 0) {
    if (config.allowedUserIds.includes(member.id)) return true;
    if (member.roles.cache.some((r) => config.allowedRoleIds.includes(r.id))) {
      return true;
    }
    return false;
  }

  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.permissions.has(PermissionFlagsBits.ManageRoles)
  );
}

export function actionsNeedManageChannels(actions: Action[]): boolean {
  return actions.some((a) =>
    [
      "create_channel",
      "create_category",
      "rename_channel",
      "rename_category",
      "move_channel",
      "set_topic",
      "set_overwrites",
      "delete_channel",
      "delete_category",
    ].includes(a.type),
  );
}

export function actionsNeedManageRoles(actions: Action[]): boolean {
  return actions.some((a) =>
    [
      "create_role",
      "edit_role",
      "assign_role",
      "remove_role",
      "delete_role",
    ].includes(a.type),
  );
}

export function callerCanApply(
  member: GuildMember,
  actions: Action[],
): { ok: true } | { ok: false; reason: string } {
  if (!isCallerAllowed(member)) {
    return { ok: false, reason: "You are not allowed to use this bot." };
  }

  const mutating = actions.filter(isMutatingAction);
  if (mutating.length === 0) return { ok: true };

  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

  if (actionsNeedManageChannels(mutating) && !isAdmin) {
    if (!member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return {
        ok: false,
        reason: "You need Manage Channels to apply these changes.",
      };
    }
  }

  if (actionsNeedManageRoles(mutating) && !isAdmin) {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return {
        ok: false,
        reason: "You need Manage Roles to apply these changes.",
      };
    }
  }

  return { ok: true };
}

export function botCanManage(guild: Guild): {
  ok: true;
} | { ok: false; reason: string } {
  const me = guild.members.me;
  if (!me) {
    return { ok: false, reason: "Bot member not available in this guild." };
  }
  if (
    !me.permissions.has(PermissionFlagsBits.ManageChannels) &&
    !me.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return {
      ok: false,
      reason: "Bot is missing Manage Channels permission.",
    };
  }
  return { ok: true };
}

export function botHighestRolePosition(guild: Guild): number {
  return guild.members.me?.roles.highest.position ?? 0;
}
