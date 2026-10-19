import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('ajuda')
  .setDescription('Exibe a central de comandos e ajuda do Bot PUBG');

export async function execute(interaction) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply().catch(() => {});

  const prefix = config.discord.prefix;

  const embed = new EmbedBuilder()
    .setColor('#F39C12') // Gold/Amber
    .setTitle(`📖 Central de Comandos • ${config.clan.name}`)
    .setDescription(
      `O bot suporta comandos modernos de barra (\`/\`) e também comandos clássicos de prefixo (\`${prefix}\`).\n\n` +
      `Aqui estão os comandos disponíveis para os membros do clã:`
    )
    .addFields(
      {
        name: '🏆 `/ranking` ou `' + prefix + 'ranking`',
        value:
          'Exibe o ranking dos melhores jogadores do clã.\n' +
          '• **Opções no Slash:** Modo (*squad, squad-fpp, duo, solo*) e ordenação por *kills, wins, kd, adr, revives*.\n' +
          '• **Exemplo Prefixo:** `' + prefix + 'ranking squad kd` ou apenas `' + prefix + 'ranking`',
        inline: false,
      },
      {
        name: '🎖️ `/perfil` ou `' + prefix + 'perfil`',
        value:
          'Mostra o cartão completo de estatísticas (K/D, ADR, Win%, Headshots, Abate mais longo).\n' +
          '• **Exemplo:** `/perfil` (seu próprio perfil) ou `/perfil jogador:HAWK_NK` ou `' + prefix + 'perfil @Membro`',
        inline: false,
      },
      {
        name: '📝 `/registrar` ou `' + prefix + 'registrar`',
        value:
          'Vincula sua conta do Discord ao seu nick exato no PUBG (com validação na API).\n' +
          '• **Exemplo:** `/registrar nick:SeuNick plataforma:Steam` ou `' + prefix + 'registrar SeuNick`',
        inline: false,
      },
      {
        name: '⚔️ `/comparar` ou `' + prefix + 'comparar`',
        value:
          'Duelo direto de estatísticas lado a lado entre dois jogadores.\n' +
          '• **Exemplo:** `/comparar jogador1:Nick1 jogador2:Nick2`',
        inline: false,
      },
      {
        name: '👥 `/membros` ou `' + prefix + 'membros`',
        value: 'Lista todos os combatentes cadastrados na base do clã.',
        inline: false,
      },
      {
        name: '🗑️ `/desvincular` ou `' + prefix + 'desvincular`',
        value:
          'Remove o vínculo de PUBG.\n' +
          '• **Exemplo:** `/desvincular` (sua conta) ou `[Admin]` `/desvincular membro:@Membro`',
        inline: false,
      },
      {
        name: '🔧 `/status` ou `' + prefix + 'status`',
        value:
          'Exibe o status do sistema ou atualiza [Apenas Admins].\n' +
          '• **Exemplo:** `/status` ou `' + prefix + 'status online`',
        inline: false,
      }
    )
    .setFooter({ text: `${config.clan.name} • Bot PUBG v2.0 (Node.js)` })
    .setTimestamp();

  if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
  return interaction.reply({ embeds: [embed] }).catch(() => {});
}
