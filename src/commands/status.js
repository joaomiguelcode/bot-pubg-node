import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

// Caminho do arquivo de estado do sistema
const statusFilePath = path.join(config.paths.data, 'system_status.json');

/**
 * Lê o status atual do sistema do arquivo JSON.
 */
function readSystemStatus() {
  try {
    if (fs.existsSync(statusFilePath)) {
      const raw = fs.readFileSync(statusFilePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // ignora erros de leitura
  }
  return { status: 'online', updatedAt: new Date().toISOString(), updatedBy: 'Sistema' };
}

/**
 * Salva o status do sistema no arquivo JSON com escrita segura.
 */
function writeSystemStatus(status, updatedBy) {
  const data = { status, updatedAt: new Date().toISOString(), updatedBy };
  try {
    fs.mkdirSync(path.dirname(statusFilePath), { recursive: true });
    const tmpPath = `${statusFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    try {
      fs.renameSync(tmpPath, statusFilePath);
    } catch {
      fs.copyFileSync(tmpPath, statusFilePath);
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  } catch (err) {
    console.error('[Status] Erro ao salvar system_status:', err.message);
  }
  return data;
}

/**
 * Retorna emoji, cor e texto legível para cada estado do sistema.
 */
function getStatusInfo(status) {
  switch (status) {
    case 'online':
      return {
        emoji: '🟢',
        label: 'Online',
        color: '#2ECC71',
        description: 'Todos os sistemas estão funcionando normalmente.',
        activityName: 'PUBG com o Clã',
        activityStatus: 'online',
      };
    case 'offline':
      return {
        emoji: '🔴',
        label: 'Offline',
        color: '#E74C3C',
        description: 'O sistema está temporariamente indisponível.',
        activityName: '⚠️ Sistema Offline',
        activityStatus: 'dnd',
      };
    case 'manutencao':
      return {
        emoji: '🟡',
        label: 'Em Manutenção',
        color: '#F39C12',
        description: 'O sistema está em manutenção. Voltamos em breve!',
        activityName: '🔧 Em Manutenção',
        activityStatus: 'idle',
      };
    default:
      return {
        emoji: '⚪',
        label: 'Desconhecido',
        color: '#95A5A6',
        description: 'Status não identificado.',
        activityName: 'PUBG com o Clã',
        activityStatus: 'online',
      };
  }
}

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('🔧 Define ou exibe o status atual do sistema do bot')
  .addStringOption((option) =>
    option
      .setName('estado')
      .setDescription('[Admin] Novo estado do sistema')
      .setRequired(false)
      .addChoices(
        { name: '🟢 Online — Sistema funcionando normalmente', value: 'online' },
        { name: '🔴 Offline — Sistema indisponível', value: 'offline' },
        { name: '🟡 Manutenção — Sistema em manutenção', value: 'manutencao' }
      )
  );

export async function execute(interaction, client, options = {}) {
  const isSlash = !!interaction.deferReply;
  if (isSlash) await interaction.deferReply({ ephemeral: true }).catch(() => {});

  const replyEmbed = (embed) => {
    if (isSlash) return interaction.editReply({ embeds: [embed] }).catch(() => {});
    return interaction.reply({ embeds: [embed] }).catch(() => {});
  };

  const estadoRaw = isSlash
    ? interaction.options.getString('estado')
    : (options.estado || null);

  const estadosValidos = ['online', 'offline', 'manutencao'];
  const estadoEscolhido = estadoRaw && estadosValidos.includes(estadoRaw.toLowerCase()) ? estadoRaw.toLowerCase() : null;

  if (estadoRaw && !estadoEscolhido) {
    const errorEmbed = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle('❌ Estado Inválido')
      .setDescription('Use um dos seguintes estados: `online`, `offline` ou `manutencao`.\nExemplo: `/status estado:online` ou `!status online`');

    return replyEmbed(errorEmbed);
  }

  // Checagem de permissão segura
  const memberPermissions = interaction.member?.permissions;
  const hasPermission =
    memberPermissions?.has?.(PermissionFlagsBits.Administrator) ||
    memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) ||
    false;

  if (estadoEscolhido && !hasPermission) {
    const deniedEmbed = new EmbedBuilder()
      .setColor('#E74C3C')
      .setTitle('🚫 Acesso Negado')
      .setDescription('Apenas **Administradores** podem alterar o status do sistema do bot.');

    return replyEmbed(deniedEmbed);
  }

  // Visualização de status atual (se não informou novo estado)
  if (!estadoEscolhido) {
    const current = readSystemStatus();
    const info = getStatusInfo(current.status);
    const dateFormatted = current.updatedAt ? new Date(current.updatedAt).toLocaleString('pt-BR') : 'Desconhecida';

    const viewEmbed = new EmbedBuilder()
      .setColor(info.color)
      .setTitle(`${info.emoji} Status do Sistema • ${config.clan.name}`)
      .setDescription(`**Estado atual:** \`${info.label}\`\n${info.description}`)
      .addFields(
        { name: '🕒 Última Atualização', value: dateFormatted, inline: true },
        { name: '👤 Atualizado Por', value: current.updatedBy || 'Sistema', inline: true }
      )
      .setFooter({ text: `${config.clan.name} • Monitoramento Operacional` })
      .setTimestamp();

    return replyEmbed(viewEmbed);
  }

  // Atualização de status
  const updatedBy = isSlash
    ? (interaction.user.tag || interaction.user.username)
    : (interaction.author?.tag || interaction.author?.username || 'Admin');

  writeSystemStatus(estadoEscolhido, updatedBy);
  const info = getStatusInfo(estadoEscolhido);

  if (client?.user) {
    try {
      client.user.setPresence({
        activities: [{ name: info.activityName, type: 0 }],
        status: info.activityStatus,
      });
    } catch {
      // ignora
    }
  }

  const updatedEmbed = new EmbedBuilder()
    .setColor(info.color)
    .setTitle(`${info.emoji} Status Atualizado com Sucesso!`)
    .setDescription(
      `O status do bot foi alterado para **${info.label}**.\n\n` +
      `**Descrição:** ${info.description}\n` +
      `**Modificado por:** \`${updatedBy}\``
    )
    .setFooter({ text: `${config.clan.name} • Sistema de Controle` })
    .setTimestamp();

  return replyEmbed(updatedEmbed);
}
