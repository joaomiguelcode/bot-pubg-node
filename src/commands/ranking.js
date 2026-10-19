import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { storageService } from '../services/storageService.js';
import { pubgService } from '../services/pubgService.js';
import { config } from '../config.js';
import { rankingAutoUpdateService } from '../services/rankingAutoUpdateService.js';

export const data = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Exibe ou fixa o ranking de performance dos membros do clã no PUBG')
  .addStringOption((option) =>
    option
      .setName('modo')
      .setDescription('Modo de jogo para o ranking')
      .setRequired(false)
      .addChoices(
        { name: 'Squad TPP (Padrão)', value: 'squad' },
        { name: 'Squad FPP', value: 'squad-fpp' },
        { name: 'Duo TPP', value: 'duo' },
        { name: 'Duo FPP', value: 'duo-fpp' },
        { name: 'Solo TPP', value: 'solo' },
        { name: 'Solo FPP', value: 'solo-fpp' }
      )
  )
  .addStringOption((option) =>
    option
      .setName('ordenar')
      .setDescription('Métrica de ordenação')
      .setRequired(false)
      .addChoices(
        { name: '⚔️ Kills (Mais abates)', value: 'kills' },
        { name: '🏆 Vitórias (Wins)', value: 'wins' },
        { name: '🎯 K/D Ratio', value: 'kd' },
        { name: '💥 Dano Médio (ADR)', value: 'adr' },
        { name: '🩹 Revives', value: 'revives' }
      )
  )
  .addStringOption((option) =>
    option
      .setName('tipo')
      .setDescription('Período das estatísticas')
      .setRequired(false)
      .addChoices(
        { name: 'Vitalício (Lifetime)', value: 'lifetime' },
        { name: 'Temporada Atual', value: 'season' }
      )
  )
  .addChannelOption((option) =>
    option
      .setName('fixar')
      .setDescription('[Admin] Canal onde o ranking ficará fixado e atualizando a cada 1 minuto')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(false)
  )
  .addBooleanOption((option) =>
    option
      .setName('desfixar')
      .setDescription('[Admin] Desativa a atualização automática no canal fixo')
      .setRequired(false)
  );

/**
 * Gera o payload completo do ranking (embed e arquivos anexos).
 * Reutilizável tanto para comandos manuais quanto para a rotina de atualização automática a cada 1 minuto.
 */
export async function generateRankingPayload({
  modo = 'squad',
  ordenar = 'kills',
  tipo = 'lifetime',
  client = null,
  guild = null,
  isAutoUpdate = false,
} = {}) {
  const members = storageService.getAllMembers();
  if (members.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⚠️ Nenhum membro registrado')
      .setDescription('Nenhum jogador foi cadastrado no clã ainda.\nUse `/registrar <SeuNick>` para começar!');
    return { embeds: [emptyEmbed], files: [] };
  }

  // Identifica temporada se solicitado
  let seasonId = null;
  if (tipo === 'season') {
    try {
      seasonId = await pubgService.getCurrentSeason(config.pubg.defaultPlatform);
    } catch (err) {
      console.warn('[Ranking] Falha ao obter temporada atual:', err.message);
    }
  }

  // 1. Identifica IDs de jogadores faltantes e busca em lote apenas os necessários
  const missingIdMembers = members.filter((m) => !m.pubgId);
  if (missingIdMembers.length > 0) {
    try {
      const missingNames = missingIdMembers.map((m) => m.pubgNick);
      const batchMap = await pubgService.getPlayersBatch(missingNames, config.pubg.defaultPlatform);
      for (const m of missingIdMembers) {
        const found = batchMap.get(m.pubgNick.toLowerCase());
        if (found) {
          m.pubgId = found.id;
          storageService.updatePlayerId(m.discordId, found.id);
        }
      }
    } catch (err) {
      console.warn('[Ranking] Erro ao sincronizar IDs pendentes:', err.message);
    }
  }

  const rankingList = [];

  // 2. Busca stats para cada um com proteção individual e cache recente
  for (const member of members) {
    let playerId = member.pubgId;

    if (!playerId) {
      try {
        const p = await pubgService.getPlayerByName(member.pubgNick, member.platform || config.pubg.defaultPlatform);
        if (p) {
          playerId = p.id;
          storageService.updatePlayerId(member.discordId, p.id);
        }
      } catch (err) {
        console.warn(`[Ranking] Jogador ${member.pubgNick} não localizado na API:`, err.message);
      }
    }

    if (!playerId) continue;

    try {
      const rawGameModes = await pubgService.getPlayerStats(
        playerId,
        member.platform || config.pubg.defaultPlatform,
        seasonId,
        true // Permite cache recente/stale para velocidade e respeito à cota da API
      );

      if (!rawGameModes) continue;

      const formatted = pubgService.formatModeStats(rawGameModes[modo]);

      let discordUserTag = member.pubgNick;
      if (client) {
        const user = client.users.cache.get(member.discordId);
        if (user) {
          discordUserTag = user.displayName || user.username;
        }
      }

      rankingList.push({
        discordId: member.discordId,
        discordName: discordUserTag,
        pubgNick: member.pubgNick,
        stats: formatted,
      });
    } catch (err) {
      console.warn(`[Ranking] Erro ao obter estatísticas de ${member.pubgNick}:`, err.message);
    }
  }

  if (rankingList.length === 0) {
    const noDataEmbed = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle('❌ Dados não disponíveis no momento')
      .setDescription(
        `Não foi possível carregar as estatísticas dos membros no modo **${modo.toUpperCase()}**.\n` +
        `Isso pode ocorrer caso os servidores da PUBG API estejam em manutenção ou o limite temporário tenha sido atingido.\n\n` +
        `Tente novamente em instantes.`
      );
    return { embeds: [noDataEmbed], files: [] };
  }

  // Ordenação
  rankingList.sort((a, b) => {
    let valA = a.stats[ordenar];
    let valB = b.stats[ordenar];
    if (typeof valA === 'string') valA = parseFloat(valA) || 0;
    if (typeof valB === 'string') valB = parseFloat(valB) || 0;
    return valB - valA;
  });

  const modoNome = {
    squad: 'Squad TPP',
    'squad-fpp': 'Squad FPP',
    duo: 'Duo TPP',
    'duo-fpp': 'Duo FPP',
    solo: 'Solo TPP',
    'solo-fpp': 'Solo FPP',
  }[modo] || modo.toUpperCase();

  const periodoNome = tipo === 'season' ? 'Temporada Atual' : 'Vitalício (Lifetime)';
  const medalhas = ['🥇', '🥈', '🥉'];

  let corpoRanking = '';
  const top10 = rankingList.slice(0, 10);

  top10.forEach((item, index) => {
    const posicao = index < 3 ? medalhas[index] : `\`${index + 1}º\``;
    const s = item.stats;

    let destaque = '';
    if (ordenar === 'kills') destaque = `⚔️ **${s.kills.toLocaleString()}** Kills`;
    else if (ordenar === 'wins') destaque = `🏆 **${s.wins}** Vitórias (${s.winRate})`;
    else if (ordenar === 'kd') destaque = `🎯 K/D: **${s.kd}** (${s.kills} Kills)`;
    else if (ordenar === 'adr') destaque = `💥 ADR: **${s.adr}** (Dano Médio)`;
    else if (ordenar === 'revives') destaque = `🩹 Revives: **${s.revives}**`;

    corpoRanking += `${posicao} **${item.discordName}** (\`${item.pubgNick}\`)\n`;
    corpoRanking += `└ ${destaque} | 🏆 **${s.wins}** W | 🎯 **${s.kd}** KD | 💥 ADR **${s.adr}**\n\n`;
  });

  const guildIcon = guild?.iconURL?.() || client?.guilds?.cache?.first?.()?.iconURL?.();
  const timestampUnix = Math.floor(Date.now() / 1000);

  let headerDescription = `📊 **Modo:** \`${modoNome}\` • **Período:** \`${periodoNome}\`\nOrdenado por: **${ordenar.toUpperCase()}**\n`;
  if (isAutoUpdate) {
    headerDescription += `⏰ **Última Atualização:** <t:${timestampUnix}:R> *(Atualiza a cada 1 minuto)*\n`;
  }
  headerDescription += `\n${corpoRanking}`;

  const embed = new EmbedBuilder()
    .setColor('#1E3A8A') // Dark Blue Premium
    .setTitle(`🏆 RANKING DO CLÃ: ${config.clan.name.toUpperCase()}`)
    .setDescription(headerDescription)
    .setFooter({
      text: isAutoUpdate
        ? `${config.clan.name} • 🔄 Atualização Automática a cada 1 min (${rankingList.length} combatentes)`
        : `${config.clan.name} • Leaderboard PUBG (${rankingList.length} combatentes)`,
      iconURL: guildIcon || undefined,
    })
    .setTimestamp();

  // Imagem opcional do clã
  const files = [];
  const candidateImagePath = path.join(config.paths.root, config.clan.imageFile);
  if (fs.existsSync(candidateImagePath)) {
    const attachment = new AttachmentBuilder(candidateImagePath, { name: 'clan_banner.jpg' });
    files.push(attachment);
    embed.setImage('attachment://clan_banner.jpg');
  }

  return { embeds: [embed], files };
}

export async function execute(interaction, client, options = {}) {
  const isSlash = !!interaction.deferReply;

  // Verifica permissão de administrador
  const memberPermissions = interaction.member?.permissions;
  const hasAdmin =
    memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
    memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
    false;

  // 1. Checa ação de DESFIXAR
  const desfixarRaw = isSlash
    ? interaction.options?.getBoolean?.('desfixar')
    : options.desfixar || options.subcommand === 'desfixar';

  if (desfixarRaw) {
    if (!hasAdmin) {
      const msg = '❌ Você precisa de permissão de **Administrador** para desativar o ranking fixo.';
      if (isSlash) return interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      return interaction.reply({ content: msg }).catch(() => {});
    }

    rankingAutoUpdateService.disable();
    const okMsg = '✅ O ranking automático em canal fixo foi **desativado** com sucesso.';
    if (isSlash) return interaction.reply({ content: okMsg, ephemeral: true }).catch(() => {});
    return interaction.reply({ content: okMsg }).catch(() => {});
  }

  // 2. Checa ação de FIXAR canal
  const fixarChannel = isSlash
    ? interaction.options?.getChannel?.('fixar')
    : options.fixarChannel || (options.subcommand === 'fixar' ? (options.canalObj || interaction.channel) : null);

  const modo = options.modo || interaction.options?.getString?.('modo') || 'squad';
  const ordenar = options.ordenar || interaction.options?.getString?.('ordenar') || 'kills';
  const tipo = options.tipo || interaction.options?.getString?.('tipo') || 'lifetime';

  if (fixarChannel) {
    if (!hasAdmin) {
      const msg = '❌ Você precisa de permissão de **Administrador** para fixar o ranking em um canal.';
      if (isSlash) return interaction.reply({ content: msg, ephemeral: true });
      return interaction.reply({ content: msg });
    }

    if (isSlash) await interaction.deferReply({ ephemeral: true }).catch(() => {});

    await rankingAutoUpdateService.setChannel(fixarChannel.id, modo, ordenar, tipo);

    const successMsg = `✅ **Ranking fixo configurado com sucesso!**\nO ranking agora ficará fixado no canal <#${fixarChannel.id}> e se atualizará **automaticamente a cada 1 minuto**.`;
    if (isSlash) return interaction.editReply({ content: successMsg }).catch(() => {});
    return interaction.reply({ content: successMsg }).catch(() => {});
  }

  // 3. Exibição comum do ranking no canal onde foi chamado
  if (isSlash) {
    await interaction.deferReply().catch(() => {});
  }

  const payload = await generateRankingPayload({
    modo,
    ordenar,
    tipo,
    client,
    guild: interaction.guild,
    isAutoUpdate: false,
  });

  if (isSlash) {
    return interaction.editReply(payload).catch(() => {});
  }
  return interaction.reply(payload).catch(() => {});
}
