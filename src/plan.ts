import { z } from 'zod';

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_role'),
    name: z.string().min(1),
    color: z.string().optional(),
    mentionable: z.boolean().optional(),
    hoist: z.boolean().optional(),
    permissions: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('create_channel'),
    name: z.string().min(1),
    channelType: z.enum(['text', 'voice', 'category']),
    category: z.string().optional(),
    topic: z.string().optional(),
    private: z.boolean().optional(),
    allowedRoles: z.array(z.string()).optional(),
    deniedRoles: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('assign_role'),
    role: z.string().min(1),
    users: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal('set_channel_access'),
    channel: z.string().min(1),
    allowedRoles: z.array(z.string()).optional(),
    deniedRoles: z.array(z.string()).optional(),
    everyone: z.enum(['allow', 'deny']).optional(),
  }),
]);

export const planSchema = z.object({
  summary: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  actions: z.array(actionSchema).min(1),
});

export type PlannedAction = z.infer<typeof actionSchema>;
export type BotPlan = z.infer<typeof planSchema>;

export function formatPlan(plan: BotPlan): string {
  const actionLines = plan.actions.map((action, index) => `${index + 1}. ${describeAction(action)}`);
  const assumptions = plan.assumptions.length
    ? `\nAssumptions:\n${plan.assumptions.map((item) => `- ${item}`).join('\n')}`
    : '';

  return [`Summary: ${plan.summary}`, 'Actions:', ...actionLines].join('\n') + assumptions;
}

function describeAction(action: PlannedAction): string {
  switch (action.type) {
    case 'create_role':
      return `Create role ${action.name}`;
    case 'create_channel':
      return `Create ${action.channelType} channel ${action.name}`;
    case 'assign_role':
      return `Assign role ${action.role} to ${action.users.join(', ')}`;
    case 'set_channel_access':
      return `Set access for channel ${action.channel}`;
  }
}