import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { storageService } from '../services/storageService.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('membros')
  .setDescription('Lista todos os combatentes registrados no clã');

export async function execute(interaction, client) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply().catch(() => {});

  const members = storageService.getAllMembers();
  if (members.length === 0) {
    const empty = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('📋 Membros do Clã')
      .setDescription('Nenhum membro registrado ainda. Use `/registrar <SeuNick>` para se juntar à lista!');

    if (isSlash) return interaction.editReply({ embeds: [empty] }).catch(() => {});
    return interaction.reply({ embeds: [empty] }).catch(() => {});
  }

  // Ordena por data ou nick
  members.sort((a, b) => a.pubgNick.localeCompare(b.pubgNick));

  let text = '';
  const lines = [];
  members.forEach((m, idx) => {
    lines.push(`\`#${idx + 1}\` <@${m.discordId}> ➔ **\`${m.pubgNick}\`** *(${m.platform.toUpperCase()})*`);
  });

  // Limite seguro de 3800 caracteres para evitar erro de limite de embed do Discord (4096)
  let description = `Total de combatentes vinculados: **${members.length}**\n\n`;
  for (const line of lines) {
    if ((description + line + '\n').length > 3800) {
      description += `\n*...e mais ${lines.length - description.split('\n').length + 3} combatentes.*`;
      break;
    }
    description += line + '\n';
  }

  const embed = new EmbedBuilder()
    .setColor('#34495E')
    .setTitle(`🛡️ Membros Registrados: ${config.clan.name}`)
    .setDescription(description)
    .setFooter({ text: `${config.clan.name} • Use /ranking para ver os melhores!` })
    .setTimestamp();

  if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
  return interaction.reply({ embeds: [embed] }).catch(() => {});
}
