import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export class PubgApiError extends Error {
  constructor(message, status = 500, userMessage = null) {
    super(message);
    this.name = 'PubgApiError';
    this.status = status;
    this.isRateLimit = status === 429;
    this.userMessage = userMessage || message;
  }
}

class PubgService {
  constructor() {
    this.cache = new Map(); // key -> { data, timestamp }
    this.cacheFile = config.paths.cacheFile;
    this.ttl = config.pubg.cacheTtlMs;
    this.baseUrl = config.pubg.apiBaseUrl;
    this.token = config.pubg.token;

    // Controle de taxa (Rate Limit): máximo 9 requisições por janela de 60s (limite oficial é 10/min)
    this.requestTimestamps = [];
    this.maxRequestsPerMinute = 9;
    this.windowMs = 60_000;

    this.saveTimeout = null;
    this.initCache();
  }

  getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.api+json',
    };
  }

  initCache() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) {
            if (value && value.data !== undefined) {
              this.cache.set(key, value);
            }
          }
          console.log(`[PubgService] Cache persistente carregado com ${this.cache.size} entradas.`);
        }
      }
    } catch (err) {
      console.warn('[PubgService] Não foi possível carregar cache persistente:', err.message);
    }
  }

  scheduleSaveCache() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        const obj = {};
        for (const [key, value] of this.cache.entries()) {
          // Salva apenas entradas válidas
          if (value && value.data !== undefined) {
            obj[key] = value;
          }
        }
        const dir = path.dirname(this.cacheFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const tmpPath = `${this.cacheFile}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf-8');
        try {
          fs.renameSync(tmpPath, this.cacheFile);
        } catch {
          fs.copyFileSync(tmpPath, this.cacheFile);
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }
      } catch (err) {
        console.warn('[PubgService] Erro ao salvar cache persistente:', err.message);
      }
    }, 2000);
  }

  getFromCache(key, maxAge = this.ttl) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > maxAge) {
      return null;
    }
    return entry.data;
  }

  getStaleFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry || entry.data === undefined) return null;
    return entry.data;
  }

  setInCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
    this.scheduleSaveCache();
  }

  clearCache() {
    this.cache.clear();
  }

  /**
   * Monitora a janela de requisições recentes.
   * Retorna true se houver cota disponível ou false se estamos no limite.
   */
  canMakeRequest() {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < this.windowMs);
    return this.requestTimestamps.length < this.maxRequestsPerMinute;
  }

  /**
   * Registra uma requisição feita e agenda liberação de cota.
   */
  recordRequest() {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Aguarda slot disponível na taxa de requisições se necessário (máximo timeoutMs).
   */
  async waitForRateLimitSlot(timeoutMs = 12000) {
    const start = Date.now();
    while (!this.canMakeRequest()) {
      if (Date.now() - start >= timeoutMs) {
        return false;
      }
      const oldest = this.requestTimestamps[0] || Date.now();
      const waitTime = Math.max(200, oldest + this.windowMs - Date.now() + 100);
      const safeWait = Math.min(waitTime, 1000);
      await new Promise((r) => setTimeout(r, safeWait));
    }
    return true;
  }

  /**
   * Busca lista de temporadas para a plataforma informada e identifica a temporada atual.
   * Cache de 24 horas para evitar chamadas desnecessárias à API.
   */
  async getCurrentSeason(platform = config.pubg.defaultPlatform) {
    const cacheKey = `seasons:${platform}`;
    const seasonTtl = 24 * 60 * 60 * 1000; // 24 horas
    const cached = this.getFromCache(cacheKey, seasonTtl);
    if (cached) return cached;

    if (!this.canMakeRequest()) {
      const stale = this.getStaleFromCache(cacheKey);
      if (stale) return stale;
    }

    try {
      this.recordRequest();
      const url = `${this.baseUrl}/shards/${platform}/seasons`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) {
        console.warn(`[PubgService] Falha ao buscar temporadas: HTTP ${res.status}`);
        return this.getStaleFromCache(cacheKey);
      }
      const data = await res.json();
      const current =
        data.data?.find((s) => s.attributes?.isCurrentSeason && !s.attributes?.isOffseason) ||
        data.data?.find((s) => s.attributes?.isCurrentSeason);

      if (current) {
        this.setInCache(cacheKey, current.id);
        return current.id;
      }
    } catch (err) {
      console.error('[PubgService] Erro ao obter temporada atual:', err.message);
    }
    return this.getStaleFromCache(cacheKey);
  }

  /**
   * Busca um único jogador pelo Nick e Plataforma.
   * Utiliza cache de longa duração (30 dias) pois o account ID é imutável.
   */
  async getPlayerByName(playerName, platform = config.pubg.defaultPlatform) {
    if (!playerName || !playerName.trim()) return null;
    const cleanName = playerName.trim();
    const cacheKey = `player:${platform}:${cleanName.toLowerCase()}`;

    // Account IDs nunca mudam no PUBG, então cache de 30 dias é seguro
    const accountTtl = 30 * 24 * 60 * 60 * 1000;
    const cached = this.getFromCache(cacheKey, accountTtl);
    if (cached) return cached;

    const hasSlot = await this.waitForRateLimitSlot(5000);
    if (!hasSlot) {
      const stale = this.getStaleFromCache(cacheKey);
      if (stale) return stale;
      throw new PubgApiError(
        'Limite de requisições à API do PUBG atingido.',
        429,
        '⚠️ A API do PUBG atingiu o limite de consultas por minuto. Por favor, aguarde 30 segundos e tente novamente.'
      );
    }

    try {
      this.recordRequest();
      const url = `${this.baseUrl}/shards/${platform}/players?filter[playerNames]=${encodeURIComponent(cleanName)}`;
      const res = await fetch(url, { headers: this.getHeaders() });

      if (res.status === 404) return null;
      if (res.status === 429) {
        const stale = this.getStaleFromCache(cacheKey);
        if (stale) {
          console.warn(`[PubgService] 429 Rate limit - usando cache existente para jogador ${cleanName}`);
          return stale;
        }
        throw new PubgApiError(
          'Limite de requisições à API do PUBG atingido.',
          429,
          '⚠️ Limite de requisições da API do PUBG atingido. Aguarde 30 a 60 segundos.'
        );
      }
      if (!res.ok) {
        const stale = this.getStaleFromCache(cacheKey);
        if (stale) return stale;
        throw new PubgApiError(
          `Falha na API do PUBG: HTTP ${res.status}`,
          res.status,
          `⚠️ Falha na comunicação com a API do PUBG (HTTP ${res.status}). Tente novamente em instantes.`
        );
      }

      const data = await res.json();
      if (!data.data || data.data.length === 0) return null;

      const player = {
        id: data.data[0].id,
        name: data.data[0].attributes.name,
        platform,
      };

      this.setInCache(cacheKey, player);
      return player;
    } catch (err) {
      const stale = this.getStaleFromCache(cacheKey);
      if (stale) return stale;
      if (err instanceof PubgApiError) throw err;
      throw new PubgApiError(
        err.message,
        500,
        `⚠️ Erro de conexão com a API do PUBG: ${err.message}`
      );
    }
  }

  /**
   * Busca múltiplos jogadores em lote (até 10 por requisição).
   */
  async getPlayersBatch(playerNames, platform = config.pubg.defaultPlatform) {
    const results = new Map();
    const missingNames = [];
    const accountTtl = 30 * 24 * 60 * 60 * 1000;

    for (const name of playerNames) {
      if (!name) continue;
      const cacheKey = `player:${platform}:${name.toLowerCase()}`;
      const cached = this.getFromCache(cacheKey, accountTtl) || this.getStaleFromCache(cacheKey);
      if (cached) {
        results.set(name.toLowerCase(), cached);
      } else {
        missingNames.push(name);
      }
    }

    if (missingNames.length === 0) {
      return results;
    }

    const chunkSize = 10;
    const chunks = [];
    for (let i = 0; i < missingNames.length; i += chunkSize) {
      chunks.push(missingNames.slice(i, i + chunkSize));
    }

    for (const chunk of chunks) {
      if (!this.canMakeRequest()) {
        const waitOk = await this.waitForRateLimitSlot(6000);
        if (!waitOk) {
          console.warn('[PubgService] Sem cota para buscar lote restante de jogadores.');
          break;
        }
      }

      try {
        this.recordRequest();
        const joined = chunk.map((n) => encodeURIComponent(n)).join(',');
        const url = `${this.baseUrl}/shards/${platform}/players?filter[playerNames]=${joined}`;
        const res = await fetch(url, { headers: this.getHeaders() });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.data)) {
            for (const item of data.data) {
              const p = {
                id: item.id,
                name: item.attributes.name,
                platform,
              };
              results.set(p.name.toLowerCase(), p);
              this.setInCache(`player:${platform}:${p.name.toLowerCase()}`, p);
            }
          }
        } else if (res.status === 429) {
          console.warn('[PubgService] Rate limit atingido durante batch de jogadores.');
          break;
        }
      } catch (err) {
        console.error('[PubgService] Erro no lote de jogadores:', err.message);
      }
    }

    return results;
  }

  /**
   * Busca as estatísticas de um jogador (Vitalício ou Temporada).
   * Suporta stale-while-revalidate e fallback resiliente em caso de rate limit.
   */
  async getPlayerStats(playerId, platform = config.pubg.defaultPlatform, seasonId = null, allowStale = true) {
    if (!playerId) return null;
    const modeType = seasonId ? seasonId : 'lifetime';
    const cacheKey = `stats:${platform}:${playerId}:${modeType}`;

    // 1. Tenta cache fresco
    const cached = this.getFromCache(cacheKey, this.ttl);
    if (cached) return cached;

    // 2. Se a taxa de requisições está perto do limite e permitimos stale, usa o cache existente
    const staleData = this.getStaleFromCache(cacheKey);
    if (!this.canMakeRequest() && allowStale && staleData) {
      console.log(`[PubgService] Usando estatísticas em cache recente para ${playerId} para respeitar rate limit.`);
      return staleData;
    }

    // 3. Aguarda slot breve se necessário
    const hasSlot = await this.waitForRateLimitSlot(3000);
    if (!hasSlot && allowStale && staleData) {
      console.log(`[PubgService] Timeout aguardando slot - usando cache existente para ${playerId}`);
      return staleData;
    }

    const endpoint = seasonId
      ? `${this.baseUrl}/shards/${platform}/players/${playerId}/seasons/${seasonId}`
      : `${this.baseUrl}/shards/${platform}/players/${playerId}/seasons/lifetime`;

    try {
      this.recordRequest();
      const res = await fetch(endpoint, { headers: this.getHeaders() });

      if (res.status === 429) {
        if (allowStale && staleData) {
          console.warn(`[PubgService] 429 recebido para ${playerId}. Retornando cache anterior.`);
          return staleData;
        }
        throw new PubgApiError(
          'Limite de requisições atingido. Aguarde alguns instantes.',
          429,
          '⚠️ Limite de requisições da API do PUBG atingido. Aguarde alguns segundos.'
        );
      }

      if (!res.ok) {
        if (allowStale && staleData) {
          console.warn(`[PubgService] HTTP ${res.status} para ${playerId}. Retornando cache anterior.`);
          return staleData;
        }
        return null;
      }

      const data = await res.json();
      const gameModeStats = data.data?.attributes?.gameModeStats;
      if (!gameModeStats) {
        return staleData || null;
      }

      this.setInCache(cacheKey, gameModeStats);
      return gameModeStats;
    } catch (err) {
      if (allowStale && staleData) {
        console.warn(`[PubgService] Erro ao buscar stats de ${playerId} (${err.message}). Retornando cache anterior.`);
        return staleData;
      }
      if (err instanceof PubgApiError) throw err;
      throw new PubgApiError(
        err.message,
        500,
        `⚠️ Falha ao buscar estatísticas: ${err.message}`
      );
    }
  }

  /**
   * Extrai e formata métricas ricas para um determinado modo de jogo.
   */
  formatModeStats(rawStats) {
    if (!rawStats) {
      return {
        kills: 0,
        wins: 0,
        losses: 0,
        roundsPlayed: 0,
        top10s: 0,
        revives: 0,
        assists: 0,
        dBNOs: 0,
        damageDealt: 0,
        headshotKills: 0,
        longestKill: 0,
        roundMostKills: 0,
        kd: '0.00',
        winRate: '0.0%',
        top10Rate: '0.0%',
        adr: '0.0',
        headshotRate: '0.0%',
      };
    }

    const kills = rawStats.kills || 0;
    const wins = rawStats.wins || 0;
    const losses = rawStats.losses || 0;
    const rounds = rawStats.roundsPlayed || (wins + losses) || 0;
    const top10s = rawStats.top10s || 0;
    const revives = rawStats.revives || 0;
    const assists = rawStats.assists || 0;
    const dBNOs = rawStats.dBNOs || 0;
    const damage = rawStats.damageDealt || 0;
    const headshots = rawStats.headshotKills || 0;
    const longestKill = rawStats.longestKill || 0;
    const roundMostKills = rawStats.roundMostKills || 0;

    // Cálculo de K/D (Kills por mortes)
    const deaths = rounds - wins > 0 ? rounds - wins : (losses > 0 ? losses : 1);
    const kd = rounds > 0 ? (kills / Math.max(deaths, 1)).toFixed(2) : '0.00';

    // Win Rate e Top 10 Rate
    const winRate = rounds > 0 ? ((wins / rounds) * 100).toFixed(1) + '%' : '0.0%';
    const top10Rate = rounds > 0 ? ((top10s / rounds) * 100).toFixed(1) + '%' : '0.0%';

    // ADR (Average Damage per Round)
    const adr = rounds > 0 ? (damage / rounds).toFixed(1) : '0.0';

    // Headshot %
    const headshotRate = kills > 0 ? ((headshots / kills) * 100).toFixed(1) + '%' : '0.0%';

    return {
      kills,
      wins,
      losses,
      roundsPlayed: rounds,
      top10s,
      revives,
      assists,
      dBNOs,
      damageDealt: Math.round(damage),
      headshotKills: headshots,
      longestKill: Number(longestKill.toFixed(1)),
      roundMostKills,
      kd,
      winRate,
      top10Rate,
      adr,
      headshotRate,
    };
  }
}

export const pubgService = new PubgService();
