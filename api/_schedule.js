// Programme les rappels des tâches urgentes avec Upstash QStash :
// QStash appellera /api/notify à l'heure exacte du rappel (aucun cron externe nécessaire).
import { redis, KEYS } from './_redis.js';

export const BEFORE_MIN = 15;
export const MORNING = '08:00';

const QSTASH_URL = process.env.QSTASH_URL || 'https://qstash.upstash.io';
const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

// Convertit une date/heure locale (dans le fuseau tz) en timestamp UTC (ms)
export function zonedToEpoch(date, hhmm, tz) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess)).map(x => [x.type, x.value]),
  );
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - guess;
  return guess - offset;
}

// Moment du rappel pour une tâche urgente
export function reminderAt(t, tz) {
  return t.time
    ? zonedToEpoch(t.date, t.time, tz) - BEFORE_MIN * 60000
    : zonedToEpoch(t.date, MORNING, tz);
}

export async function scheduleReminders(tasks, baseUrl) {
  if (!QSTASH_TOKEN || !process.env.CRON_SECRET) return 0;
  const tz = (await redis(['GET', KEYS.tz])) || 'Europe/Paris';
  const now = Date.now();
  let scheduled = 0;

  for (const t of tasks) {
    if (t.prio !== 'high' || t.done || t.deleted || !t.date) continue;
    const at = reminderAt(t, tz);
    const end = t.time ? at + (BEFORE_MIN + 60) * 60000 : zonedToEpoch(t.date, '23:59', tz);
    if (end < now) continue; // déjà passé

    // Un seul message programmé par rappel (même tâche, même jour, même heure)
    const key = `ma-semaine:scheduled:${t.id}:${t.date}:${t.time || 'jour'}`;
    if ((await redis(['SET', key, '1', 'NX', 'EX', '2678400'])) !== 'OK') continue;

    const res = await fetch(`${QSTASH_URL}/v2/publish/${baseUrl}/api/notify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        'Upstash-Not-Before': String(Math.floor(Math.max(at, now) / 1000)),
        'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET}`,
        'Upstash-Method': 'GET',
        'Upstash-Retries': '3',
      },
    });
    if (res.ok) scheduled++;
    else await redis(['DEL', key]); // on réessaiera à la prochaine sauvegarde
  }
  return scheduled;
}
