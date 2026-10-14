// Sauvegarde en ligne automatique : stocke les tâches dans Upstash Redis (via Vercel Marketplace).
// Variables d'environnement (ajoutées automatiquement par l'intégration Upstash) :
//   KV_REST_API_URL / KV_REST_API_TOKEN
import { redis, KEYS, REDIS_URL, REDIS_TOKEN } from './_redis.js';

const TOMBSTONE_TTL = 30 * 86400000;
const MAX_TASKS = 5000;

function clean(t) {
  if (!t || typeof t.id !== 'string' || t.id.length > 40) return null;
  const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    id: t.id,
    title: s(t.title, 120),
    date: s(t.date, 10),
    time: s(t.time, 5),
    dur: s(String(t.dur ?? ''), 4),
    note: s(t.note, 500),
    prio: ['high', 'mid', 'low'].includes(t.prio) ? t.prio : 'mid',
    done: !!t.done,
    deleted: !!t.deleted,
    updatedAt: Number(t.updatedAt) || 0,
  };
}

// Pour chaque tâche, la version la plus récente gagne
function merge(a, b) {
  const map = new Map();
  for (const t of [...a, ...b]) {
    const cur = map.get(t.id);
    if (!cur || t.updatedAt > cur.updatedAt) map.set(t.id, t);
  }
  const limit = Date.now() - TOMBSTONE_TTL;
  return [...map.values()].filter(t => !(t.deleted && t.updatedAt < limit));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'Serveur non configuré' });
  }

  try {
    const stored = JSON.parse((await redis(['GET', KEYS.tasks])) || '[]');

    if (req.method === 'GET') return res.status(200).json({ tasks: stored });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

    const incoming = Array.isArray(req.body?.tasks) ? req.body.tasks.map(clean).filter(Boolean) : [];
    const merged = merge(stored.map(clean).filter(Boolean), incoming).slice(0, MAX_TASKS);
    await redis(['SET', KEYS.tasks, JSON.stringify(merged)]);
    return res.status(200).json({ tasks: merged });
  } catch (e) {
    return res.status(502).json({ error: 'Stockage indisponible' });
  }
}
