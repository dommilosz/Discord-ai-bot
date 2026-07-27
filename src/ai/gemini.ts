import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import {
  geminiPlanSchema,
  isImmediateAction,
  isMutatingAction,
  type Action,
  type GeminiPlan,
} from "./schema.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import type { GuildSnapshot } from "../discord/snapshot.js";
import { roleHintsForPrompt } from "../discord/roleResolve.js";

const genAI = new GoogleGenerativeAI(config.googleAiApiKey);

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(raw);
}

/** Coerce common Gemini field aliases into our schema. */
function coerceAction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const a = { ...(raw as Record<string, unknown>) };

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (typeof a[k] === "string" && (a[k] as string).length > 0) {
        return a[k] as string;
      }
    }
    return undefined;
  };

  if (a.name == null) {
    const name = pick(
      "newName",
      "new_name",
      "channelName",
      "channel_name",
      "roleName",
      "role_name",
    );
    if (name !== undefined) a.name = name;
  }

  if (a.channelType == null) {
    const ct = pick("channel_type", "channelKind");
    if (ct !== undefined) a.channelType = ct;
  }

  if (a.parentId == null) {
    const parent = pick(
      "parent",
      "categoryId",
      "category_id",
      "categoryName",
      "category",
    );
    if (parent !== undefined) a.parentId = parent;
  }

  if (a.channelId == null) {
    const id = pick("channel_id");
    if (id !== undefined) a.channelId = id;
  }

  if (a.categoryId == null) {
    const id = pick("category_id");
    if (id !== undefined) a.categoryId = id;
  }

  if (a.roleId == null) {
    const id = pick("role_id");
    if (id !== undefined) a.roleId = id;
  }

  if (a.memberId == null) {
    const id = pick("member_id", "userId", "user_id");
    if (id !== undefined) a.memberId = id;
  }

  if (a.text == null) {
    const text = pick("message", "content", "question", "response");
    if (text !== undefined) a.text = text;
  }

  // Gemini often sends explicit null for optional fields — Zod optional() rejects null.
  for (const key of Object.keys(a)) {
    if (a[key] === null) {
      delete a[key];
    }
  }

  delete a.newName;
  delete a.new_name;

  return a;
}

function coercePlan(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const plan = { ...(json as Record<string, unknown>) };
  if (Array.isArray(plan.actions)) {
    plan.actions = plan.actions.map(coerceAction);
  }
  if (Array.isArray(plan.immediate)) {
    plan.immediate = plan.immediate.map(coerceAction);
  }
  return plan;
}

function normalizePlan(parsed: GeminiPlan): GeminiPlan {
  const immediate: Action[] = [];
  const actions: Action[] = [];

  for (const a of parsed.immediate ?? []) {
    if (isImmediateAction(a)) immediate.push(a);
    else actions.push(a);
  }
  for (const a of parsed.actions ?? []) {
    if (isImmediateAction(a)) immediate.push(a);
    else actions.push(a);
  }

  return {
    summary: parsed.summary || (actions.length ? "Proposed server changes" : ""),
    immediate,
    actions: actions.slice(0, config.maxActionsPerPlan),
  };
}

export type PlanRequest = {
  snapshot: GuildSnapshot;
  userPrompt: string;
  previousPlan?: { summary: string; actions: Action[] };
  followUp?: string;
};

export async function planWithGemini(req: PlanRequest): Promise<GeminiPlan> {
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const hints = roleHintsForPrompt(req.snapshot);

  const userPayload = {
    userPrompt: req.userPrompt,
    followUp: req.followUp ?? null,
    previousPlan: req.previousPlan ?? null,
    roleHints: hints,
    snapshot: req.snapshot,
  };

  const result = await model.generateContent([
    { text: SYSTEM_PROMPT },
    {
      text:
        "Plan the Discord changes for this request. Return JSON only.\n\n" +
        JSON.stringify(userPayload, null, 2),
    },
  ]);

  const text = result.response.text();
  let json: unknown;
  try {
    json = extractJson(text);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 400)}`);
  }

  const parsed = geminiPlanSchema.safeParse(coercePlan(json));
  if (!parsed.success) {
    throw new Error(
      `Gemini plan failed validation: ${parsed.error.message}\nRaw: ${text.slice(0, 500)}`,
    );
  }

  return normalizePlan(parsed.data);
}

export { isMutatingAction, isImmediateAction };
