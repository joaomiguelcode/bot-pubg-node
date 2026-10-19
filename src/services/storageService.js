import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

class StorageService {
  constructor() {
    this.filePath = config.paths.storageFile;
    this.dataDir = config.paths.data;
    this.members = new Map(); // discordId -> { pubgNick, platform, pubgId, registeredAt }
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.loadObjectData(parsed);
        console.log(`[Storage] Carregados ${this.members.size} membros de ${this.filePath}`);
        return;
      }

      // Migração automática a partir do membros_cla.json legado (raiz ou pasta anterior)
      const legacyPaths = [config.paths.legacyFileInRoot, config.paths.legacyFileInParent];
      for (const legPath of legacyPaths) {
        if (fs.existsSync(legPath)) {
          console.log(`[Storage] Detectado arquivo legado em: ${legPath}. Iniciando migração...`);
          const legacyRaw = fs.readFileSync(legPath, 'utf-8');
          const legacyData = JSON.parse(legacyRaw);
          this.loadLegacyData(legacyData);
          this.save();
          console.log(`[Storage] Migração concluída com sucesso! ${this.members.size} membros importados.`);
          return;
        }
      }

      // Se nenhum arquivo existir, salva arquivo vazio inicial
      this.save();
    } catch (error) {
      console.error('[Storage] Erro ao inicializar armazenamento:', error);
    }
  }

  loadLegacyData(data) {
    for (const [discordId, nick] of Object.entries(data)) {
      if (typeof nick === 'string') {
        this.members.set(String(discordId), {
          pubgNick: nick.trim(),
          platform: config.pubg.defaultPlatform,
          pubgId: null,
          registeredAt: new Date().toISOString(),
        });
      }
    }
  }

  loadObjectData(data) {
    const seenNicks = new Map(); // nickLower -> discordId
    for (const [discordId, record] of Object.entries(data)) {
      let rec = null;
      if (typeof record === 'string') {
        rec = {
          pubgNick: record.trim(),
          platform: config.pubg.defaultPlatform,
          pubgId: null,
          registeredAt: new Date().toISOString(),
        };
      } else if (record && typeof record === 'object') {
        rec = {
          pubgNick: record.pubgNick ? record.pubgNick.trim() : '',
          platform: (record.platform || config.pubg.defaultPlatform).toLowerCase(),
          pubgId: record.pubgId || null,
          registeredAt: record.registeredAt || new Date().toISOString(),
        };
      }

      if (rec && rec.pubgNick) {
        const lower = rec.pubgNick.toLowerCase();
        // Se houver duplicata do mesmo nick por IDs diferentes, mantém o mais recente
        if (seenNicks.has(lower)) {
          const prevId = seenNicks.get(lower);
          const prevRec = this.members.get(prevId);
          if (new Date(rec.registeredAt) > new Date(prevRec?.registeredAt || 0)) {
            this.members.delete(prevId);
            this.members.set(String(discordId), rec);
            seenNicks.set(lower, String(discordId));
          }
        } else {
          this.members.set(String(discordId), rec);
          seenNicks.set(lower, String(discordId));
        }
      }
    }
  }

  save() {
    try {
      const obj = {};
      for (const [discordId, record] of this.members.entries()) {
        obj[discordId] = record;
      }
      const dataStr = JSON.stringify(obj, null, 2);
      const tmpPath = `${this.filePath}.tmp`;

      // Escrita segura compatível com Windows
      try {
        fs.writeFileSync(tmpPath, dataStr, 'utf-8');
        try {
          fs.renameSync(tmpPath, this.filePath);
        } catch {
          fs.copyFileSync(tmpPath, this.filePath);
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }
      } catch {
        fs.writeFileSync(this.filePath, dataStr, 'utf-8');
      }
    } catch (error) {
      console.error('[Storage] Erro ao persistir dados:', error);
    }
  }

  getAllMembers() {
    const list = [];
    for (const [discordId, record] of this.members.entries()) {
      list.push({
        discordId,
        ...record,
      });
    }
    return list;
  }

  getMember(discordId) {
    if (!discordId) return null;
    return this.members.get(String(discordId)) || null;
  }

  findMemberByNick(nick) {
    if (!nick) return null;
    const lower = nick.trim().toLowerCase();
    for (const [discordId, record] of this.members.entries()) {
      if (record.pubgNick.toLowerCase() === lower) {
        return { discordId, ...record };
      }
    }
    return null;
  }

  registerMember(discordId, pubgNick, platform = config.pubg.defaultPlatform, pubgId = null) {
    const cleanNick = pubgNick.trim();
    const cleanPlatform = platform.toLowerCase();

    // Se outro ID de Discord tinha esse mesmo nick, desvincula o anterior
    const existing = this.findMemberByNick(cleanNick);
    if (existing && existing.discordId !== String(discordId)) {
      this.members.delete(existing.discordId);
    }

    const record = {
      pubgNick: cleanNick,
      platform: cleanPlatform,
      pubgId: pubgId || existing?.pubgId || null,
      registeredAt: new Date().toISOString(),
    };
    this.members.set(String(discordId), record);
    this.save();
    return record;
  }

  updatePlayerId(discordId, pubgId) {
    if (!discordId || !pubgId) return;
    const member = this.members.get(String(discordId));
    if (member && member.pubgId !== pubgId) {
      member.pubgId = pubgId;
      this.save();
    }
  }

  unregisterMember(discordId) {
    if (!discordId) return false;
    const removed = this.members.delete(String(discordId));
    if (removed) {
      this.save();
    }
    return removed;
  }

  count() {
    return this.members.size;
  }
}

export const storageService = new StorageService();
