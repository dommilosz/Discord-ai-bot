import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────────
// Action schemas
// ──────────────────────────────────────────────────────────────────────────────

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_role'),
    name: z.string().min(1),
    color: z.string().optional(),
    permissions: z.array(z.string()).optional(),
    mentionable: z.boolean().optional(),
    hoist: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('create_channel'),
    name: z.string().min(1),
    channelType: z.enum(['text', 'voice', 'category']),
    category: z.string().optional(),
    topic: z.string().optional(),
    /** When true, @everyone cannot view this channel */
    private: z.boolean().optional(),
    /** Roles explicitly granted view access */
    allowedRoles: z.array(z.string()).optional(),
    /** Roles explicitly denied view access */
    deniedRoles: z.array(z.string()).optional(),
    userLimit: z.number().optional(),
  }),
  z.object({
    type: z.literal('assign_role'),
    role: z.string().min(1),
    users: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal('remove_role'),
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
  z.object({
    type: z.literal('delete_channel'),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('delete_role'),
    name: z.string().min(1),
  }),
]);

export const planSchema = z.object({
  summary: z.string().min(1),
  actions: z.array(actionSchema).min(1),
});

export type PlannedAction = z.infer<typeof actionSchema>;
export type BotPlan = z.infer<typeof planSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Plan formatting
// ──────────────────────────────────────────────────────────────────────────────

export function formatPlan(plan: BotPlan): string {
  const actionLines = plan.actions.map((action, index) => `${index + 1}. ${describeAction(action)}`);

  return [`**Summary:** ${plan.summary}`, '', '**Actions:**', ...actionLines].join('\n');
}

function describeAction(action: PlannedAction): string {
  switch (action.type) {
    case 'create_role': {
      const perms = action.permissions?.length ? action.permissions.join(', ') : 'no extra permissions';
      const color = action.color ? ` • color: ${action.color}` : '';
      return `Create role **@${action.name}** (${perms}${color})`;
    }
    case 'create_channel': {
      const access = action.private ? '🔒 private' : '🌐 public';
      const allowed = action.allowedRoles?.length ? ` • visible to: ${action.allowedRoles.join(', ')}` : '';
      const denied = action.deniedRoles?.length ? ` • hidden from: ${action.deniedRoles.join(', ')}` : '';
      const limit = action.userLimit ? ` • limit: ${action.userLimit}` : '';
      const category = action.category ? ` in **${action.category}**` : '';
      return `Create ${action.channelType} channel **#${action.name}**${category} [${access}${allowed}${denied}${limit}]`;
    }
    case 'assign_role':
      return `Assign **@${action.role}** → ${action.users.join(', ')}`;
    case 'remove_role':
      return `Remove **@${action.role}** from ${action.users.join(', ')}`;
    case 'set_channel_access':
      return `Update access for **#${action.channel}**`;
    case 'delete_channel':
      return `Delete channel **#${action.name}** ⚠️`;
    case 'delete_role':
      return `Delete role **@${action.name}** ⚠️`;
  }
}
