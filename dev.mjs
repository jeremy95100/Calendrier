// Serveur local de développement : sert l'app + /api/*, avec un faux Redis stocké dans .dev-data.json
// Lancer : npm run dev   (port : variable PORT, 3000 par défaut)
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import webpush from 'web-push';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(ROOT, '.dev-data.json');

async function readDb() { try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch { return {}; } }
const writeDb = db => fs.writeFile(DATA_FILE, JSON.stringify(db));

// Clés de notification de développement, gardées entre deux lancements
const db0 = await readDb();
if (!db0.__vapid) { db0.__vapid = webpush.generateVAPIDKeys(); await writeDb(db0); }
process.env.VAPID_PUBLIC_KEY ||= db0.__vapid.publicKey;
process.env.VAPID_PRIVATE_KEY ||= db0.__vapid.privateKey;
process.env.CRON_SECRET ||= 'dev';
process.env.KV_REST_API_URL = `http://127.0.0.1:${PORT}/__redis`;
process.env.KV_REST_API_TOKEN = 'dev';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

// Mini Redis : uniquement les commandes utilisées par l'app
async function fakeRedis(req, res) {
  const [cmd, key, ...args] = JSON.parse(await readBody(req));
  const db = await readDb();
  let result = null;
  if (cmd === 'GET') result = db[key] ?? null;
  else if (cmd === 'SET') {
    if (!(args.includes('NX') && key in db)) { db[key] = args[0]; result = 'OK'; }
  } else if (cmd === 'HSET') { db[key] = { ...(db[key] || {}), [args[0]]: args[1] }; result = 1; }
  else if (cmd === 'HGETALL') result = Object.entries(db[key] || {}).flat();
  else if (cmd === 'HDEL') { if (db[key]) delete db[key][args[0]]; result = 1; }
  await writeDb(db);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ result }));
}

async function api(name, req, res) {
  let mod;
  try { mod = await import(pathToFileURL(path.join(ROOT, 'api', name + '.js'))); } catch { return res.writeHead(404).end(); }
  const raw = await readBody(req);
  try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  await mod.default(req, res);
}

async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || p.startsWith('/.') || p.startsWith('/node_modules')) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('Introuvable');
  }
}

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/__redis') return fakeRedis(req, res);
  const m = p.match(/^\/api\/([a-z]+)$/);
  if (m) return api(m[1], req, res);
  return serveStatic(req, res);
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}`);
  console.log(`\nMa Semaine en local :`);
  console.log(`  Sur ce PC      : http://localhost:${PORT}`);
  lan.forEach(u => console.log(`  Sur le telephone (meme Wi-Fi) : ${u}`));
  console.log('');
});
