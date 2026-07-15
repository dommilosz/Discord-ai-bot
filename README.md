# Discord Admin Bot

A Discord bot that lets privileged users manage their server using natural language prompts. Powered by any OpenAI-compatible AI endpoint (OpenAI, Cursor AI proxy, etc.).

## Features

- **Natural language commands** — describe what you want in plain English
- **AI planning with function calling** — the AI calls structured tools to build an exact plan before anything changes
- **Interactive confirmation** — every plan is shown with an Execute / Cancel button so admins can review before applying
- **Channels** — create / delete text channels, voice channels, and categories with configurable access
- **Roles** — create / delete roles with specific Discord permissions and custom colors
- **Access control** — set channels to public, admin-only, or role-specific visibility
- **Role assignment** — assign or remove roles from users by name or mention
- **Access restricted** — only server Administrators and members with configured roles can use the bot

## Quick start

### 1. Prerequisites

- Node.js 20 or newer
- A Discord application with a bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An API key for an OpenAI-compatible endpoint that supports **function calling** (e.g. OpenAI, Cursor AI proxy)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord developer portal |
| `CLIENT_ID` | Application (client) ID |
| `AI_API_KEY` | API key for the AI endpoint |
| `AI_BASE_URL` | Base URL of the API (default: `https://api.openai.com/v1`) |
| `AI_MODEL` | Model name (must support function calling, e.g. `gpt-4o`) |
| `GUILD_ID` | *(optional)* Single guild ID for faster command registration during development |
| `ADMIN_ROLE_IDS` | *(optional)* Comma-separated role IDs allowed to use the bot |

### 4. Enable required bot permissions

In the Discord Developer Portal → Bot:

- Enable the **Server Members Intent** (required to look up members by name)
- Under OAuth2 → URL Generator, select these scopes and permissions:

  **Scopes:** `bot`, `applications.commands`

  **Bot permissions:** Manage Channels, Manage Roles, View Channels, Read Message History

### 5. Build and run

```bash
npm run build
npm start
```

Or for development with auto-recompilation:

```bash
npm run dev
```

## Commands

| Command | Description |
|---|---|
| `/admin prompt:<text>` | Generate a plan from a prompt; click **Execute** to apply |
| `/admin prompt:<text> execute:true` | Apply changes immediately without preview |
| `/admin-list` | Show all channels and roles in the server |
| `/admin-help` | Show the help message and example prompts |

## Example prompts

```text
Create a public #general channel and a private #staff channel accessible only by admins
```

```text
Create a Moderator role with manage_messages, kick_members, and mute_members permissions, then assign it to @alice and @bob
```

```text
Create a Staff category. Inside it, add a #staff-chat channel (private, Moderator role only) and a #announcements channel (private, Moderator role only)
```

```text
Create a voice channel called Gaming Lounge with a 10-user limit
```

```text
Make #general public and #admin-chat visible only to admins
```

```text
Remove the Moderator role from @charlie
```

```text
Delete the old-bots channel and the Temp role
```

## Access control

The bot can be used by:

1. Any member with the Discord **Administrator** permission
2. Any member holding one of the role IDs listed in `ADMIN_ROLE_IDS`

To create a "Bot Manager" role that grants access:

1. Create the role in your server settings
2. Copy the role ID (right-click → Copy Role ID with Developer Mode enabled)
3. Add it to `ADMIN_ROLE_IDS` in your `.env`

## Supported actions

| Action | Details |
|---|---|
| `create_channel` | Text, voice, or category; public / private / role-restricted |
| `delete_channel` | Remove an existing channel |
| `create_role` | Custom permissions, color, hoist, mentionable |
| `delete_role` | Remove an existing role |
| `assign_role` | Give a role to one or more users |
| `remove_role` | Take a role away from one or more users |
| `set_channel_access` | Update visibility for an existing channel |

## Project structure

```
src/
  config.ts     — Environment variable loading
  plan.ts       — Action type schemas and plan formatting
  ai.ts         — AI function-calling planner
  executor.ts   — Discord API action execution
  index.ts      — Bot entry point, slash commands, button handling
```
