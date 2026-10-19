import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { storageService } from '../services/storageService.js';
import { pubgService } from '../services/pubgService.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('perfil')
  .setDescription('Consulta a ficha completa de estatísticas de um jogador no PUBG')
  .addStringOption((option) =>
    option
      .setName('jogador')
      .setDescription('Nick no PUBG ou menção do Discord (opcional, padrão: você mesmo)')
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName('plataforma')
      .setDescription('Plataforma do jogo')
      .setRequired(false)
      .addChoices(
        { name: 'Steam (PC)', value: 'steam' },
        { name: 'Xbox', value: 'xbox' },
        { name: 'PlayStation', value: 'psn' },
        { name: 'Kakao', value: 'kakao' }
      )
  );

export async function execute(interaction, client, options = {}) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply().catch(() => {});

  let targetInput = options.jogador || interaction.options?.getString('jogador');
  let platform = (options.plataforma || interaction.options?.getString('plataforma') || config.pubg.defaultPlatform).toLowerCase();

  let pubgNick = '';
  let discordUser = null;

  if (!targetInput) {
    // Busca registro do próprio autor
    const authorId = interaction.user?.id || interaction.author?.id;
    const reg = storageService.getMember(authorId);
    if (!reg) {
      const msg = '❌ Você ainda não vinculou seu nick do PUBG! Use `/registrar <SeuNick>` ou especifique um jogador: `/perfil <Nick>`.';
      if (isSlash) return interaction.editReply({ content: msg }).catch(() => {});
      return interaction.reply({ content: msg }).catch(() => {});
    }
    pubgNick = reg.pubgNick;
    platform = reg.platform || platform;
    discordUser = interaction.user || interaction.author;
  } else {
    // Verifica se é uma menção de Discord (<@123...>)
    const mentionMatch = targetInput.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
      const mentionId = mentionMatch[1];
      const reg = storageService.getMember(mentionId);
      if (!reg) {
        const msg = `❌ O usuário mencionado não possui nick registrado no clã.`;
        if (isSlash) return interaction.editReply({ content: msg }).catch(() => {});
        return interaction.reply({ content: msg }).catch(() => {});
      }
      pubgNick = reg.pubgNick;
      platform = reg.platform || platform;
      if (client) discordUser = client.users.cache.get(mentionId);
    } else {
      // É um nick direto
      pubgNick = targetInput.trim();
      const byNick = storageService.findMemberByNick(pubgNick);
      if (byNick && client) {
        discordUser = client.users.cache.get(byNick.discordId);
      }
    }
  }

  try {
    // 1. Usa o PUBG ID já cadastrado no clã ou busca na API (com cache de 30 dias)
    let player = null;
    const registered = (discordUser ? storageService.getMember(discordUser.id) : null) || storageService.findMemberByNick(pubgNick);
    if (registered?.pubgId) {
      player = {
        id: registered.pubgId,
        name: registered.pubgNick,
        platform: registered.platform || platform,
      };
    } else {
      player = await pubgService.getPlayerByName(pubgNick, platform);
    }
    if (!player) {
      const notFoundEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🔍 Jogador não encontrado')
        .setDescription(`Não foi possível encontrar o jogador **${pubgNick}** na plataforma **${platform.toUpperCase()}**.\nVerifique se o nome no jogo foi digitado corretamente.`);

      if (isSlash) return interaction.editReply({ embeds: [notFoundEmbed] }).catch(() => {});
      return interaction.reply({ embeds: [notFoundEmbed] }).catch(() => {});
    }

    if (discordUser) {
      storageService.updatePlayerId(discordUser.id, player.id);
    }

    // 2. Busca estatísticas (vitalícias com fallback de cache recente)
    const stats = await pubgService.getPlayerStats(player.id, platform, null, true);
    if (!stats) {
      const errEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('📊 Sem Estatísticas')
        .setDescription(`Não há registros de estatísticas disponíveis para **${player.name}**.`);

      if (isSlash) return interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
      return interaction.reply({ embeds: [errEmbed] }).catch(() => {});
    }

    const squadTpp = pubgService.formatModeStats(stats['squad']);
    const squadFpp = pubgService.formatModeStats(stats['squad-fpp']);

    // Embed detalhado e moderno
    const embed = new EmbedBuilder()
      .setColor('#0EA5E9') // Sky Blue
      .setTitle(`🎖️ Perfil do Combatente: ${player.name}`)
      .setDescription(
        `🎮 **Plataforma:** \`${platform.toUpperCase()}\`\n` +
        `🆔 **Discord:** ${discordUser ? `<@${discordUser.id}>` : '*Não vinculado*'}\n` +
        `📁 **PUBG Account:** \`${player.id.substring(0, 16)}...\``
      )
      .addFields(
        {
          name: '🛡️ SQUAD (TPP)',
          value:
            `⚔️ **Kills:** ${squadTpp.kills.toLocaleString()} | 🏆 **Wins:** ${squadTpp.wins} (${squadTpp.winRate})\n` +
            `🎯 **K/D:** ${squadTpp.kd} | 💥 **ADR:** ${squadTpp.adr}\n` +
            `🎖️ **Top 10:** ${squadTpp.top10s} (${squadTpp.top10Rate}) | 🎮 **Partidas:** ${squadTpp.roundsPlayed}\n` +
            `🎯 **Headshot %:** ${squadTpp.headshotRate} | 🩹 **Revives:** ${squadTpp.revives}\n` +
            `🔭 **Longest Kill:** ${squadTpp.longestKill}m | 💥 **Max Kills:** ${squadTpp.roundMostKills}`,
          inline: false,
        },
        {
          name: '🎯 SQUAD (FPP)',
          value:
            `⚔️ **Kills:** ${squadFpp.kills.toLocaleString()} | 🏆 **Wins:** ${squadFpp.wins} (${squadFpp.winRate})\n` +
            `🎯 **K/D:** ${squadFpp.kd} | 💥 **ADR:** ${squadFpp.adr}\n` +
            `🎖️ **Top 10:** ${squadFpp.top10s} (${squadFpp.top10Rate}) | 🎮 **Partidas:** ${squadFpp.roundsPlayed}\n` +
            `🎯 **Headshot %:** ${squadFpp.headshotRate} | 🩹 **Revives:** ${squadFpp.revives}`,
          inline: false,
        }
      )
      .setFooter({ text: `${config.clan.name} • Estatísticas Vitalícias` })
      .setTimestamp();

    if (discordUser && discordUser.displayAvatarURL) {
      embed.setThumbnail(discordUser.displayAvatarURL());
    }

    if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
    return interaction.reply({ embeds: [embed] }).catch(() => {});
  } catch (error) {
    console.error(`[Perfil] Erro ao buscar perfil de ${pubgNick}:`, error);
    const isRateLimit = error.isRateLimit || error.message?.includes('Limite de requisições');
    const errorEmbed = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle(isRateLimit ? '⏳ Limite de Consultas Atingido' : '❌ Falha ao Consultar Perfil')
      .setDescription(
        isRateLimit
          ? 'A API do PUBG atingiu o limite de requisições por minuto.\nPor favor, **aguarde 30 a 60 segundos** e tente novamente.'
          : `Não foi possível carregar as informações do jogador no momento.\n**Detalhe:** ${error.message || 'Erro de comunicação'}`
      );

    if (isSlash) return interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
    return interaction.reply({ embeds: [errorEmbed] }).catch(() => {});
  }
}
