import { z } from "zod";

export const permissionFlagSchema = z.string().min(1);

export const overwriteSchema = z.object({
  id: z.string(),
  type: z.enum(["role", "member"]),
  allow: z.array(permissionFlagSchema).default([]),
  deny: z.array(permissionFlagSchema).default([]),
});

export const channelTypeSchema = z.enum([
  "text",
  "voice",
  "forum",
  "announcement",
]);

const createChannelAction = z.object({
  type: z.literal("create_channel"),
  name: z.string().min(1).max(100),
  channelType: channelTypeSchema.default("text"),
  parentId: z.string().nullable().optional(),
  topic: z.string().max(1024).nullable().optional(),
  overwrites: z.array(overwriteSchema).optional(),
});

const createCategoryAction = z.object({
  type: z.literal("create_category"),
  name: z.string().min(1).max(100),
  overwrites: z.array(overwriteSchema).optional(),
});

const renameChannelAction = z.object({
  type: z.literal("rename_channel"),
  channelId: z.string(),
  name: z.string().min(1).max(100),
});

const renameCategoryAction = z.object({
  type: z.literal("rename_category"),
  categoryId: z.string(),
  name: z.string().min(1).max(100),
});

const moveChannelAction = z.object({
  type: z.literal("move_channel"),
  channelId: z.string(),
  parentId: z.string().nullable(),
});

const setTopicAction = z.object({
  type: z.literal("set_topic"),
  channelId: z.string(),
  topic: z.string().max(1024),
});

const setOverwritesAction = z.object({
  type: z.literal("set_overwrites"),
  channelId: z.string(),
  overwrites: z.array(overwriteSchema),
  mode: z.enum(["replace", "merge"]).default("replace"),
});

const deleteChannelAction = z.object({
  type: z.literal("delete_channel"),
  channelId: z.string(),
});

const deleteCategoryAction = z.object({
  type: z.literal("delete_category"),
  categoryId: z.string(),
});

const createRoleAction = z.object({
  type: z.literal("create_role"),
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  permissions: z.array(permissionFlagSchema).optional(),
});

const editRoleAction = z.object({
  type: z.literal("edit_role"),
  roleId: z.string(),
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
});

const assignRoleAction = z.object({
  type: z.literal("assign_role"),
  roleId: z.string(),
  memberId: z.string(),
});

const removeRoleAction = z.object({
  type: z.literal("remove_role"),
  roleId: z.string(),
  memberId: z.string(),
});

const deleteRoleAction = z.object({
  type: z.literal("delete_role"),
  roleId: z.string(),
});

const checkAccessAction = z.object({
  type: z.literal("check_access"),
  subjectType: z.enum(["role", "member"]),
  subjectId: z.string(),
  channelId: z.string(),
  permissions: z.array(permissionFlagSchema).optional(),
});

const answerAction = z.object({
  type: z.literal("answer"),
  text: z.string().min(1),
});

const clarifyAction = z.object({
  type: z.literal("clarify"),
  text: z.string().min(1),
});

export const actionSchema = z.discriminatedUnion("type", [
  createChannelAction,
  createCategoryAction,
  renameChannelAction,
  renameCategoryAction,
  moveChannelAction,
  setTopicAction,
  setOverwritesAction,
  deleteChannelAction,
  deleteCategoryAction,
  createRoleAction,
  editRoleAction,
  assignRoleAction,
  removeRoleAction,
  deleteRoleAction,
  checkAccessAction,
  answerAction,
  clarifyAction,
]);

export type Action = z.infer<typeof actionSchema>;

export const IMMEDIATE_ACTION_TYPES = new Set([
  "check_access",
  "answer",
  "clarify",
]);

export function isImmediateAction(action: Action): boolean {
  return IMMEDIATE_ACTION_TYPES.has(action.type);
}

export function isMutatingAction(action: Action): boolean {
  return !isImmediateAction(action);
}

export const geminiPlanSchema = z.object({
  summary: z.string().default(""),
  immediate: z.array(actionSchema).optional().default([]),
  actions: z.array(actionSchema).default([]),
});

export type GeminiPlan = z.infer<typeof geminiPlanSchema>;
