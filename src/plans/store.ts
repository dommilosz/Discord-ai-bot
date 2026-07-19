import { randomUUID } from "node:crypto";
import type { Action } from "../ai/schema.js";
import { config } from "../config.js";

export type PendingPlan = {
  planId: string;
  guildId: string;
  requesterId: string;
  channelId: string;
  messageId: string | null;
  summary: string;
  actions: Action[];
  createdAt: number;
  expiresAt: number;
};

const plans = new Map<string, PendingPlan>();

export function createPlan(input: {
  guildId: string;
  requesterId: string;
  channelId: string;
  summary: string;
  actions: Action[];
}): PendingPlan {
  const now = Date.now();
  const plan: PendingPlan = {
    planId: randomUUID(),
    guildId: input.guildId,
    requesterId: input.requesterId,
    channelId: input.channelId,
    messageId: null,
    summary: input.summary,
    actions: input.actions,
    createdAt: now,
    expiresAt: now + config.planTtlMs,
  };
  plans.set(plan.planId, plan);
  return plan;
}

export function getPlan(planId: string): PendingPlan | undefined {
  const plan = plans.get(planId);
  if (!plan) return undefined;
  if (Date.now() > plan.expiresAt) {
    plans.delete(planId);
    return undefined;
  }
  return plan;
}

export function setPlanMessageId(planId: string, messageId: string): void {
  const plan = plans.get(planId);
  if (plan) plan.messageId = messageId;
}

export function updatePlan(
  planId: string,
  patch: { summary: string; actions: Action[] },
): PendingPlan | undefined {
  const plan = getPlan(planId);
  if (!plan) return undefined;
  plan.summary = patch.summary;
  plan.actions = patch.actions;
  plan.expiresAt = Date.now() + config.planTtlMs;
  return plan;
}

export function deletePlan(planId: string): void {
  plans.delete(planId);
}

export function replacePlan(
  oldPlanId: string,
  next: Omit<PendingPlan, "planId" | "createdAt" | "expiresAt"> & {
    summary: string;
    actions: Action[];
  },
): PendingPlan {
  deletePlan(oldPlanId);
  return createPlan(next);
}
