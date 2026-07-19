# AI Discord Server Manager

TypeScript Discord bot that uses **Google AI Studio (Gemini)** to plan channel and role changes from natural language. You always get a **change summary** first — **Apply**, **Follow-up**, or **Cancel** before anything mutates.

## Features

- Create text / voice / forum / announcement channels with permission overwrites
- Create categories, rename, move, set topics, delete (on Apply)
- Create color roles, assign/remove roles
- Access questions (e.g. “can @student see this channel?”) answered immediately via Discord permission math
- Live guild snapshot (channels, roles, overwrites) injected into every Gemini call
- Review UI: summary embed + Apply / Follow-up / Cancel

## Setup

### 1. Discord application

1. Create an app at [Discord Developer Portal](https://discord.com/developers/applications)
2. Bot → Reset Token → copy into `DISCORD_TOKEN`
3. Copy Application ID into `DISCORD_CLIENT_ID`
4. Enable **Privileged Gateway Intents**: Server Members Intent, Message Content Intent
5. OAuth2 → URL Generator → scopes `bot` + `applications.commands`
6. Bot permissions: **Manage Channels**, **Manage Roles**, View Channels, Send Messages, Embed Links, Read Message History
7. Invite the bot; put its highest role **above** roles it should manage

### 2. Google AI Studio

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Set `GOOGLE_AI_API_KEY`

### 3. Install & run

```bash
cp .env.example .env
# fill in .env

npm install
npm run register
npm run dev
```

Set `DISCORD_GUILD_ID` for fast guild slash-command registration during development.

Optional:

- `ADMIN_CHANNEL_ID` — only respond to @mentions in this channel (`/manage` works anywhere the user has permission)
- `ALLOWED_USER_IDS` / `ALLOWED_ROLE_IDS` — comma-separated allowlist (if set, replaces the default Manage Channels/Roles gate)
- `GEMINI_MODEL` — default `gemini-2.0-flash`
- `PLAN_TTL_MS` — pending plan lifetime (default 10 minutes)

## Usage

### Slash command

```
/manage prompt: create channels "channel1", "channel2", "channel3" with access to channel1 for admins only, channel2 for moderators, channel3 for everyone
```

The bot replies with a **Proposed changes** embed. Then:

| Button | Effect |
|--------|--------|
| **Apply** | Execute the plan (re-validated against a fresh snapshot) |
| **Follow-up** | Modal to refine (“make channel2 private…”); regenerates the summary |
| **Cancel** | Discard the plan |

Only the requester can use the buttons.

### @mention

In the admin channel (or any channel if `ADMIN_CHANNEL_ID` is unset):

```
@Bot create voice channel "voice 69"
@Bot create color role "red" with red color
@Bot assign "red" role to myself
@Bot assign "red" role to @mateusz
@Bot can @student see this channel?
```

## Example prompts

- Create forum channel `"forum channel"`
- Create voice channel `"voice 69"`
- Create channels under category Community with different role access
- Create new color role `"red"` with red color / `#FF0000`
- Assign / remove roles
- Can @role see this channel?
- What channels are under Community?

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run with file watch |
| `npm start` | Run once |
| `npm run register` | Register `/manage` slash command |
| `npm run typecheck` | TypeScript check |

## Safety

- Mutations never run until **Apply**
- Plans expire after `PLAN_TTL_MS`
- Managed / higher roles cannot be edited or assigned
- Action IDs must exist in the live snapshot
- Max 10 mutating actions per plan
