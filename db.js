/* KOSIN Tray Audit — ฐานข้อมูลในเครื่อง (IndexedDB)
 * ตารางแยกตามระดับ (มาตรฐาน KOSIN): customers · audits · departments · trays · items · damages · photos
 * ทุกการเขียนผ่าน put()/del() เท่านั้น -> บันทึก editlog ระดับช่อง (ใคร/เมื่อไหร่/ตาราง/แถว/ช่อง/ค่าเดิม/ค่าใหม่)
 * รหัสแถว = <รหัสเครื่อง>-<ตัวอักษรตาราง><เลขรัน> ; เลขรันออกจาก "ค่าสูงสุดที่มีจริง +1" (มาตรฐาน §6 ข้อ 7)
 */
const DB = (() => {
  'use strict';
  const NAME = 'kosin-tray-audit';
  const VERSION = 1;
  const STORES = {
    customers: { prefix: 'C', idx: [] },
    audits: { prefix: 'A', idx: ['customerId'] },
    departments: { prefix: 'D', idx: ['auditId'] },
    trays: { prefix: 'T', idx: ['departmentId'] },
    items: { prefix: 'I', idx: ['trayId'] },
    damages: { prefix: 'G', idx: ['itemId'] },
    photos: { prefix: 'P', idx: ['ownerId'] },
  };
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        for (const [name, def] of Object.entries(STORES)) {
          const s = d.createObjectStore(name, { keyPath: 'id' });
          for (const i of def.idx) s.createIndex(i, i);
        }
        d.createObjectStore('editlog', { keyPath: 'seq', autoIncrement: true });
        d.createObjectStore('meta', { keyPath: 'key' });
        d.createObjectStore('trash', { keyPath: 'trashId', autoIncrement: true });
      };
      rq.onsuccess = () => { db = rq.result; resolve(db); };
      rq.onerror = () => reject(rq.error);
    });
  }

  function tx(stores, mode) { return db.transaction(stores, mode); }
  function done(t) {
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  async function getMeta(key, dflt = null) {
    const r = await req(tx(['meta'], 'readonly').objectStore('meta').get(key));
    return r ? r.value : dflt;
  }
  async function setMeta(key, value) {
    const t = tx(['meta'], 'readwrite');
    t.objectStore('meta').put({ key, value });
    await done(t);
  }

  async function deviceId() {
    let d = await getMeta('deviceId');
    if (!d) {
      d = 'K' + Math.random().toString(36).slice(2, 6).toUpperCase();
      await setMeta('deviceId', d);
    }
    return d;
  }

  async function nextId(store) {
    const dev = await deviceId();
    const p = `${dev}-${STORES[store].prefix}`;
    const all = await req(tx([store], 'readonly').objectStore(store).getAllKeys());
    const trashed = await req(tx(['trash'], 'readonly').objectStore('trash').getAll());
    let max = 0;
    for (const k of all.concat(trashed.filter(t => t.store === store).map(t => t.row.id)))
      if (typeof k === 'string' && k.startsWith(p)) max = Math.max(max, parseInt(k.slice(p.length), 10) || 0);
    return p + String(max + 1).padStart(5, '0');
  }

  const get = (store, id) => req(tx([store], 'readonly').objectStore(store).get(id));
  const all = store => req(tx([store], 'readonly').objectStore(store).getAll());
  const by = (store, index, value) => req(tx([store], 'readonly').objectStore(store).index(index).getAll(value));

  /** เขียน 1 แถว + บันทึกช่องที่เปลี่ยน ; row ไม่มี id = แถวใหม่ */
  async function put(store, row, who) {
    const now = new Date().toISOString();
    const isNew = !row.id;
    if (isNew) { row.id = await nextId(store); row.createdAt = now; row.createdBy = who; }
    const before = isNew ? {} : (await get(store, row.id)) || {};
    row.updatedAt = now; row.updatedBy = who;
    const t = tx([store, 'editlog'], 'readwrite');
    t.objectStore(store).put(row);
    const log = t.objectStore('editlog');
    for (const k of Object.keys(row)) {
      if (['updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'blob'].includes(k)) continue;
      const a = JSON.stringify(before[k] ?? null), b = JSON.stringify(row[k] ?? null);
      if (a !== b) log.add({ at: now, by: who, store, id: row.id, field: k, from: before[k] ?? null, to: row[k] ?? null });
    }
    await done(t);
    return row;
  }

  /** ลบ = ย้ายไปถังขยะ (กู้คืนได้) พร้อมลูกทั้งหมด */
  async function del(store, id, who) {
    const rows = await collect(store, id);
    const now = new Date().toISOString();
    const batch = 'B' + Date.now();
    const names = [...new Set(rows.map(r => r.store))];
    const t = tx(names.concat(['trash', 'editlog']), 'readwrite');
    for (const r of rows) {
      t.objectStore('trash').add({ batch, at: now, by: who, store: r.store, row: r.row });
      t.objectStore(r.store).delete(r.row.id);
      t.objectStore('editlog').add({ at: now, by: who, store: r.store, id: r.row.id, field: '(ลบ)', from: null, to: batch });
    }
    await done(t);
    return rows.length;
  }

  /** แถวนี้ + ลูกหลานทั้งหมด (ใช้ทั้งลบและนับก่อนยืนยันลบ) */
  async function collect(store, id) {
    const out = [];
    const self = await get(store, id);
    if (!self) return out;
    out.push({ store, row: self });
    const kids = { audits: ['departments', 'auditId'], departments: ['trays', 'departmentId'], trays: ['items', 'trayId'], items: ['damages', 'itemId'] };
    if (kids[store]) {
      const [cs, key] = kids[store];
      for (const c of await by(cs, key, id)) out.push(...await collect(cs, c.id));
    }
    for (const p of await by('photos', 'ownerId', id)) out.push({ store: 'photos', row: p });
    return out;
  }

  async function trashBatches() {
    const t = await all('trash');
    const m = new Map();
    for (const r of t) {
      if (!m.has(r.batch)) m.set(r.batch, { batch: r.batch, at: r.at, by: r.by, first: r, count: 0 });
      m.get(r.batch).count++;
    }
    return [...m.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  async function restore(batch, who) {
    const rows = (await all('trash')).filter(r => r.batch === batch);
    const names = [...new Set(rows.map(r => r.store))];
    const t = tx(names.concat(['trash', 'editlog']), 'readwrite');
    const now = new Date().toISOString();
    for (const r of rows) {
      t.objectStore(r.store).put(r.row);
      t.objectStore('trash').delete(r.trashId);
      t.objectStore('editlog').add({ at: now, by: who, store: r.store, id: r.row.id, field: '(กู้คืน)', from: batch, to: null });
    }
    await done(t);
    return rows.length;
  }

  /** แบ็กอัปทั้งหมดเป็น object เดียว (รูปเป็น data URL) */
  async function exportAll() {
    const out = { app: 'KOSIN Tray Audit', format: 1, exportedAt: new Date().toISOString(), deviceId: await deviceId(), stores: {} };
    for (const s of Object.keys(STORES).concat(['editlog', 'trash'])) {
      const rows = await all(s);
      if (s === 'photos') for (const p of rows) if (p.blob) { p.dataUrl = await blobToDataUrl(p.blob); delete p.blob; }
      out.stores[s] = rows;
    }
    return out;
  }

  /** นำเข้าแบ็กอัป: เขียนทับแถวรหัสเดียวกัน (ไม่ลบของที่มีอยู่แต่ไม่อยู่ในไฟล์) — คืนจำนวนแถวต่อตาราง */
  async function importAll(data) {
    if (!data || data.app !== 'KOSIN Tray Audit' || !data.stores) throw new Error('ไม่ใช่ไฟล์แบ็กอัปของ KOSIN Tray Audit');
    const stat = {};
    for (const [s, rows] of Object.entries(data.stores)) {
      if (!(s in STORES)) continue;
      // แปลงรูปให้เสร็จ "ก่อน" เปิด transaction — IndexedDB ปิด transaction เองเมื่อมี await คั่น (เจอจริงตอนทดสอบ)
      if (s === 'photos') for (const r of rows) if (r.dataUrl) { r.blob = await (await fetch(r.dataUrl)).blob(); delete r.dataUrl; }
      const t = tx([s], 'readwrite');
      for (const r of rows) t.objectStore(s).put(r);
      await done(t);
      stat[s] = rows.length;
    }
    return stat;
  }

  function blobToDataUrl(b) {
    return new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
  }

  return { open, get, all, by, put, del, collect, trashBatches, restore, exportAll, importAll, getMeta, setMeta, deviceId };
})();
