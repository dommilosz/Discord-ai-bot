import {
  MessageFlags,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import { planWithGemini } from "../ai/gemini.js";
import { buildSnapshot } from "../discord/snapshot.js";
import { callerCanApply } from "../discord/permissions.js";
import {
  buildAppliedEmbed,
  buildCancelledEmbed,
  buildFollowUpModal,
  buildReviewComponents,
  buildReviewEmbed,
  parsePlanCustomId,
  runImmediateActions,
} from "../plans/review.js";
import {
  deletePlan,
  getPlan,
  setPlanMessageId,
  updatePlan,
} from "../plans/store.js";
import {
  executeImmediateCheckAccess,
  executeMutatingActions,
  validateMutatingActions,
} from "../plans/execute.js";

async function assertRequester(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  requesterId: string,
): Promise<boolean> {
  if (interaction.user.id !== requesterId) {
    await interaction.reply({
      content: "Only the person who created this plan can use these controls.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

async function handleApply(interaction: ButtonInteraction, planId: string) {
  const plan = getPlan(planId);
  if (!plan) {
    await interaction.reply({
      content: "This plan expired or was already handled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await assertRequester(interaction, plan.requesterId))) return;
  if (!interaction.guild) return;

  const member =
    interaction.guild.members.cache.get(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id));

  const perm = callerCanApply(member, plan.actions);
  if (!perm.ok) {
    await interaction.reply({
      content: perm.reason,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const snapshot = buildSnapshot(interaction.guild, member, plan.channelId);
  const validated = validateMutatingActions(
    plan.actions,
    snapshot,
    interaction.guild,
  );
  if (!validated.ok) {
    await interaction.editReply({
      content: `Re-validation failed: ${validated.reason}`,
      embeds: [],
      components: [],
    });
    deletePlan(planId);
    return;
  }

  const results = await executeMutatingActions(
    interaction.guild,
    validated.actions,
  );
  deletePlan(planId);

  await interaction.editReply({
    content: null,
    embeds: [buildAppliedEmbed(results, plan.summary)],
    components: [],
  });
}

async function handleCancel(interaction: ButtonInteraction, planId: string) {
  const plan = getPlan(planId);
  if (!plan) {
    await interaction.reply({
      content: "This plan expired or was already handled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await assertRequester(interaction, plan.requesterId))) return;

  deletePlan(planId);
  await interaction.update({
    content: null,
    embeds: [buildCancelledEmbed()],
    components: [],
  });
}

async function handleFollowUpOpen(
  interaction: ButtonInteraction,
  planId: string,
) {
  const plan = getPlan(planId);
  if (!plan) {
    await interaction.reply({
      content: "This plan expired or was already handled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await assertRequester(interaction, plan.requesterId))) return;
  await interaction.showModal(buildFollowUpModal(planId));
}

async function handleRevise(
  interaction: ModalSubmitInteraction,
  planId: string,
) {
  const plan = getPlan(planId);
  if (!plan) {
    await interaction.reply({
      content: "This plan expired or was already handled.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await assertRequester(interaction, plan.requesterId))) return;
  if (!interaction.guild) return;

  const followUp = interaction.fields.getTextInputValue("followup");
  await interaction.deferUpdate();

  const member =
    interaction.guild.members.cache.get(interaction.user.id) ??
    (await interaction.guild.members.fetch(interaction.user.id));

  const snapshot = buildSnapshot(interaction.guild, member, plan.channelId);

  let next;
  try {
    next = await planWithGemini({
      snapshot,
      userPrompt: plan.summary,
      previousPlan: { summary: plan.summary, actions: plan.actions },
      followUp,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.followUp({
      content: `Failed to revise plan: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const validated = validateMutatingActions(
    next.actions,
    snapshot,
    interaction.guild,
  );
  if (!validated.ok) {
    await interaction.followUp({
      content: `Revised plan invalid: ${validated.reason}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const immediateText = await runImmediateActions(next.immediate, {
    checkAccess: (a) => executeImmediateCheckAccess(interaction.guild!, a),
  });

  if (validated.actions.length === 0) {
    deletePlan(planId);
    await interaction.editReply({
      content: immediateText || next.summary || "Nothing to apply.",
      embeds: [],
      components: [],
    });
    return;
  }

  const updated = updatePlan(planId, {
    summary: next.summary,
    actions: validated.actions,
  });
  if (!updated) return;

  setPlanMessageId(updated.planId, interaction.message!.id);

  await interaction.editReply({
    content: null,
    embeds: [
      buildReviewEmbed(updated, snapshot, {
        immediateText: immediateText || undefined,
        title: `Proposed changes (${updated.actions.length})`,
      }),
    ],
    components: buildReviewComponents(updated.planId),
  });
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "manage") {
      const { executeManageCommand } = await import("../commands/manage.js");
      await executeManageCommand(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    const parsed = parsePlanCustomId(interaction.customId);
    if (!parsed) return;
    if (parsed.kind === "apply") await handleApply(interaction, parsed.planId);
    else if (parsed.kind === "cancel")
      await handleCancel(interaction, parsed.planId);
    else if (parsed.kind === "followup")
      await handleFollowUpOpen(interaction, parsed.planId);
    return;
  }

  if (interaction.isModalSubmit()) {
    const parsed = parsePlanCustomId(interaction.customId);
    if (!parsed || parsed.kind !== "revise") return;
    await handleRevise(interaction, parsed.planId);
  }
}
