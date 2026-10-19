import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { getAllSlashCommandsJSON } from './commands/index.js';

async function deploy() {
  const token = config.discord.token;
  const clientId = config.discord.clientId;

  if (!token) {
    console.error('❌ Erro: DISCORD_TOKEN não foi configurado no arquivo .env!');
    process.exit(1);
  }

  if (!clientId) {
    console.error('❌ Erro: DISCORD_CLIENT_ID não encontrado. Defina-o no .env!');
    process.exit(1);
  }

  const slashCommands = getAllSlashCommandsJSON();
  const rest = new REST({ version: '10' }).setToken(token);

  console.log(`📡 Registrando ${slashCommands.length} comandos de barra (/) no Discord...`);
  console.log(`🤖 Bot Application ID: ${clientId}`);

  try {
    // Se passar um ID de servidor via argumento de linha de comando: node src/deploy-commands.js 123456789
    const guildId = process.argv[2] || process.env.DISCORD_GUILD_ID;

    if (guildId) {
      console.log(`🌐 Registrando instantaneamente no servidor (Guild ID: ${guildId})...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: slashCommands,
      });
      console.log(`✅ Comandos registrados no servidor com sucesso!`);
    } else {
      console.log(`🌍 Registrando comandos globalmente...`);
      await rest.put(Routes.applicationCommands(clientId), {
        body: slashCommands,
      });
      console.log(`✅ Comandos globais registrados com sucesso!`);
    }

    console.log('\nComandos ativos:');
    slashCommands.forEach((c) => console.log(` • /${c.name} - ${c.description}`));
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
}

deploy();
