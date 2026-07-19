import type { Guild } from "discord.js";
import { ChannelType } from "discord.js";
import type { Action } from "../ai/schema.js";
import { executeChannelAction } from "../discord/channels.js";
import { executeRoleAction } from "../discord/roles.js";
import { checkAccess } from "../discord/access.js";
import { botHighestRolePosition } from "../discord/permissions.js";
import type { GuildSnapshot } from "../discord/snapshot.js";
import {
  isResolvableParent,
  orderActionsForExecution,
  resolveParentAgainstSnapshot,
} from "../discord/parentResolve.js";
import { config } from "../config.js";

const CHANNEL_ACTIONS = new Set([
  "create_channel",
  "create_category",
  "rename_channel",
  "rename_category",
  "move_channel",
  "set_topic",
  "set_overwrites",
  "delete_channel",
  "delete_category",
]);

const ROLE_ACTIONS = new Set([
  "create_role",
  "edit_role",
  "assign_role",
  "remove_role",
  "delete_role",
]);

function allChannelIds(snapshot: GuildSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const cat of snapshot.categories) {
    ids.add(cat.id);
    for (const ch of cat.channels) ids.add(ch.id);
  }
  for (const ch of snapshot.uncategorized) ids.add(ch.id);
  return ids;
}

function allRoleIds(snapshot: GuildSnapshot): Set<string> {
  return new Set(snapshot.roles.map((r) => r.id));
}

export function validateMutatingActions(
  actions: Action[],
  snapshot: GuildSnapshot,
  guild: Guild,
): { ok: true; actions: Action[] } | { ok: false; reason: string } {
  if (actions.length > config.maxActionsPerPlan) {
    return {
      ok: false,
      reason: `Too many actions (max ${config.maxActionsPerPlan}).`,
    };
  }

  const channelIds = allChannelIds(snapshot);
  const roleIds = allRoleIds(snapshot);
  const botPos = botHighestRolePosition(guild);

  // Normalize parentId name → existing category snowflake when possible
  const normalized = actions.map((action) => {
    if (action.type === "create_channel" && action.parentId) {
      const resolved = resolveParentAgainstSnapshot(action.parentId, snapshot);
      return { ...action, parentId: resolved };
    }
    if (action.type === "move_channel" && action.parentId) {
      const resolved = resolveParentAgainstSnapshot(action.parentId, snapshot);
      return { ...action, parentId: resolved ?? action.parentId };
    }
    return action;
  });

  for (const action of normalized) {
    switch (action.type) {
      case "rename_channel":
      case "move_channel":
      case "set_topic":
      case "set_overwrites":
      case "delete_channel":
        if (action.type === "move_channel") {
          if (!channelIds.has(action.channelId)) {
            return {
              ok: false,
              reason: `Unknown channel id ${action.channelId} for ${action.type}.`,
            };
          }
          if (
            action.parentId &&
            !isResolvableParent(action.parentId, snapshot, normalized)
          ) {
            return {
              ok: false,
              reason: `Unknown parent category ${action.parentId}.`,
            };
          }
          break;
        }
        if (!channelIds.has(action.channelId)) {
          return {
            ok: false,
            reason: `Unknown channel id ${action.channelId} for ${action.type}.`,
          };
        }
        break;
      case "rename_category":
      case "delete_category":
        if (!channelIds.has(action.categoryId)) {
          return {
            ok: false,
            reason: `Unknown category id ${action.categoryId}.`,
          };
        }
        break;
      case "create_channel":
        if (
          action.parentId &&
          !isResolvableParent(action.parentId, snapshot, normalized)
        ) {
          return {
            ok: false,
            reason: `Unknown parent category ${action.parentId}. Create the category in this plan first, or use an existing category id/name.`,
          };
        }
        if (action.overwrites) {
          for (const ow of action.overwrites) {
            if (ow.type === "role" && !roleIds.has(ow.id)) {
              return {
                ok: false,
                reason: `Unknown overwrite role ${ow.id}.`,
              };
            }
          }
        }
        break;
      case "create_category":
        if (action.overwrites) {
          for (const ow of action.overwrites) {
            if (ow.type === "role" && !roleIds.has(ow.id)) {
              return {
                ok: false,
                reason: `Unknown overwrite role ${ow.id}.`,
              };
            }
          }
        }
        break;
      case "edit_role":
      case "delete_role":
      case "assign_role":
      case "remove_role": {
        const roleId = action.roleId;
        if (!roleIds.has(roleId)) {
          return { ok: false, reason: `Unknown role id ${roleId}.` };
        }
        const role = snapshot.roles.find((r) => r.id === roleId);
        if (role?.managed && action.type !== "remove_role") {
          return {
            ok: false,
            reason: `Role @${role.name} is managed.`,
          };
        }
        if (role && role.position >= botPos) {
          return {
            ok: false,
            reason: `Role @${role.name} is above the bot in the hierarchy.`,
          };
        }
        break;
      }
      default:
        break;
    }
  }

  return { ok: true, actions: orderActionsForExecution(normalized) };
}

export async function executeMutatingActions(
  guild: Guild,
  actions: Action[],
): Promise<string[]> {
  const results: string[] = [];
  /** Maps lowercase category name → created Discord id */
  const createdCategories = new Map<string, string>();

  for (const action of orderActionsForExecution(actions)) {
    try {
      let next = action;

      if (
        (action.type === "create_channel" || action.type === "move_channel") &&
        action.parentId
      ) {
        const key = action.parentId.trim().toLowerCase();
        const fromCreated = createdCategories.get(key);
        if (fromCreated) {
          next = { ...action, parentId: fromCreated };
        } else {
          const existing = guild.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildCategory &&
              c.name.toLowerCase() === key,
          );
          if (existing) {
            next = { ...action, parentId: existing.id };
          }
        }
      }

      if (CHANNEL_ACTIONS.has(next.type)) {
        const result = await executeChannelAction(guild, next, createdCategories);
        results.push(result);
      } else if (ROLE_ACTIONS.has(next.type)) {
        results.push(await executeRoleAction(guild, next));
      } else {
        results.push(`Skipped unsupported action ${next.type}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`Failed **${action.type}**: ${msg}`);
    }
  }
  return results;
}

export async function executeImmediateCheckAccess(
  guild: Guild,
  action: Extract<Action, { type: "check_access" }>,
): Promise<string> {
  return checkAccess(guild, action);
}
