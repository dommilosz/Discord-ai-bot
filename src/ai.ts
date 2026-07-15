import { BotConfig } from './config';
import { BotPlan, PlannedAction, formatPlan } from './plan';

// ──────────────────────────────────────────────────────────────────────────────
// Raw API types
// ──────────────────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface SystemMessage {
  role: 'system';
  content: string;
}

interface UserMessage {
  role: 'user';
  content: string;
}

interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCall[];
}

interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

// ──────────────────────────────────────────────────────────────────────────────
// Planning tools (each tool call from the AI becomes one planned action)
// ──────────────────────────────────────────────────────────────────────────────

const PLANNING_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_role',
      description:
        'Plan creating a new Discord role with optional color, permissions, and display settings.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Role name' },
          color: { type: 'string', description: 'Hex color like #FF5733 (optional)' },
          permissions: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Permission names: administrator, manage_channels, manage_roles, manage_messages, kick_members, ban_members, mute_members, move_members, manage_nicknames, view_audit_log, manage_guild, mention_everyone, manage_webhooks, send_messages, connect, speak, deafen_members',
          },
          hoist: { type: 'boolean', description: 'Show separately in member list (default true)' },
          mentionable: { type: 'boolean', description: 'Allow everyone to @mention this role' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_channel',
      description:
        'Plan creating a text, voice, or category channel. Set private:true and allowedRoles to restrict access.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Channel name (use hyphens, not spaces for text/voice)' },
          channelType: {
            type: 'string',
            enum: ['text', 'voice', 'category'],
            description: 'Type of channel',
          },
          category: { type: 'string', description: 'Name of the parent category (optional)' },
          topic: { type: 'string', description: 'Channel topic for text channels (optional)' },
          private: {
            type: 'boolean',
            description: 'When true, @everyone cannot see this channel',
          },
          allowedRoles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Role names granted view access when channel is private',
          },
          deniedRoles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Role names explicitly denied view access',
          },
          userLimit: {
            type: 'number',
            description: 'Max users for voice channels (0 = unlimited)',
          },
        },
        required: ['name', 'channelType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_role',
      description: 'Plan assigning a role to one or more users.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Role name' },
          users: {
            type: 'array',
            items: { type: 'string' },
            description: 'User names, display names, or Discord mention strings like <@123456789>',
          },
        },
        required: ['role', 'users'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_role',
      description: 'Plan removing a role from one or more users.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Role name' },
          users: {
            type: 'array',
            items: { type: 'string' },
            description: 'User names or display names',
          },
        },
        required: ['role', 'users'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_channel_access',
      description: 'Plan updating who can view an existing channel.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel name' },
          everyone: {
            type: 'string',
            enum: ['allow', 'deny'],
            description: "Set @everyone's access: allow = public, deny = private",
          },
          allowedRoles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Roles to grant view access',
          },
          deniedRoles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Roles to deny view access',
          },
        },
        required: ['channel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_channel',
      description: 'Plan deleting an existing channel.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Channel name to delete' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_role',
      description: 'Plan deleting an existing role.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Role name to delete' },
        },
        required: ['name'],
      },
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Tool call → PlannedAction conversion
// ──────────────────────────────────────────────────────────────────────────────

function toolCallToAction(name: string, args: Record<string, unknown>): PlannedAction | null {
  switch (name) {
    case 'create_role':
      return {
        type: 'create_role',
        name: String(args.name ?? ''),
        color: args.color ? String(args.color) : undefined,
        permissions: Array.isArray(args.permissions)
          ? (args.permissions as string[])
          : undefined,
        hoist: typeof args.hoist === 'boolean' ? args.hoist : undefined,
        mentionable: typeof args.mentionable === 'boolean' ? args.mentionable : undefined,
      };

    case 'create_channel':
      return {
        type: 'create_channel',
        name: String(args.name ?? ''),
        channelType: (args.channelType as 'text' | 'voice' | 'category') ?? 'text',
        category: args.category ? String(args.category) : undefined,
        topic: args.topic ? String(args.topic) : undefined,
        private: typeof args.private === 'boolean' ? args.private : undefined,
        allowedRoles: Array.isArray(args.allowedRoles)
          ? (args.allowedRoles as string[])
          : undefined,
        deniedRoles: Array.isArray(args.deniedRoles)
          ? (args.deniedRoles as string[])
          : undefined,
        userLimit: typeof args.userLimit === 'number' ? args.userLimit : undefined,
      };

    case 'assign_role':
      return {
        type: 'assign_role',
        role: String(args.role ?? ''),
        users: Array.isArray(args.users) ? (args.users as string[]) : [],
      };

    case 'remove_role':
      return {
        type: 'remove_role',
        role: String(args.role ?? ''),
        users: Array.isArray(args.users) ? (args.users as string[]) : [],
      };

    case 'set_channel_access':
      return {
        type: 'set_channel_access',
        channel: String(args.channel ?? ''),
        everyone: args.everyone as 'allow' | 'deny' | undefined,
        allowedRoles: Array.isArray(args.allowedRoles)
          ? (args.allowedRoles as string[])
          : undefined,
        deniedRoles: Array.isArray(args.deniedRoles)
          ? (args.deniedRoles as string[])
          : undefined,
      };

    case 'delete_channel':
      return { type: 'delete_channel', name: String(args.name ?? '') };

    case 'delete_role':
      return { type: 'delete_role', name: String(args.name ?? '') };

    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API helpers
// ──────────────────────────────────────────────────────────────────────────────

async function chatCompletions(
  config: BotConfig,
  messages: ChatMessage[],
  tools?: unknown[],
): Promise<AssistantMessage> {
  const url = `${config.aiBaseUrl.replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.aiModel,
    temperature: 0.2,
    messages,
  };

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AI API error ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: AssistantMessage }>;
  };

  const message = payload.choices?.[0]?.message;

  if (!message) {
    throw new Error('AI response missing message');
  }

  return message;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public interface
// ──────────────────────────────────────────────────────────────────────────────

interface PlannerContext {
  guildName: string;
  prompt: string;
  existingChannels: string[];
  existingRoles: string[];
  memberSample: string[];
}

const SYSTEM_PROMPT = [
  'You are a Discord guild administration planner.',
  'Call the planning tools to schedule each admin action the user requested.',
  'You may call multiple tools — one call per action.',
  "For a moderator role, include at least: manage_messages, kick_members, mute_members.",
  "For an admin role, include: administrator.",
  'When creating a private channel, set private:true and list roles in allowedRoles.',
  'Channel names must use hyphens instead of spaces.',
  'After you have called all necessary tools, produce a short plain-text summary of what will happen.',
  'Do not explain the individual actions; just write a high-level summary sentence.',
].join(' ');

async function runPlanningLoop(
  config: BotConfig,
  messages: ChatMessage[],
): Promise<{ actions: PlannedAction[]; summary: string }> {
  const actions: PlannedAction[] = [];
  let summary = '';
  const MAX_ITERATIONS = 15;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const message = await chatCompletions(config, messages, PLANNING_TOOLS);

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      summary = (message.content ?? '').trim();
      break;
    }

    const toolResults: ToolResultMessage[] = [];

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments) as Record<string, unknown>;
      } catch {
        // malformed JSON — skip
      }

      const action = toolCallToAction(call.function.name, args);
      if (action) {
        actions.push(action);
      }

      toolResults.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ result: 'noted' }),
      });
    }

    messages.push(...toolResults);
  }

  return { actions, summary };
}

export async function createPlan(config: BotConfig, context: PlannerContext): Promise<BotPlan> {
  const userContent = JSON.stringify({
    guildName: context.guildName,
    request: context.prompt,
    existingChannels: context.existingChannels,
    existingRoles: context.existingRoles,
    knownMembers: context.memberSample,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const { actions, summary } = await runPlanningLoop(config, messages);

  if (actions.length === 0) {
    throw new Error('The AI did not produce any planned actions for that request.');
  }

  return {
    summary: summary || `Apply ${actions.length} change(s) to ${context.guildName}.`,
    actions,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Refinement — re-plan with a follow-up prompt layered on top of an existing plan
// ──────────────────────────────────────────────────────────────────────────────

const REFINEMENT_SYSTEM_PROMPT = [
  'You are updating a previously planned set of Discord admin actions.',
  'You will be shown the original request, the current plan, and a follow-up refinement request.',
  'Produce a COMPLETE updated plan: keep unchanged actions, and add / remove / modify as the follow-up requests.',
  'Call the same planning tools as before — one call per action in the final plan.',
  'After calling all tools, write a short plain-text summary of what the complete updated plan does.',
].join(' ');

export interface RefinementContext extends PlannerContext {
  currentPlan: BotPlan;
  followupPrompt: string;
}

export async function createRefinedPlan(
  config: BotConfig,
  context: RefinementContext,
): Promise<BotPlan> {
  const userContent = JSON.stringify({
    guildName: context.guildName,
    originalRequest: context.prompt,
    currentPlan: formatPlan(context.currentPlan),
    followupRequest: context.followupPrompt,
    existingChannels: context.existingChannels,
    existingRoles: context.existingRoles,
    knownMembers: context.memberSample,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: REFINEMENT_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const { actions, summary } = await runPlanningLoop(config, messages);

  if (actions.length === 0) {
    throw new Error('The AI did not produce any actions for the refined plan.');
  }

  return {
    summary: summary || `Apply ${actions.length} change(s) to ${context.guildName}.`,
    actions,
  };
}
