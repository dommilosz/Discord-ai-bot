"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlan = createPlan;
const plan_1 = require("./plan");
async function createPlan(config, context) {
    const response = await fetch(`${config.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.aiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: config.aiModel,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: [
                        'You are a Discord guild automation planner.',
                        'Return only JSON that matches this shape: { summary: string, assumptions: string[], actions: [...] }.',
                        'Only use the allowed action types: create_role, create_channel, assign_role, set_channel_access.',
                        'Prefer explicit role and user identifiers when available.',
                        'If the prompt is ambiguous, make conservative assumptions and list them in assumptions.',
                        'Do not include markdown or extra commentary.',
                    ].join(' '),
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        guildName: context.guildName,
                        prompt: context.prompt,
                        availableRoles: context.roleOptions,
                    }),
                },
            ],
        }),
    });
    if (!response.ok) {
        throw new Error(`AI request failed with status ${response.status}`);
    }
    const payload = (await response.json());
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('AI response did not include a plan');
    }
    const parsed = JSON.parse(content);
    return plan_1.planSchema.parse(parsed);
}
