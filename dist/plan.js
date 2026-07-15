"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planSchema = exports.actionSchema = void 0;
exports.formatPlan = formatPlan;
const zod_1 = require("zod");
// ──────────────────────────────────────────────────────────────────────────────
// Action schemas
// ──────────────────────────────────────────────────────────────────────────────
exports.actionSchema = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({
        type: zod_1.z.literal('create_role'),
        name: zod_1.z.string().min(1),
        color: zod_1.z.string().optional(),
        permissions: zod_1.z.array(zod_1.z.string()).optional(),
        mentionable: zod_1.z.boolean().optional(),
        hoist: zod_1.z.boolean().optional(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('create_channel'),
        name: zod_1.z.string().min(1),
        channelType: zod_1.z.enum(['text', 'voice', 'category']),
        category: zod_1.z.string().optional(),
        topic: zod_1.z.string().optional(),
        /** When true, @everyone cannot view this channel */
        private: zod_1.z.boolean().optional(),
        /** Roles explicitly granted view access */
        allowedRoles: zod_1.z.array(zod_1.z.string()).optional(),
        /** Roles explicitly denied view access */
        deniedRoles: zod_1.z.array(zod_1.z.string()).optional(),
        userLimit: zod_1.z.number().optional(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('assign_role'),
        role: zod_1.z.string().min(1),
        users: zod_1.z.array(zod_1.z.string()).min(1),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('remove_role'),
        role: zod_1.z.string().min(1),
        users: zod_1.z.array(zod_1.z.string()).min(1),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('set_channel_access'),
        channel: zod_1.z.string().min(1),
        allowedRoles: zod_1.z.array(zod_1.z.string()).optional(),
        deniedRoles: zod_1.z.array(zod_1.z.string()).optional(),
        everyone: zod_1.z.enum(['allow', 'deny']).optional(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('delete_channel'),
        name: zod_1.z.string().min(1),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('delete_role'),
        name: zod_1.z.string().min(1),
    }),
]);
exports.planSchema = zod_1.z.object({
    summary: zod_1.z.string().min(1),
    actions: zod_1.z.array(exports.actionSchema).min(1),
});
// ──────────────────────────────────────────────────────────────────────────────
// Plan formatting
// ──────────────────────────────────────────────────────────────────────────────
function formatPlan(plan) {
    const actionLines = plan.actions.map((action, index) => `${index + 1}. ${describeAction(action)}`);
    return [`**Summary:** ${plan.summary}`, '', '**Actions:**', ...actionLines].join('\n');
}
function describeAction(action) {
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
