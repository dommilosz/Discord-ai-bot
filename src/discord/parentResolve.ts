import type { Action } from "../ai/schema.js";
import type { GuildSnapshot } from "./snapshot.js";

const SNOWFLAKE = /^\d{17,20}$/;

export function findCategoryIdByName(
  snapshot: GuildSnapshot,
  name: string,
): string | undefined {
  const needle = name.trim().toLowerCase();
  return snapshot.categories.find((c) => c.name.toLowerCase() === needle)?.id;
}

/** Categories that will exist after this plan's create_category actions. */
export function pendingCategoryNames(actions: Action[]): Set<string> {
  const names = new Set<string>();
  for (const a of actions) {
    if (a.type === "create_category") {
      names.add(a.name.trim().toLowerCase());
    }
  }
  return names;
}

/**
 * Whether parentId is a valid existing category id/name, or a category
 * created earlier/elsewhere in this same plan (by name).
 */
export function isResolvableParent(
  parentId: string,
  snapshot: GuildSnapshot,
  actions: Action[],
): boolean {
  const channelIds = new Set<string>();
  for (const cat of snapshot.categories) {
    channelIds.add(cat.id);
  }
  if (channelIds.has(parentId)) return true;
  if (findCategoryIdByName(snapshot, parentId)) return true;
  if (pendingCategoryNames(actions).has(parentId.trim().toLowerCase())) {
    return true;
  }
  return false;
}

export function resolveParentAgainstSnapshot(
  parentId: string | null | undefined,
  snapshot: GuildSnapshot,
): string | null | undefined {
  if (parentId == null) return parentId;
  if (SNOWFLAKE.test(parentId)) {
    const exists = snapshot.categories.some((c) => c.id === parentId);
    if (exists) return parentId;
  }
  const byName = findCategoryIdByName(snapshot, parentId);
  return byName ?? parentId;
}

/** Put create_category / create_role before creates that may depend on them. */
export function orderActionsForExecution(actions: Action[]): Action[] {
  const rank = (a: Action): number => {
    if (a.type === "create_category") return 0;
    if (a.type === "create_role") return 1;
    if (a.type === "create_channel") return 2;
    return 3;
  };
  return [...actions].sort((a, b) => rank(a) - rank(b));
}
