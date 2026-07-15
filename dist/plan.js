"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planSchema = exports.actionSchema = void 0;
exports.formatPlan = formatPlan;
const zod_1 = require("zod");
exports.actionSchema = zod_1.z.discriminatedUnion('type', [
    zod_1.z.object({
        type: zod_1.z.literal('create_role'),
        name: zod_1.z.string().min(1),
        color: zod_1.z.string().optional(),
        mentionable: zod_1.z.boolean().optional(),
        hoist: zod_1.z.boolean().optional(),
        permissions: zod_1.z.array(zod_1.z.string()).optional(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('create_channel'),
        name: zod_1.z.string().min(1),
        channelType: zod_1.z.enum(['text', 'voice', 'category']),
        category: zod_1.z.string().optional(),
        topic: zod_1.z.string().optional(),
        private: zod_1.z.boolean().optional(),
        allowedRoles: zod_1.z.array(zod_1.z.string()).optional(),
        deniedRoles: zod_1.z.array(zod_1.z.string()).optional(),
    }),
    zod_1.z.object({
        type: zod_1.z.literal('assign_role'),
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
]);
exports.planSchema = zod_1.z.object({
    summary: zod_1.z.string().min(1),
    assumptions: zod_1.z.array(zod_1.z.string()).default([]),
    actions: zod_1.z.array(exports.actionSchema).min(1),
});
function formatPlan(plan) {
    const actionLines = plan.actions.map((action, index) => `${index + 1}. ${describeAction(action)}`);
    const assumptions = plan.assumptions.length
        ? `\nAssumptions:\n${plan.assumptions.map((item) => `- ${item}`).join('\n')}`
        : '';
    return [`Summary: ${plan.summary}`, 'Actions:', ...actionLines].join('\n') + assumptions;
}
function describeAction(action) {
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
