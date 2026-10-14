// Inscription d'un téléphone aux notifications push.
//   GET  -> clé publique VAPID (nécessaire au téléphone pour s'abonner)
//   POST -> { subscription, tz } enregistre l'abonnement et le fuseau horaire
import { redis, KEYS } from './_redis.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return res.status(500).json({ error: 'Notifications non configurées' });

  if (req.method === 'GET') return res.status(200).json({ publicKey });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const sub = req.body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys) {
    return res.status(400).json({ error: 'Abonnement invalide' });
  }
  try {
    await redis(['HSET', KEYS.subs, sub.endpoint, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys })]);
    const tz = String(req.body?.tz || '');
    if (/^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(tz)) await redis(['SET', KEYS.tz, tz]);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'Stockage indisponible' });
  }
}
