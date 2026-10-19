import {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
} from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { config } from './config.js';
import { commands } from './commands/index.js';
import { storageService } from './services/storageService.js';
import { pubgService } from './services/pubgService.js';
import { rankingAutoUpdateService } from './services/rankingAutoUpdateService.js';

// Prevenção global contra encerramento inesperado do processo
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught Exception:', error);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// Evento quando o bot fica online
client.once(Events.ClientReady, async (c) => {
  console.log(`\n=================================================`);
  console.log(`🔥 ${config.clan.name} Bot v2.0 está online!`);
  console.log(`🤖 Conectado como: ${c.user.tag} (ID: ${c.user.id})`);
  console.log(`⚙️  Plataforma padrão: ${config.pubg.defaultPlatform.toUpperCase()}`);
  console.log(`⚡ Prefixo de comandos: ${config.discord.prefix}`);
  console.log(`📌 Comandos carregados: ${commands.size}`);
  console.log(`=================================================\n`);

  c.user.setActivity('PUBG com o Clã', { type: ActivityType.Playing });

  // Entra no canal de voz fixo configurado
  entrarNoCanal(c);

  // Inicia serviço de ranking fixo automático (atualiza a cada 1 minuto)
  rankingAutoUpdateService.init(c);

  // Inicia aquecimento suave de cache em segundo plano (evita rate limits quando alguém usar /ranking)
  iniciarAquecimentoDeCache();
});

/**
 * Entra no canal de voz, mutado e ensurdecido, e reconecta se cair.
 */
async function entrarNoCanal(c) {
  const channelId = config.discord.voiceChannelId;
  if (!channelId) return;

  try {
    const channel = await c.channels.fetch(channelId).catch(() => null);
    if (!channel?.isVoiceBased?.()) {
      console.warn(`[Voz] Canal ${channelId} não encontrado ou não é canal de voz.`);
      return;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfMute: true,   // microfone desligado
      selfDeaf: true,   // áudio desligado
    });

    console.log(`[Voz] Conectando ao canal: ${channel.name}`);

    // Reconecta automaticamente se for desconectado
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
        setTimeout(() => entrarNoCanal(c), 4_000);
      }
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`[Voz] Conectado e ativo no canal: ${channel.name}`);
    });

    connection.on('error', (err) => {
      console.warn('[Voz] Alerta de conexão de voz:', err.message);
    });

  } catch (err) {
    console.warn('[Voz] Aviso ao entrar no canal:', err.message);
    setTimeout(() => entrarNoCanal(c), 15_000);
  }
}

// Reconecta se o bot for expulso do canal por alguém
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const voiceId = config.discord.voiceChannelId;
  if (!voiceId) return;
  if (newState.member?.user.id !== client.user?.id) return;
  if (oldState.channelId === voiceId && newState.channelId === null) {
    console.log('[Voz] Bot desconectado do canal — agendando reconexão...');
    setTimeout(() => entrarNoCanal(client), 4_000);
  }
});

/**
 * Aquecimento periódico e compassado de cache:
 * Atualiza 1 jogador a cada 8 segundos em segundo plano, respeitando 100% o limite de 10 req/min da PUBG API.
 * Garante que /ranking responda instantaneamente (<100ms) sem erros.
 */
function iniciarAquecimentoDeCache() {
  const syncClanStats = async () => {
    try {
      const members = storageService.getAllMembers();
      if (members.length === 0) return;

      console.log(`[Sync] Verificando cache de ${members.length} membros do clã...`);
      for (const member of members) {
        if (!member.pubgId) continue;
        const cacheKey = `stats:${member.platform || config.pubg.defaultPlatform}:${member.pubgId}:lifetime`;
        // Só busca se estiver expirado no cache
        if (!pubgService.getFromCache(cacheKey)) {
          try {
            await pubgService.getPlayerStats(member.pubgId, member.platform, null, false);
            console.log(`[Sync] Cache atualizado para ${member.pubgNick}`);
          } catch (err) {
            // Continua sem falhar
          }
          // Espera 8 segundos entre requisições para nunca estourar a cota de 10/min
          await new Promise((r) => setTimeout(r, 8_000));
        }
      }
    } catch (err) {
      console.warn('[Sync] Falha no ciclo de sincronização:', err.message);
    }
  };

  // Primeira execução após 10 segundos de online
  setTimeout(syncClanStats, 10_000);
  // Repete a cada 15 minutos
  setInterval(syncClanStats, 15 * 60 * 1000);
}

// Manipulador de Slash Commands (Comandos de barra /)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[Bot] Comando não encontrado: /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`[Bot] Erro ao executar /${interaction.commandName}:`, error);
    const errorMessage =
      error?.userMessage ||
      (error.message && !error.message.includes('DiscordAPIError') ? `⚠️ ${error.message}` : null) ||
      '❌ Ocorreu um erro ao processar o comando. Tente novamente em instantes.';

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: errorMessage, embeds: [], components: [] });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyErr) {
      await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
  }
});

// Manipulador de Comandos Clássicos de Prefixo (!comando)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const prefix = config.discord.prefix;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  // Aliases úteis
  let resolvedName = commandName;
  if (commandName === 'help') resolvedName = 'ajuda';
  if (commandName === 'stats') resolvedName = 'perfil';
  if (commandName === 'cla') resolvedName = 'membros';

  const command = commands.get(resolvedName);
  if (!command) return;

  try {
    const options = {};

    if (resolvedName === 'registrar') {
      options.nick = args[0] || '';
      options.plataforma = args[1] || config.pubg.defaultPlatform;
    } else if (resolvedName === 'ranking') {
      const sub = args[0]?.toLowerCase();
      if (sub === 'fixar') {
        options.subcommand = 'fixar';
        const targetMention = args[1]?.match(/^<#(\d+)>$/);
        const targetId = targetMention ? targetMention[1] : (args[1] && /^\d+$/.test(args[1]) ? args[1] : null);
        if (targetId && message.guild) {
          options.canalObj = message.guild.channels.cache.get(targetId);
        } else if (!targetId) {
          options.canalObj = message.channel;
        }
      } else if (sub === 'desfixar') {
        options.subcommand = 'desfixar';
      } else {
        if (args[0]) options.modo = args[0].toLowerCase();
        if (args[1]) options.ordenar = args[1].toLowerCase();
        if (args[2]) options.tipo = args[2].toLowerCase();
      }
    } else if (resolvedName === 'perfil') {
      options.jogador = args[0] || null;
      options.plataforma = args[1] || config.pubg.defaultPlatform;
    } else if (resolvedName === 'comparar') {
      options.jogador1 = args[0] || null;
      options.jogador2 = args[1] || null;
      options.modo = args[2] || 'squad';
    } else if (resolvedName === 'status') {
      options.estado = args[0]?.toLowerCase() || null;
    } else if (resolvedName === 'desvincular') {
      options.membro = args[0] || null;
    }

    await command.execute(message, client, options);
  } catch (error) {
    console.error(`[Bot] Erro ao executar comando de prefixo !${resolvedName}:`, error);
    const userMsg =
      error?.userMessage ||
      (error.message && !error.message.includes('DiscordAPIError') ? `⚠️ ${error.message}` : null) ||
      '❌ Ocorreu um erro ao processar o comando. Tente novamente em instantes.';
    message.reply(userMsg).catch(() => {});
  }
});

// Login do Bot
if (!config.discord.token) {
  console.error('❌ ERRO CRÍTICO: DISCORD_TOKEN não está definido no arquivo .env!');
  process.exit(1);
}

client.login(config.discord.token).catch((err) => {
  console.error('❌ Falha ao conectar ao Discord:', err.message);
});
