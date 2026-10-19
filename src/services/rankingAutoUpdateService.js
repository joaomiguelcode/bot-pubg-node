import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { generateRankingPayload } from '../commands/ranking.js';

class RankingAutoUpdateService {
  constructor() {
    this.client = null;
    this.stateFile = config.paths.rankingStateFile;
    this.timer = null;
    this.isUpdating = false;
    this.state = {
      channelId: config.discord.rankingChannelId || null,
      messageId: null,
      modo: 'squad',
      ordenar: 'kills',
      tipo: 'lifetime',
      updatedAt: null,
    };
    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.state = {
            ...this.state,
            ...parsed,
          };
          if (!this.state.channelId && config.discord.rankingChannelId) {
            this.state.channelId = config.discord.rankingChannelId;
          }
          console.log(`[RankingAutoUpdate] Estado carregado. Canal: ${this.state.channelId || 'Nenhum'}, Msg: ${this.state.messageId || 'Nova'}`);
        }
      } else if (config.discord.rankingChannelId) {
        this.state.channelId = config.discord.rankingChannelId;
        this.saveState();
      }
    } catch (err) {
      console.warn('[RankingAutoUpdate] Aviso ao carregar estado do ranking:', err.message);
    }
  }

  saveState() {
    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = `${this.stateFile}.tmp`;
      const dataStr = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(tmpPath, dataStr, 'utf-8');
      try {
        fs.renameSync(tmpPath, this.stateFile);
      } catch {
        fs.copyFileSync(tmpPath, this.stateFile);
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    } catch (err) {
      console.error('[RankingAutoUpdate] Erro ao persistir ranking_state:', err.message);
    }
  }

  init(client) {
    this.client = client;

    // Se houver canal configurado via env que difere do state, prioriza
    if (config.discord.rankingChannelId && config.discord.rankingChannelId !== this.state.channelId) {
      this.state.channelId = config.discord.rankingChannelId;
      this.state.messageId = null;
      this.saveState();
    }

    if (this.state.channelId) {
      console.log(`[RankingAutoUpdate] Ranking automático ativado para o canal ID: ${this.state.channelId} (atualização a cada 1 minuto).`);
    } else {
      console.log('[RankingAutoUpdate] Nenhum canal fixo configurado ainda. Use "/ranking fixar" ou defina RANKING_CHANNEL_ID no .env.');
    }

    // Primeira atualização 5 segundos após inicialização
    setTimeout(() => {
      this.updateFixedRanking();
    }, 5_000);

    // Repete a cada 60 segundos (1 minuto exato)
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.updateFixedRanking();
    }, 60_000);
  }

  async setChannel(channelId, modo = 'squad', ordenar = 'kills', tipo = 'lifetime') {
    this.state.channelId = channelId;
    this.state.messageId = null; // Envia nova mensagem no canal selecionado
    this.state.modo = modo;
    this.state.ordenar = ordenar;
    this.state.tipo = tipo;
    this.state.updatedAt = new Date().toISOString();
    this.saveState();

    return this.updateFixedRanking();
  }

  disable() {
    this.state.channelId = null;
    this.state.messageId = null;
    this.saveState();
  }

  getChannelId() {
    return this.state.channelId;
  }

  async updateFixedRanking() {
    if (!this.state.channelId || !this.client) return null;
    if (this.isUpdating) return null;

    this.isUpdating = true;
    try {
      const channel = await this.client.channels.fetch(this.state.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) {
        console.warn(`[RankingAutoUpdate] Canal ${this.state.channelId} não encontrado ou não permite mensagens.`);
        return null;
      }

      // Gera o embed completo do ranking com dados em cache
      const payload = await generateRankingPayload({
        modo: this.state.modo || 'squad',
        ordenar: this.state.ordenar || 'kills',
        tipo: this.state.tipo || 'lifetime',
        client: this.client,
        guild: channel.guild,
        isAutoUpdate: true,
      });

      if (!payload) return null;

      let targetMessage = null;
      if (this.state.messageId) {
        targetMessage = await channel.messages.fetch(this.state.messageId).catch(() => null);
      }

      if (targetMessage) {
        // Atualiza a mensagem fixa existente
        await targetMessage.edit({
          embeds: payload.embeds,
          files: payload.files,
        });
        this.state.updatedAt = new Date().toISOString();
        this.saveState();
        return targetMessage;
      } else {
        // Envia nova mensagem e fixa o ID
        const newMsg = await channel.send({
          embeds: payload.embeds,
          files: payload.files,
        });
        this.state.messageId = newMsg.id;
        this.state.updatedAt = new Date().toISOString();
        this.saveState();
        console.log(`[RankingAutoUpdate] Nova mensagem fixa enviada no canal #${channel.name} (ID: ${newMsg.id}).`);
        return newMsg;
      }
    } catch (err) {
      console.warn('[RankingAutoUpdate] Aviso durante atualização do ranking fixo:', err.message);
      return null;
    } finally {
      this.isUpdating = false;
    }
  }
}

export const rankingAutoUpdateService = new RankingAutoUpdateService();
