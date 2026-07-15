import 'dotenv/config';

export interface BotConfig {
  discordToken: string;
  clientId: string;
  guildId?: string;
  adminRoleIds: string[];
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(): BotConfig {
  return {
    discordToken: requiredEnv('DISCORD_TOKEN'),
    clientId: requiredEnv('CLIENT_ID'),
    guildId: process.env.GUILD_ID?.trim() || undefined,
    adminRoleIds: parseCsv(process.env.ADMIN_ROLE_IDS),
    aiApiKey: requiredEnv('AI_API_KEY'),
    aiBaseUrl: process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    aiModel: process.env.AI_MODEL?.trim() || 'gpt-4.1-mini',
  };
}