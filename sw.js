// Cache hors-ligne : l'app fonctionne même sans réseau
const CACHE = 'ma-semaine-v6';
const BADGE_CACHE = 'ma-semaine-badge';
const FILES = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE && k !== BADGE_CACHE).map(k => caches.delete(k)),
  )));
  self.clients.claim();
});

// Réseau d'abord (pour recevoir les mises à jour), cache si hors-ligne
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});

/* Pastille rouge sur l'icône (comme Messages) : nombre de notifications non lues */
async function badgeCount() {
  const r = await (await caches.open(BADGE_CACHE)).match('/__badge');
  return r ? Number(await r.text()) || 0 : 0;
}
async function setBadge(n) {
  n = Math.max(0, n);
  await (await caches.open(BADGE_CACHE)).put('/__badge', new Response(String(n)));
  if (!('setAppBadge' in self.navigator)) return;
  try { n ? await self.navigator.setAppBadge(n) : await self.navigator.clearAppBadge(); } catch {}
}

// Notification push (tâches urgentes), reçue même quand l'app est fermée
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(data.title || '🔴 Tâche urgente', {
      body: data.body || '',
      tag: data.tag,
      icon: 'icon-512.png',
      requireInteraction: true,
      data: { url: '/' },
    });
    await setBadge((await badgeCount()) + 1);
  })());
});

// Toucher la notification : elle s'efface, la pastille diminue, l'app s'ouvre
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    await setBadge((await badgeCount()) - 1);
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = list.find(c => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('/');
  })());
});

// Notification balayée sans l'ouvrir : la pastille diminue aussi
self.addEventListener('notificationclose', e => {
  e.waitUntil((async () => setBadge((await badgeCount()) - 1))());
});

// L'app ouverte demande d'effacer la pastille et les notifications
self.addEventListener('message', e => {
  if (e.data !== 'clear-badge') return;
  e.waitUntil((async () => {
    (await self.registration.getNotifications()).forEach(n => n.close());
    await setBadge(0);
  })());
});
