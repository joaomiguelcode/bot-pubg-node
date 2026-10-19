import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Decodifica o ID do bot a partir do token se não fornecido
function resolveClientId(token, explicitId) {
  if (explicitId && explicitId.trim().length > 0) return explicitId.trim();
  if (!token) return '';
  try {
    const firstPart = token.split('.')[0];
    const decoded = Buffer.from(firstPart, 'base64').toString('utf-8');
    if (/^\d+$/.test(decoded)) return decoded;
  } catch {
    // ignora e retorna vazio
  }
  return '';
}

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    clientId: resolveClientId(process.env.DISCORD_TOKEN, process.env.DISCORD_CLIENT_ID),
    prefix: process.env.COMMAND_PREFIX || '!',
    voiceChannelId: process.env.VOICE_CHANNEL_ID || '1556381353451192461',
    rankingChannelId: process.env.RANKING_CHANNEL_ID || '1555144136774914149',
  },
  pubg: {
    token: process.env.PUBG_TOKEN || '',
    defaultPlatform: (process.env.PUBG_PLATFORM || 'steam').toLowerCase(),
    cacheTtlMs: (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 900) * 1000, // 15 minutos padrão
    apiBaseUrl: 'https://api.pubg.com',
  },
  clan: {
    name: process.env.CLAN_NAME || 'Nocturnal Knights',
    imageFile: process.env.IMAGE_FILE || 'image_ca0257.jpg',
  },
  paths: {
    root: rootDir,
    data: path.join(rootDir, 'data'),
    storageFile: path.join(rootDir, 'data', 'membros.json'),
    cacheFile: path.join(rootDir, 'data', 'pubg_cache.json'),
    rankingStateFile: path.join(rootDir, 'data', 'ranking_state.json'),
    legacyFileInRoot: path.join(rootDir, 'membros_cla.json'),
    legacyFileInParent: path.resolve(rootDir, '..', 'membros_cla.json'),
  },
};
