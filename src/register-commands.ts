import "dotenv/config";
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { manageCommand } from "./commands/manage.js";

const rest = new REST({ version: "10" }).setToken(config.discordToken);
const body = [manageCommand.toJSON()];

async function main() {
  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(
        config.discordClientId,
        config.discordGuildId,
      ),
      { body },
    );
    console.log(
      `Registered guild commands for guild ${config.discordGuildId}`,
    );
  } else {
    await rest.put(Routes.applicationCommands(config.discordClientId), {
      body,
    });
    console.log("Registered global application commands");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
