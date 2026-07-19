import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { handleSlashManage } from "../handlers/manageFlow.js";

export const manageCommand = new SlashCommandBuilder()
  .setName("manage")
  .setDescription("Plan channel/role changes with AI (review before apply)")
  .addStringOption((opt) =>
    opt
      .setName("prompt")
      .setDescription("What should change? e.g. create voice channel voice-69")
      .setRequired(true)
      .setMaxLength(2000),
  );

export async function executeManageCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await handleSlashManage(interaction);
}
