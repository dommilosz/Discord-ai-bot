"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
require("dotenv/config");
function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function parseCsv(value) {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function loadConfig() {
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
