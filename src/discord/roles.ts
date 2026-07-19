import type { Guild } from "discord.js";
import type { Action } from "../ai/schema.js";
import {
  namesToPermissionResolvable,
  parseColor,
} from "./overwrites.js";
import { botHighestRolePosition } from "./permissions.js";

export async function executeRoleAction(
  guild: Guild,
  action: Action,
): Promise<string> {
  const botPos = botHighestRolePosition(guild);

  switch (action.type) {
    case "create_role": {
      const color = parseColor(action.color);
      const role = await guild.roles.create({
        name: action.name,
        color: color,
        hoist: action.hoist,
        mentionable: action.mentionable,
        permissions: action.permissions
          ? namesToPermissionResolvable(action.permissions)
          : undefined,
        reason: "AI server manager plan applied",
      });
      return `Created role **@${role.name}** (\`${role.id}\`)${color !== undefined ? ` color \`#${color.toString(16).padStart(6, "0")}\`` : ""}.`;
    }
    case "edit_role": {
      const role = guild.roles.cache.get(action.roleId);
      if (!role) throw new Error(`Role ${action.roleId} not found.`);
      if (role.managed) throw new Error(`Role @${role.name} is managed and cannot be edited.`);
      if (role.position >= botPos) {
        throw new Error(`Role @${role.name} is above or equal to the bot's highest role.`);
      }
      const color = parseColor(action.color);
      await role.edit({
        name: action.name,
        color: color,
        hoist: action.hoist,
        mentionable: action.mentionable,
        reason: "AI server manager plan applied",
      });
      return `Updated role **@${role.name}**.`;
    }
    case "assign_role": {
      const role = guild.roles.cache.get(action.roleId);
      if (!role) throw new Error(`Role ${action.roleId} not found.`);
      if (role.managed) throw new Error(`Role @${role.name} is managed.`);
      if (role.position >= botPos) {
        throw new Error(`Role @${role.name} is above or equal to the bot's highest role.`);
      }
      const member =
        guild.members.cache.get(action.memberId) ??
        (await guild.members.fetch(action.memberId));
      await member.roles.add(role, "AI server manager plan applied");
      return `Assigned **@${role.name}** to **${member.user.username}**.`;
    }
    case "remove_role": {
      const role = guild.roles.cache.get(action.roleId);
      if (!role) throw new Error(`Role ${action.roleId} not found.`);
      if (role.position >= botPos) {
        throw new Error(`Role @${role.name} is above or equal to the bot's highest role.`);
      }
      const member =
        guild.members.cache.get(action.memberId) ??
        (await guild.members.fetch(action.memberId));
      await member.roles.remove(role, "AI server manager plan applied");
      return `Removed **@${role.name}** from **${member.user.username}**.`;
    }
    case "delete_role": {
      const role = guild.roles.cache.get(action.roleId);
      if (!role) throw new Error(`Role ${action.roleId} not found.`);
      if (role.managed) throw new Error(`Role @${role.name} is managed and cannot be deleted.`);
      if (role.id === guild.id) throw new Error("Cannot delete @everyone.");
      if (role.position >= botPos) {
        throw new Error(`Role @${role.name} is above or equal to the bot's highest role.`);
      }
      const name = role.name;
      await role.delete("AI server manager plan applied");
      return `Deleted role **@${name}**.`;
    }
    default:
      throw new Error(`Not a role action: ${action.type}`);
  }
}
