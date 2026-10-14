// Envoie les rappels des tâches URGENTES. À appeler toutes les 5 minutes par un cron :
//   GET /api/notify   avec l'en-tête  Authorization: Bearer <CRON_SECRET>   (ou ?key=<CRON_SECRET>)
// Règles :
//   - tâche urgente avec heure : rappel 15 min avant (jusqu'à 1 h après si le cron a du retard)
//   - tâche urgente sans heure : rappel le jour même à partir de 8 h
// Chaque rappel n'est envoyé qu'une seule fois.
import webpush from 'web-push';
import { redis, KEYS } from './_redis.js';

const BEFORE_MIN = 15;
const MORNING_MIN = 8 * 60;

function nowIn(tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: +parts.hour * 60 + +parts.minute };
}

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization || '').replace(/^Bearer /, '') || new URL(req.url, 'http://x').searchParams.get('key');
  if (!secret || given !== secret) return res.status(401).json({ error: 'Non autorisé' });

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return res.status(500).json({ error: 'Clés VAPID manquantes' });
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:ma-semaine@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  try {
    const tz = (await redis(['GET', KEYS.tz])) || 'Europe/Paris';
    const now = nowIn(tz);
    const tasks = JSON.parse((await redis(['GET', KEYS.tasks])) || '[]');

    const due = tasks.filter(t => {
      if (t.prio !== 'high' || t.done || t.deleted || t.date !== now.date) return false;
      if (t.time) {
        const m = toMin(t.time);
        return now.min >= m - BEFORE_MIN && now.min <= m + 60;
      }
      return now.min >= MORNING_MIN;
    });
    if (!due.length) return res.status(200).json({ sent: 0 });

    const flat = (await redis(['HGETALL', KEYS.subs])) || [];
    const subs = [];
    for (let i = 0; i < flat.length; i += 2) subs.push(JSON.parse(flat[i + 1]));

    let sent = 0;
    for (const t of due) {
      // Marque le rappel comme envoyé (atomique) : évite les doublons
      const key = KEYS.notified(`${t.id}:${t.date}:${t.time || 'jour'}`);
      if ((await redis(['SET', key, '1', 'NX', 'EX', '259200'])) !== 'OK') continue;

      const payload = JSON.stringify({
        title: `🔴 Urgent${t.time ? ' · ' + t.time : " · aujourd'hui"}`,
        body: t.title + (t.note ? '\n' + t.note : ''),
        tag: t.id,
      });
      for (const sub of subs) {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' });
          sent++;
        } catch (e) {
          // Abonnement expiré (app supprimée, notifications coupées…) : on l'oublie
          if (e.statusCode === 404 || e.statusCode === 410) await redis(['HDEL', KEYS.subs, sub.endpoint]);
        }
      }
    }
    return res.status(200).json({ sent });
  } catch (e) {
    return res.status(502).json({ error: 'Erreur pendant l\'envoi' });
  }
}
