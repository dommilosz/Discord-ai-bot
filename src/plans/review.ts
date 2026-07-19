import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type InteractionReplyOptions,
  type MessageEditOptions,
} from "discord.js";
import type { Action } from "../ai/schema.js";
import type { GuildSnapshot } from "../discord/snapshot.js";
import type { PendingPlan } from "./store.js";
import { formatActionsList } from "./summary.js";

export function planApplyId(planId: string): string {
  return `plan:apply:${planId}`;
}
export function planCancelId(planId: string): string {
  return `plan:cancel:${planId}`;
}
export function planFollowUpId(planId: string): string {
  return `plan:followup:${planId}`;
}
export function planReviseId(planId: string): string {
  return `plan:revise:${planId}`;
}

export function parsePlanCustomId(
  customId: string,
): { kind: "apply" | "cancel" | "followup" | "revise"; planId: string } | null {
  const parts = customId.split(":");
  if (parts[0] !== "plan" || parts.length < 3) return null;
  const kind = parts[1];
  const planId = parts.slice(2).join(":");
  if (
    kind !== "apply" &&
    kind !== "cancel" &&
    kind !== "followup" &&
    kind !== "revise"
  ) {
    return null;
  }
  return { kind, planId };
}

export function buildReviewEmbed(
  plan: PendingPlan,
  snapshot?: GuildSnapshot,
  extras?: { immediateText?: string; title?: string },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(extras?.title ?? "Proposed changes")
    .setColor(0x5865f2)
    .setDescription(
      [
        plan.summary || "Review the changes below, then Apply, Follow-up, or Cancel.",
        "",
        `**Actions (${plan.actions.length})**`,
        formatActionsList(plan.actions, snapshot),
      ].join("\n"),
    )
    .setFooter({
      text: `Plan ${plan.planId.slice(0, 8)} · expires in 10 min · only you can approve`,
    })
    .setTimestamp(new Date(plan.createdAt));

  if (extras?.immediateText) {
    embed.addFields({
      name: "Answer",
      value: extras.immediateText.slice(0, 1024),
    });
  }

  return embed;
}

export function buildReviewComponents(planId: string, disabled = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(planApplyId(planId))
        .setLabel("Apply")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(planFollowUpId(planId))
        .setLabel("Follow-up")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(planCancelId(planId))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  ];
}

export function buildReviewMessage(
  plan: PendingPlan,
  snapshot?: GuildSnapshot,
  immediateText?: string,
): InteractionReplyOptions & MessageEditOptions {
  return {
    embeds: [
      buildReviewEmbed(plan, snapshot, {
        immediateText,
        title:
          plan.actions.length > 0
            ? `Proposed changes (${plan.actions.length})`
            : "Response",
      }),
    ],
    components:
      plan.actions.length > 0 ? buildReviewComponents(plan.planId) : [],
  };
}

export function buildFollowUpModal(planId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(planReviseId(planId))
    .setTitle("Follow-up prompt")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("followup")
          .setLabel("What should change?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder(
            'e.g. make channel2 private to mods only, and name it "staff-chat"',
          ),
      ),
    );
}

export function buildAppliedEmbed(
  results: string[],
  summary: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Changes applied")
    .setColor(0x57f287)
    .setDescription(
      [summary, "", "**Results**", ...results.map((r) => `• ${r}`)].join("\n"),
    )
    .setTimestamp();
}

export function buildCancelledEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Cancelled")
    .setColor(0x99aab5)
    .setDescription("Pending plan discarded. No changes were made.")
    .setTimestamp();
}

export async function runImmediateActions(
  actions: Action[],
  handlers: {
    checkAccess: (a: Extract<Action, { type: "check_access" }>) => Promise<string>;
  },
): Promise<string> {
  const parts: string[] = [];
  for (const action of actions) {
    if (action.type === "answer" || action.type === "clarify") {
      parts.push(action.text);
    } else if (action.type === "check_access") {
      parts.push(await handlers.checkAccess(action));
    }
  }
  return parts.join("\n\n");
}
