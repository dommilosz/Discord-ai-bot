import type { Action } from "../ai/schema.js";
import type { GuildSnapshot } from "../discord/snapshot.js";

function roleName(snapshot: GuildSnapshot | undefined, id: string): string {
  const role = snapshot?.roles.find((r) => r.id === id);
  if (role) return `@${role.name}`;
  if (snapshot && id === snapshot.everyoneRoleId) return "@everyone";
  return `role:${id}`;
}

function channelName(snapshot: GuildSnapshot | undefined, id: string): string {
  for (const cat of snapshot?.categories ?? []) {
    if (cat.id === id) return cat.name;
    const ch = cat.channels.find((c) => c.id === id);
    if (ch) return `#${ch.name}`;
  }
  const unc = snapshot?.uncategorized.find((c) => c.id === id);
  if (unc) return `#${unc.name}`;
  // parent may be a pending category name from the same plan
  if (id && !/^\d{17,20}$/.test(id)) return id;
  return `#${id}`;
}

function describeOverwrites(
  snapshot: GuildSnapshot | undefined,
  overwrites: { id: string; type: string; allow: string[]; deny: string[] }[],
): string {
  if (!overwrites.length) return "";
  return overwrites
    .map((ow) => {
      const who =
        ow.type === "role" ? roleName(snapshot, ow.id) : `user:${ow.id}`;
      const parts: string[] = [];
      if (ow.allow?.length) parts.push(`allow ${ow.allow.join(", ")}`);
      if (ow.deny?.length) parts.push(`deny ${ow.deny.join(", ")}`);
      return `${who} (${parts.join("; ")})`;
    })
    .join("; ");
}

export function formatActionLine(
  action: Action,
  index: number,
  snapshot?: GuildSnapshot,
): string {
  switch (action.type) {
    case "create_channel": {
      const ow = action.overwrites
        ? ` — ${describeOverwrites(snapshot, action.overwrites)}`
        : "";
      const parent = action.parentId
        ? ` under ${channelName(snapshot, action.parentId)}`
        : "";
      return `${index}. Create **${action.channelType}** channel \`#${action.name}\`${parent}${ow}`;
    }
    case "create_category":
      return `${index}. Create category **${action.name}**`;
    case "rename_channel":
      return `${index}. Rename ${channelName(snapshot, action.channelId)} → \`#${action.name}\``;
    case "rename_category":
      return `${index}. Rename category ${channelName(snapshot, action.categoryId)} → **${action.name}**`;
    case "move_channel":
      return `${index}. Move ${channelName(snapshot, action.channelId)} → ${action.parentId ? channelName(snapshot, action.parentId) : "uncategorized"}`;
    case "set_topic":
      return `${index}. Set topic on ${channelName(snapshot, action.channelId)}`;
    case "set_overwrites":
      return `${index}. Set overwrites on ${channelName(snapshot, action.channelId)} (${action.mode}): ${describeOverwrites(snapshot, action.overwrites)}`;
    case "delete_channel":
      return `${index}. Delete ${channelName(snapshot, action.channelId)}`;
    case "delete_category":
      return `${index}. Delete category ${channelName(snapshot, action.categoryId)}`;
    case "create_role":
      return `${index}. Create role **@${action.name}**${action.color ? ` color \`${action.color}\`` : ""}`;
    case "edit_role":
      return `${index}. Edit role ${roleName(snapshot, action.roleId)}`;
    case "assign_role":
      return `${index}. Assign ${roleName(snapshot, action.roleId)} to <@${action.memberId}>`;
    case "remove_role":
      return `${index}. Remove ${roleName(snapshot, action.roleId)} from <@${action.memberId}>`;
    case "delete_role":
      return `${index}. Delete role ${roleName(snapshot, action.roleId)}`;
    case "check_access":
      return `${index}. Check access`;
    case "answer":
      return `${index}. Answer: ${action.text}`;
    case "clarify":
      return `${index}. Clarify: ${action.text}`;
    default:
      return `${index}. ${(action as Action).type}`;
  }
}

export function formatActionsList(
  actions: Action[],
  snapshot?: GuildSnapshot,
): string {
  if (actions.length === 0) return "_No mutating changes proposed._";
  return actions
    .map((a, i) => formatActionLine(a, i + 1, snapshot))
    .join("\n");
}
