// Accès à Upstash Redis (REST). Les fichiers commençant par "_" ne sont pas des routes sur Vercel.
export const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
export const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const KEYS = {
  tasks: 'ma-semaine:tasks',
  subs: 'ma-semaine:push-subs',
  tz: 'ma-semaine:tz',
  notified: id => `ma-semaine:notified:${id}`,
};

export async function redis(command) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('Redis non configuré');
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}`);
  return (await res.json()).result;
}
