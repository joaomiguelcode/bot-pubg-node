import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { storageService } from '../services/storageService.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('desvincular')
  .setDescription('Remove o vínculo da sua conta ou de outro membro')
  .addUserOption((option) =>
    option
      .setName('membro')
      .setDescription('Membro a ser desvinculado (Requer permissão de Administrador)')
      .setRequired(false)
  );

export async function execute(interaction, client, options = {}) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply().catch(() => {});

  const author = interaction.user || interaction.author;
  let targetDiscordId = author.id;
  let targetNick = null;

  const slashUser = interaction.options?.getUser?.('membro');
  const rawTarget = slashUser || options.membro;

  if (rawTarget) {
    if (typeof rawTarget === 'object' && rawTarget.id) {
      targetDiscordId = rawTarget.id;
    } else if (typeof rawTarget === 'string') {
      const mentionMatch = rawTarget.match(/^<@!?(\d+)>$/);
      if (mentionMatch) {
        targetDiscordId = mentionMatch[1];
      } else if (/^\d{17,20}$/.test(rawTarget.trim())) {
        targetDiscordId = rawTarget.trim();
      } else {
        // Tenta achar pelo nick
        const found = storageService.findMemberByNick(rawTarget.trim());
        if (found) {
          targetDiscordId = found.discordId;
          targetNick = found.pubgNick;
        } else {
          targetDiscordId = null;
          targetNick = rawTarget.trim();
        }
      }
    }
  }

  const isTargetingOther = targetDiscordId ? targetDiscordId !== author.id : true;

  // Se estiver tentando desvincular outro usuário, checa permissão de admin
  if (isTargetingOther) {
    const memberPermissions = interaction.member?.permissions;
    const hasAdmin =
      memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
      memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
      false;

    if (!hasAdmin) {
      const denied = '❌ Você precisa de permissão de **Administrador** para desvincular outro membro.';
      if (isSlash) return interaction.editReply({ content: denied }).catch(() => {});
      return interaction.reply({ content: denied }).catch(() => {});
    }
  }

  if (!targetDiscordId && targetNick) {
    const notFound = `⚠️ Não foi encontrado nenhum membro com o nick **\`${targetNick}\`** no clã.`;
    if (isSlash) return interaction.editReply({ content: notFound }).catch(() => {});
    return interaction.reply({ content: notFound }).catch(() => {});
  }

  const existing = storageService.getMember(targetDiscordId);
  if (!existing) {
    const notFound = `⚠️ O usuário <@${targetDiscordId}> não possui nenhum nick vinculado.`;
    if (isSlash) return interaction.editReply({ content: notFound }).catch(() => {});
    return interaction.reply({ content: notFound }).catch(() => {});
  }

  storageService.unregisterMember(targetDiscordId);

  const embed = new EmbedBuilder()
    .setColor('#E67E22')
    .setTitle('🗑️ Vínculo Removido')
    .setDescription(
      `O nick **\`${existing.pubgNick}\`** foi desvinculado com sucesso do usuário <@${targetDiscordId}>.`
    )
    .setFooter({ text: `${config.clan.name}` })
    .setTimestamp();

  if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
  return interaction.reply({ embeds: [embed] }).catch(() => {});
}
