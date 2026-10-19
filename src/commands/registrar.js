import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { storageService } from '../services/storageService.js';
import { pubgService } from '../services/pubgService.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('registrar')
  .setDescription('Vincula sua conta do Discord ao seu Nick no PUBG')
  .addStringOption((option) =>
    option
      .setName('nick')
      .setDescription('Seu Nick exato dentro do PUBG')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('plataforma')
      .setDescription('Plataforma onde você joga (padrão: Steam)')
      .setRequired(false)
      .addChoices(
        { name: 'Steam (PC)', value: 'steam' },
        { name: 'Xbox', value: 'xbox' },
        { name: 'PlayStation (PSN)', value: 'psn' },
        { name: 'Kakao', value: 'kakao' }
      )
  );

export async function execute(interaction, client, options = {}) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply().catch(() => {});

  const nick = (options.nick || interaction.options?.getString('nick') || '').trim();
  const platform = (options.plataforma || interaction.options?.getString('plataforma') || config.pubg.defaultPlatform).toLowerCase();

  if (!nick) {
    const errorMsg = '❌ Por favor, informe seu nick no PUBG. Exemplo: `/registrar nick:HAWK_NK` ou `!registrar HAWK_NK`';
    if (isSlash) return interaction.editReply({ content: errorMsg }).catch(() => {});
    return interaction.reply({ content: errorMsg }).catch(() => {});
  }

  const userId = interaction.user ? interaction.user.id : interaction.author.id;
  const userMention = `<@${userId}>`;

  // 1. Validação na API do PUBG
  let player = null;
  try {
    player = await pubgService.getPlayerByName(nick, platform);
  } catch (err) {
    const isRateLimit = err.isRateLimit || err.message?.includes('Limite de requisições');
    const apiError = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle(isRateLimit ? '⏳ Limite da API Atingido' : '⚠️ Erro na Comunicação com o PUBG')
      .setDescription(
        isRateLimit
          ? 'A API do PUBG está com muitas requisições no momento. Por favor, **aguarde 30 segundos** e tente registrar novamente.'
          : `Não foi possível validar seu jogador no momento: ${err.message}`
      );

    if (isSlash) return interaction.editReply({ embeds: [apiError] }).catch(() => {});
    return interaction.reply({ embeds: [apiError] }).catch(() => {});
  }

  if (!player) {
    const notFound = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle('❌ Jogador Não Encontrado')
      .setDescription(
        `Não encontramos o nick **\`${nick}\`** na plataforma **${platform.toUpperCase()}**.\n` +
        `Certifique-se de digitar seu nome no jogo exatamente como aparece no PUBG.`
      );

    if (isSlash) return interaction.editReply({ embeds: [notFound] }).catch(() => {});
    return interaction.reply({ embeds: [notFound] }).catch(() => {});
  }

  // Checa se o usuário já tinha outro nick cadastrado
  const existingPrevious = storageService.getMember(userId);

  // 2. Salva no banco de dados local com deduplicação
  storageService.registerMember(userId, player.name, platform, player.id);

  let extraNote = '';
  if (existingPrevious && existingPrevious.pubgNick.toLowerCase() !== player.name.toLowerCase()) {
    extraNote = `\n*(Seu vínculo anterior com \`${existingPrevious.pubgNick}\` foi atualizado).*`;
  }

  const embed = new EmbedBuilder()
    .setColor('#2ECC71') // Emerald Green
    .setTitle('✅ Registro Efetuado com Sucesso!')
    .setDescription(
      `O membro ${userMention} foi vinculado ao jogador **\`${player.name}\`**.\n\n` +
      `🎮 **Plataforma:** \`${platform.toUpperCase()}\`\n` +
      `🆔 **PUBG ID:** \`${player.id}\`\n\n` +
      `Suas estatísticas já estão disponíveis e você aparecerá no próximo \`/ranking\`!${extraNote}`
    )
    .setFooter({ text: `${config.clan.name} • Sistema de Membros` })
    .setTimestamp();

  if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
  return interaction.reply({ embeds: [embed] }).catch(() => {});
}
