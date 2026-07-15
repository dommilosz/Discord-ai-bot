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

/** Emoji prefix for each action type shown in the plan preview. */
function actionEmoji(action: PlannedAction): string {
  switch (action.type) {
    case 'create_role':    return '🎭';
    case 'create_channel': return action.channelType === 'voice' ? '🔊' : action.channelType === 'category' ? '📁' : '💬';
    case 'assign_role':    return '👤';
    case 'remove_role':    return '👤';
    case 'set_channel_access': return '🔒';
    case 'delete_channel': return '🗑️';
    case 'delete_role':    return '🗑️';
  }
}

function describeAction(action: PlannedAction): string {
  switch (action.type) {
    case 'create_role': {
      const perms = action.permissions?.length
        ? `permissions: \`${action.permissions.join('`, `')}\``
        : 'no extra permissions';
      const extras: string[] = [perms];
      if (action.color) extras.push(`color: ${action.color}`);
      if (action.hoist === false) extras.push('not hoisted');
      if (action.mentionable) extras.push('@mentionable');
      return `Create role **@${action.name}** — ${extras.join(' • ')}`;
    }

    case 'create_channel': {
      const typeLabel = { text: 'text channel', voice: 'voice channel', category: 'category' }[action.channelType];
      const parts: string[] = [];
      if (action.private) {
        parts.push('🔒 private');
        if (action.allowedRoles?.length) parts.push(`visible to: ${action.allowedRoles.map((r) => `@${r}`).join(', ')}`);
      } else {
        parts.push('🌐 public');
      }
      if (action.deniedRoles?.length) parts.push(`hidden from: ${action.deniedRoles.map((r) => `@${r}`).join(', ')}`);
      if (action.userLimit) parts.push(`limit: ${action.userLimit} users`);
      if (action.topic) parts.push(`topic: "${action.topic}"`);
      const location = action.category ? ` in **${action.category}**` : '';
      return `Create ${typeLabel} **#${action.name}**${location} [${parts.join(' • ')}]`;
    }

    case 'assign_role':
      return `Give **@${action.role}** to: ${action.users.join(', ')}`;

    case 'remove_role':
      return `Remove **@${action.role}** from: ${action.users.join(', ')}`;

    case 'set_channel_access': {
      const parts: string[] = [];
      if (action.everyone === 'allow') parts.push('make public');
      if (action.everyone === 'deny') parts.push('hide from everyone');
      if (action.allowedRoles?.length) parts.push(`allow: ${action.allowedRoles.map((r) => `@${r}`).join(', ')}`);
      if (action.deniedRoles?.length) parts.push(`deny: ${action.deniedRoles.map((r) => `@${r}`).join(', ')}`);
      return `Update **#${action.channel}** access — ${parts.join(' • ') || 'no change'}`;
    }

    case 'delete_channel':
      return `⚠️ Delete channel **#${action.name}** (permanent)`;

    case 'delete_role':
      return `⚠️ Delete role **@${action.name}** (permanent)`;
  }
}

/**
 * Render a plan as a Discord-formatted string ready to send as a message.
 * Optionally annotates it as a refined version.
 */
export function formatPlan(plan: BotPlan, refinedFrom?: string): string {
  const header = refinedFrom
    ? `> ♻️ **Refined plan** *(follow-up: "${refinedFrom}")*`
    : '> 📋 **Pending plan — review before applying**';

  const summary = `> ${plan.summary}`;

  const actionCount = `**${plan.actions.length} change${plan.actions.length === 1 ? '' : 's'} will be made:**`;

  const actionLines = plan.actions.map((action, i) => {
    const emoji = actionEmoji(action);
    return `\`${i + 1}.\` ${emoji} ${describeAction(action)}`;
  });

  return [header, summary, '', actionCount, ...actionLines].join('\n');
}
