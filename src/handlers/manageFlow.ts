import type {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  Message,
  TextBasedChannel,
} from "discord.js";
import { planWithGemini } from "../ai/gemini.js";
import { buildSnapshot, type MentionContext } from "../discord/snapshot.js";
import {
  resolveMentionsFromInteraction,
  resolveMentionsFromMessage,
  stripBotMention,
} from "../discord/mentions.js";
import { isCallerAllowed } from "../discord/permissions.js";
import {
  buildReviewMessage,
  runImmediateActions,
} from "../plans/review.js";
import { createPlan, setPlanMessageId } from "../plans/store.js";
import {
  executeImmediateCheckAccess,
  validateMutatingActions,
} from "../plans/execute.js";
import { config } from "../config.js";

type ReplyPayload = {
  content?: string | null;
  embeds?: ReturnType<typeof buildReviewMessage>["embeds"];
  components?: ReturnType<typeof buildReviewMessage>["components"];
};

async function ensureMember(
  guild: Guild,
  userId: string,
): Promise<GuildMember> {
  return (
    guild.members.cache.get(userId) ?? (await guild.members.fetch(userId))
  );
}

export async function handleManagePrompt(opts: {
  guild: Guild;
  member: GuildMember;
  channel: TextBasedChannel & { id: string };
  prompt: string;
  mentions: MentionContext;
  reply: (payload: ReplyPayload) => Promise<{ id: string }>;
  deferOrThinking?: () => Promise<void>;
}): Promise<void> {
  if (!isCallerAllowed(opts.member)) {
    await opts.reply({
      content: "You are not allowed to use this bot.",
      embeds: [],
      components: [],
    });
    return;
  }

  await opts.deferOrThinking?.();

  const snapshot = buildSnapshot(
    opts.guild,
    opts.member,
    opts.channel.id,
    opts.mentions,
  );

  let plan;
  try {
    plan = await planWithGemini({
      snapshot,
      userPrompt: opts.prompt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await opts.reply({
      content: `Failed to plan changes: ${msg}`,
      embeds: [],
      components: [],
    });
    return;
  }

  const validated = validateMutatingActions(plan.actions, snapshot, opts.guild);
  if (!validated.ok) {
    await opts.reply({
      content: `Plan validation failed: ${validated.reason}`,
      embeds: [],
      components: [],
    });
    return;
  }

  const immediateText = await runImmediateActions(plan.immediate, {
    checkAccess: (a) => executeImmediateCheckAccess(opts.guild, a),
  });

  if (validated.actions.length === 0) {
    await opts.reply({
      content: immediateText || plan.summary || "Nothing to do.",
      embeds: [],
      components: [],
    });
    return;
  }

  const pending = createPlan({
    guildId: opts.guild.id,
    requesterId: opts.member.id,
    channelId: opts.channel.id,
    summary: plan.summary,
    actions: validated.actions,
  });

  const payload = buildReviewMessage(
    pending,
    snapshot,
    immediateText || undefined,
  );
  const sent = await opts.reply(payload);
  setPlanMessageId(pending.planId, sent.id);
}

export async function handleSlashManage(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: "This command only works in a server channel.",
      ephemeral: true,
    });
    return;
  }

  const prompt = interaction.options.getString("prompt", true);
  const member = await ensureMember(interaction.guild, interaction.user.id);
  const mentions = resolveMentionsFromInteraction(
    interaction,
    interaction.guild,
    prompt,
  );

  let deferred = false;
  await handleManagePrompt({
    guild: interaction.guild,
    member,
    channel: interaction.channel as TextBasedChannel & { id: string },
    prompt,
    mentions,
    deferOrThinking: async () => {
      await interaction.deferReply();
      deferred = true;
    },
    reply: async (payload) => {
      if (deferred) {
        const msg = await interaction.editReply(payload);
        return { id: msg.id };
      }
      const msg = await interaction.reply({
        content: payload.content ?? undefined,
        embeds: payload.embeds,
        components: payload.components,
        fetchReply: true,
      });
      return { id: msg.id };
    },
  });
}

export async function handleMentionMessage(message: Message): Promise<void> {
  if (!message.guild || !message.channel.isTextBased()) return;
  if (message.author.bot) return;
  if (!message.client.user) return;
  if (!message.mentions.has(message.client.user)) return;

  if (
    config.adminChannelId &&
    message.channel.id !== config.adminChannelId
  ) {
    return;
  }

  const prompt = stripBotMention(message.content, message.client.user.id);
  if (!prompt) {
    await message.reply(
      "Tell me what to change, e.g. create a voice channel named lounge.",
    );
    return;
  }

  const member = await ensureMember(message.guild, message.author.id);
  const mentions = resolveMentionsFromMessage(message);

  const thinking = await message.reply("Planning changes…");

  await handleManagePrompt({
    guild: message.guild,
    member,
    channel: message.channel as TextBasedChannel & { id: string },
    prompt,
    mentions,
    reply: async (payload) => {
      const msg = await thinking.edit(payload);
      return { id: msg.id };
    },
  });
}
