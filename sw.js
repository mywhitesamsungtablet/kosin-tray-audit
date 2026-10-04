/* KOSIN Tray Audit — Service Worker: เก็บไฟล์แอป + ข้อมูลหลักไว้ในเครื่อง ใช้ offline ได้
 * เปลี่ยนเวอร์ชันแอปเมื่อไหร่ ต้องเปลี่ยน CACHE ด้วย (ตรงกับ APP_VERSION ใน logic.js) ไม่งั้นเครื่องช่างค้างไฟล์เก่า
 */
const CACHE = 'kta-1.04';
const FILES = ['./', 'index.html', 'styles.css', 'logic.js', 'db.js', 'xlsx.js', 'app.js', 'manifest.webmanifest',
  'data/master.json', 'data/products.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// ไฟล์แอป: ใช้ของในเครื่องก่อน (ทำงานได้แม้ไม่มีเน็ต) แล้วค่อยอัปเดตเบื้องหลังเมื่อมีเน็ต
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('ออฟไลน์ และยังไม่มีไฟล์นี้ในเครื่อง', { status: 503 });
  }));
});
