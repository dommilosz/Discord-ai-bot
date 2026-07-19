import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { config } from "./config.js";
import { handleInteraction } from "./handlers/interactions.js";
import { handleMentionMessage } from "./handlers/manageFlow.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction).catch((err) => {
    console.error("Interaction error:", err);
  });
});

client.on(Events.MessageCreate, (message) => {
  void handleMentionMessage(message).catch((err) => {
    console.error("Mention handler error:", err);
  });
});

client.login(config.discordToken).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
