import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function csv(name: string): string[] {
  const value = optional(name);
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildId: optional("DISCORD_GUILD_ID"),
  googleAiApiKey: required("GOOGLE_AI_API_KEY"),
  geminiModel: optional("GEMINI_MODEL") ?? "gemini-2.0-flash",
  adminChannelId: optional("ADMIN_CHANNEL_ID"),
  allowedUserIds: csv("ALLOWED_USER_IDS"),
  allowedRoleIds: csv("ALLOWED_ROLE_IDS"),
  planTtlMs: Number(optional("PLAN_TTL_MS") ?? "600000"),
  maxActionsPerPlan: Number(optional("MAX_ACTIONS_PER_PLAN") ?? "25"),
} as const;
