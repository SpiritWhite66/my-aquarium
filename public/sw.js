// Service worker de l'appli : celui d'Angular (cache hors ligne) + rappels quotidiens en arrière-plan.
// Le texte des rappels est préparé par l'appli dans IndexedDB (table prefs) : ici on ne fait que l'afficher.
importScripts('./ngsw-worker.js');

const SYNC_TAG = 'aquarium-reminders';

self.addEventListener('periodicsync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(remind());
});

// Rappel envoyé par le serveur (compte connecté) : même étiquette que les rappels locaux, la
// notification du jour remplace l'autre au lieu de doubler, et le jour est noté comme fait.
self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    return;
  }
  if (!data || data.tag !== 'aquarium-daily') return;
  event.waitUntil(
    self.registration
      .showNotification(data.title, { body: data.body, icon: 'icons/icon-192x192.png', badge: 'icons/icon-192x192.png', tag: 'aquarium-daily' })
      .then(markShown),
  );
});

async function markShown() {
  const dbs = await indexedDB.databases?.();
  if (dbs && !dbs.some((d) => d.name === 'my-aquarium')) return;
  const db = await request(indexedDB.open('my-aquarium'));
  try {
    if (!db.objectStoreNames.contains('prefs')) return;
    const prefs = await request(db.transaction('prefs').objectStore('prefs').get('notifications'));
    if (!prefs) return;
    const tx = db.transaction('prefs', 'readwrite');
    tx.objectStore('prefs').put({ ...prefs, lastShown: localDay(new Date()) });
    await new Promise((r) => (tx.oncomplete = r));
  } finally {
    db.close();
  }
}

self.addEventListener('notificationclick', (event) => {
  if (event.notification.tag !== 'aquarium-daily') return;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function localDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function remind() {
  // N'ouvre pas (et donc ne crée pas) la base si l'appli ne l'a pas encore créée.
  const dbs = await indexedDB.databases?.();
  if (dbs && !dbs.some((d) => d.name === 'my-aquarium')) return;
  const db = await request(indexedDB.open('my-aquarium'));
  try {
    if (!db.objectStoreNames.contains('prefs')) return;
    const prefs = await request(db.transaction('prefs').objectStore('prefs').get('notifications'));
    const now = new Date();
    const today = localDay(now);
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (!prefs?.enabled || prefs.lastShown === today || hm < prefs.time) return;
    let digest = prefs.digests?.[today];
    // Rappels préparés épuisés : on prévient plutôt que de se taire (même texte que STALE_DIGEST).
    if (!digest && prefs.digestsUntil && today > prefs.digestsUntil) {
      digest = { title: 'Rappels à mettre à jour', body: 'Ouvre l’appli pour que les rappels de tes bacs continuent.' };
    }
    if (!digest) return;
    await self.registration.showNotification(digest.title, { body: digest.body, icon: 'icons/icon-192x192.png', badge: 'icons/icon-192x192.png', tag: 'aquarium-daily' });
    const tx = db.transaction('prefs', 'readwrite');
    tx.objectStore('prefs').put({ ...prefs, lastShown: today });
    await new Promise((r) => (tx.oncomplete = r));
  } finally {
    db.close();
  }
}
