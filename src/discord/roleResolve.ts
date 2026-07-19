import type { GuildSnapshot, SnapshotRole } from "./snapshot.js";

const ADMIN_NAME_PATTERNS = [
  /^admin(istrator)?s?$/i,
  /^server[\s_-]?admin/i,
  /^owner$/i,
];

const MOD_NAME_PATTERNS = [
  /^mod(erator)?s?$/i,
  /^staff$/i,
  /^helpers?$/i,
];

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}

export function findAdminRoles(snapshot: GuildSnapshot): SnapshotRole[] {
  const byName = snapshot.roles.filter(
    (r) => r.id !== snapshot.everyoneRoleId && matchesAny(r.name, ADMIN_NAME_PATTERNS),
  );
  if (byName.length > 0) return byName;

  return snapshot.roles.filter(
    (r) =>
      r.id !== snapshot.everyoneRoleId &&
      !r.managed &&
      r.permissions.includes("Administrator"),
  );
}

export function findModeratorRoles(snapshot: GuildSnapshot): SnapshotRole[] {
  const byName = snapshot.roles.filter(
    (r) => r.id !== snapshot.everyoneRoleId && matchesAny(r.name, MOD_NAME_PATTERNS),
  );
  if (byName.length > 0) return byName;

  return snapshot.roles.filter(
    (r) =>
      r.id !== snapshot.everyoneRoleId &&
      !r.managed &&
      !r.permissions.includes("Administrator") &&
      (r.permissions.includes("ManageGuild") ||
        r.permissions.includes("ModerateMembers") ||
        r.permissions.includes("ManageMessages") ||
        r.permissions.includes("KickMembers") ||
        r.permissions.includes("BanMembers")),
  );
}

export function roleHintsForPrompt(snapshot: GuildSnapshot): string {
  const admins = findAdminRoles(snapshot);
  const mods = findModeratorRoles(snapshot);
  return [
    `everyoneRoleId: ${snapshot.everyoneRoleId}`,
    `Likely admin roles: ${admins.map((r) => `${r.name} (${r.id})`).join(", ") || "none found"}`,
    `Likely moderator roles: ${mods.map((r) => `${r.name} (${r.id})`).join(", ") || "none found"}`,
  ].join("\n");
}
