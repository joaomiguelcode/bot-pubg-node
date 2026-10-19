import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { storageService } from '../services/storageService.js';
import { pubgService } from '../services/pubgService.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('comparar')
  .setDescription('Compara as estatísticas de dois combatentes lado a lado')
  .addStringOption((option) =>
    option
      .setName('jogador1')
      .setDescription('Primeiro jogador (Nick ou Menção)')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('jogador2')
      .setDescription('Segundo jogador (Nick ou Menção)')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('modo')
      .setDescription('Modo de jogo')
      .setRequired(false)
      .addChoices(
        { name: 'Squad TPP (Padrão)', value: 'squad' },
        { name: 'Squad FPP', value: 'squad-fpp' },
        { name: 'Duo TPP', value: 'duo' },
        { name: 'Solo TPP', value: 'solo' }
      )
  );

function resolveNick(input) {
  if (!input) return null;
  const mentionMatch = input.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    const reg = storageService.getMember(mentionMatch[1]);
    return reg ? reg.pubgNick : null;
  }
  return input.trim();
}

export async function execute(interaction, client, options = {}) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply().catch(() => {});

  const input1 = options.jogador1 || interaction.options?.getString('jogador1');
  const input2 = options.jogador2 || interaction.options?.getString('jogador2');
  const modo = options.modo || interaction.options?.getString('modo') || 'squad';

  const nick1 = resolveNick(input1);
  const nick2 = resolveNick(input2);

  if (!nick1 || !nick2) {
    const err = '❌ Não foi possível identificar os jogadores informados. Use o nick no jogo ou mencione um membro registrado.\nExemplo: `/comparar jogador1:Nick1 jogador2:Nick2`';
    if (isSlash) return interaction.editReply({ content: err }).catch(() => {});
    return interaction.reply({ content: err }).catch(() => {});
  }

  try {
    const resolvePlayerData = async (nickName) => {
      const reg = storageService.findMemberByNick(nickName);
      if (reg?.pubgId) {
        return { id: reg.pubgId, name: reg.pubgNick, platform: reg.platform || config.pubg.defaultPlatform };
      }
      return pubgService.getPlayerByName(nickName, config.pubg.defaultPlatform);
    };

    // Busca ambos jogadores (usando cache persistente ou dados do clã)
    const [p1, p2] = await Promise.all([
      resolvePlayerData(nick1),
      resolvePlayerData(nick2),
    ]);

    if (!p1 || !p2) {
      const missing = !p1 && !p2 ? `${nick1} e ${nick2}` : !p1 ? nick1 : nick2;
      const notFoundEmbed = new EmbedBuilder()
        .setColor('#E74C3C')
        .setTitle('🔍 Jogador não encontrado')
        .setDescription(`Não encontramos o(s) jogador(es) **${missing}** no PUBG. Verifique a grafia correta dos nicks.`);

      if (isSlash) return interaction.editReply({ embeds: [notFoundEmbed] }).catch(() => {});
      return interaction.reply({ embeds: [notFoundEmbed] }).catch(() => {});
    }

    // Busca stats de ambos (com fallback para cache recente)
    const [stats1Raw, stats2Raw] = await Promise.all([
      pubgService.getPlayerStats(p1.id, config.pubg.defaultPlatform, null, true),
      pubgService.getPlayerStats(p2.id, config.pubg.defaultPlatform, null, true),
    ]);

    const s1 = pubgService.formatModeStats(stats1Raw?.[modo]);
    const s2 = pubgService.formatModeStats(stats2Raw?.[modo]);

    const compareRow = (label, val1, val2, num1, num2, unit = '') => {
      let tag1 = '';
      let tag2 = '';
      if (num1 > num2) {
        tag1 = ' 👑';
      } else if (num2 > num1) {
        tag2 = ' 👑';
      }
      return `**${label}**\n\`${p1.name}\`: **${val1}${unit}**${tag1}  vs  \`${p2.name}\`: **${val2}${unit}**${tag2}\n`;
    };

    const modoLabel = {
      squad: 'Squad TPP',
      'squad-fpp': 'Squad FPP',
      duo: 'Duo TPP',
      solo: 'Solo TPP',
    }[modo] || modo.toUpperCase();

    const embed = new EmbedBuilder()
      .setColor('#9B59B6') // Amethyst Purple
      .setTitle(`⚔️ Confronto Direto: ${p1.name} vs ${p2.name}`)
      .setDescription(`Modo analisado: **${modoLabel}** (Estatísticas Vitalícias)\n`)
      .addFields(
        {
          name: '📊 Comparativo de Combate',
          value:
            compareRow('⚔️ Kills Totais', s1.kills.toLocaleString(), s2.kills.toLocaleString(), s1.kills, s2.kills) +
            compareRow('🎯 K/D Ratio', s1.kd, s2.kd, parseFloat(s1.kd), parseFloat(s2.kd)) +
            compareRow('💥 Dano Médio (ADR)', s1.adr, s2.adr, parseFloat(s1.adr), parseFloat(s2.adr)) +
            compareRow('🏆 Vitórias (Wins)', s1.wins, s2.wins, s1.wins, s2.wins) +
            compareRow('📈 Taxa de Vitória', s1.winRate, s2.winRate, parseFloat(s1.winRate), parseFloat(s2.winRate)) +
            compareRow('🎯 Headshot %', s1.headshotRate, s2.headshotRate, parseFloat(s1.headshotRate), parseFloat(s2.headshotRate)) +
            compareRow('🔭 Abate mais Distante', s1.longestKill, s2.longestKill, s1.longestKill, s2.longestKill, 'm') +
            compareRow('🩹 Revives', s1.revives, s2.revives, s1.revives, s2.revives),
          inline: false,
        }
      )
      .setFooter({ text: `${config.clan.name} • Duelo de Guerreiros` })
      .setTimestamp();

    if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
    return interaction.reply({ embeds: [embed] }).catch(() => {});
  } catch (error) {
    console.error(`[Comparar] Erro ao comparar ${nick1} e ${nick2}:`, error);
    const isRateLimit = error.isRateLimit || error.message?.includes('Limite de requisições');
    const errEmbed = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle(isRateLimit ? '⏳ Limite de Consultas Atingido' : '❌ Falha na Comparação')
      .setDescription(
        isRateLimit
          ? 'A API do PUBG atingiu o limite de consultas por minuto.\nPor favor, **aguarde 30 a 60 segundos** e tente novamente.'
          : `Não foi possível comparar as estatísticas no momento.\n**Detalhe:** ${error.message || 'Erro inesperado'}`
      );

    if (isSlash) return interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
    return interaction.reply({ embeds: [errEmbed] }).catch(() => {});
  }
}
