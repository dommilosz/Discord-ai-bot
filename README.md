# Discord AI Bot

Discord bot that lets privileged users describe admin tasks in natural language and applies them to a server after validation.

## What it can do

- Create text, voice, and category channels
- Create roles and assign them to users
- Set channel visibility for everyone, admins, or selected roles
- Preview a plan before execution

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and fill in the values.
4. Build with `npm run build`.
5. Start with `npm start`.

## Environment

- `DISCORD_TOKEN` - bot token from the Discord developer portal
- `CLIENT_ID` - application client ID
- `GUILD_ID` - optional guild ID for fast command registration during development
- `ADMIN_ROLE_IDS` - comma-separated role IDs allowed to use the bot
- `AI_API_KEY` - API key for an OpenAI-compatible endpoint or Cursor-compatible proxy
- `AI_BASE_URL` - base URL for the AI endpoint, defaults to `https://api.openai.com/v1`
- `AI_MODEL` - model name to use for planning

## Example

Use the `/admin-plan` command with a prompt such as:

```text
Create a public general channel, a private staff channel for admins and moderators, create a Moderators role, and assign it to @alex and @sam.
```

The bot will return a plan and ask for confirmation before it changes the guild.