/* KOSIN Tray Audit — หน้าจอ (กฎธุรกิจทั้งหมดอยู่ใน logic.js ที่นี่เรียกใช้อย่างเดียว) */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const V = $('#view');
  let M = null;          // master.json
  let P = null;          // products: { rows, byCode }
  let WHO = '';          // ชื่อผู้ตรวจ (ตั้งค่า)
  let NEWVER = '';       // เวอร์ชันใหม่ที่โหลดเข้าเครื่องแล้ว แต่หน้านี้ยังเป็นตัวเก่า ('' = ไม่มี)

  // ---------------------------------------------------------------- utils
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baht = n => (n === null || n === undefined || n === '') ? '—' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' บาท';
  // วันที่ตามเวลาเครื่อง (ไม่ใช้ toISOString ซึ่งเป็น UTC — ก่อน 07:00 เวลาไทยจะได้วันก่อนหน้า แบบเดียวกับบั๊กของ StayReady)
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const level = code => M.levels.find(l => l.code === code);
  const badge = code => {
    if (code === null) return '<span class="badge pend">ยังไม่ตรวจ</span>';
    const l = level(code);
    return l ? `<span class="badge" style="background:${l.color}">${esc(l.name)}</span>` : '';
  };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
  function go(h) { location.hash = h; }
  const product = code => P.byCode.get(Logic.normCode(code));
  // ราคาอยู่ในเครื่องเท่านั้น (นำเข้าที่หน้าตั้งค่า) — ไม่มีในไฟล์บนเว็บ
  const priceOf = code => P.price.get(Logic.normCode(code)) || null;
  /** บอกช่างตั้งแต่ตอนกรอกว่ารายงานจะคิดราคาชิ้นนี้อย่างไร (กันไปเจอตอนออกรายงาน) */
  const costHint = (item, e) => {
    const c = Logic.costLine(item, e, M.levels, priceOf(item.productCode));
    const what = { none: 'ไม่มีค่าใช้จ่าย', optional: 'ค่าซ่อมทางเลือก (ใส่ราคาซ่อมเอง)', repair: 'ค่าซ่อม (ใส่ราคาซ่อมเอง)', replace: 'ราคาเปลี่ยนจาก pricelist', unknown: 'คำแนะนำไม่รู้จัก', pending: '' }[c.action];
    if (c.hidden) return `ในรายงาน: ${what} — <b>ไม่แสดงราคา</b>`;
    if (c.missing) return `ในรายงาน: ${what} — <span class="badge pend">ยังไม่มีราคา</span> ออกรายงานไม่ได้จนกว่าจะใส่ / นำเข้าราคา / ติ๊กไม่แสดงราคา`;
    return `ในรายงาน: ${what}${c.amount ? ' — ' + baht(c.amount) : ''}${c.stale ? ' <span class="badge gray">ราคาเก่า</span>' : ''}`;
  };
  const priceText = code => {
    if (!P.price.size) return '<span class="muted">ยังไม่ได้นำเข้าราคา</span>';
    const x = priceOf(code); if (!x) return 'ไม่มีราคา';
    return baht(x[1]) + (x[3] ? ` <span class="badge gray">ราคาเก่า ${esc(x[2])}</span>` : '');
  };
  const productGroup = code => { const p = product(code); return p ? p[2] : M.otherGroup; };

  // ---------------------------------------------------------------- data helpers
  async function auditTree(auditId) {
    const depts = await DB.by('departments', 'auditId', auditId);
    const trays = [], items = [], dmg = {};
    for (const d of depts) for (const t of await DB.by('trays', 'departmentId', d.id)) {
      trays.push(t);
      for (const i of await DB.by('items', 'trayId', t.id)) { items.push(i); dmg[i.id] = await DB.by('damages', 'itemId', i.id); }
    }
    return { depts, trays, items, dmg };
  }
  function lockedNote(a) { return Logic.isLocked(a) ? '<p class="banner">🔒 audit นี้ปิดงานแล้ว — ดูได้อย่างเดียว ต้อง "เปิดงานอีกครั้ง" (ใส่เหตุผล) ก่อนแก้</p>' : ''; }
  async function confirmDelete(store, id, label) {
    const rows = await DB.collect(store, id);
    const n = s => rows.filter(r => r.store === s).length;
    const parts = [['แผนก', 'departments'], ['ถาด', 'trays'], ['ชิ้น', 'items'], ['ตำหนิ', 'damages'], ['รูป', 'photos']]
      .map(([t, s]) => n(s) ? `${t} ${n(s)}` : '').filter(Boolean).join(' · ');
    if (!confirm(`ลบ "${label}"?\nจะย้ายไปถังขยะพร้อมของข้างใน: ${parts || 'ไม่มี'}\nกู้คืนได้ที่ ตั้งค่า → ถังขยะ`)) return false;
    await DB.del(store, id, WHO);
    toast('ย้ายไปถังขยะแล้ว');
    return true;
  }

  // ---------------------------------------------------------------- photos
  async function resize(file) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  }
  async function addPhotos(ownerType, ownerId, files) {
    for (const f of files) await DB.put('photos', { ownerType, ownerId, blob: await resize(f), inReport: true }, WHO);
  }
  function photoInputs(key) {
    return `<div class="row">
      <label class="btn sm" style="margin:0">📷 ถ่ายรูป<input type="file" accept="image/*" capture="environment" data-photo="${key}" hidden></label>
      <label class="btn sm" style="margin:0">🖼 เลือกรูป<input type="file" accept="image/*" multiple data-photo="${key}" hidden></label>
    </div>`;
  }
  async function thumbs(ownerId, editable) {
    const ps = await DB.by('photos', 'ownerId', ownerId);
    if (!ps.length) return '';
    return '<div class="thumbs">' + ps.map(p => `<div class="thumb ${p.inReport ? '' : 'out'}">
      <img src="${URL.createObjectURL(p.blob)}" alt="">
      ${editable ? `<button class="t-del" data-pdel="${p.id}" title="ลบรูป">✕</button>
      <button class="t-inc" data-pinc="${p.id}">${p.inReport ? 'ในรายงาน' : 'ไม่ใส่'}</button>` : ''}
    </div>`).join('') + '</div>';
  }
  function bindPhotoButtons(after) {
    V.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
      if (!confirm('ลบรูปนี้? (ไปถังขยะ)')) return;
      await DB.del('photos', b.dataset.pdel, WHO); after();
    });
    V.querySelectorAll('[data-pinc]').forEach(b => b.onclick = async () => {
      const p = await DB.get('photos', b.dataset.pinc); p.inReport = !p.inReport; await DB.put('photos', p, WHO); after();
    });
  }

  // ---------------------------------------------------------------- screens
  async function home() {
    const audits = (await DB.all('audits')).sort((a, b) => (b.plannedDate || '').localeCompare(a.plannedDate || ''));
    const custs = new Map((await DB.all('customers')).map(c => [c.id, c]));
    let html = `<div class="row"><h1 class="grow">รายการ audit</h1><a class="btn pri" href="#/new-audit">＋ audit ใหม่</a></div>`;
    if (!audits.length) html += `<div class="card muted">ยังไม่มี audit — กด "＋ audit ใหม่" เพื่อเริ่ม</div>`;
    html += '<ul class="list">';
    for (const a of audits) {
      const c = custs.get(a.customerId) || {};
      const tr = await auditTree(a.id);
      const k = Logic.counts(tr.items, tr.dmg, M.levels);
      html += `<li><a class="main" href="#/audit/${a.id}">
        <div class="row"><span class="title grow">${esc(c.name)}</span>
          ${Logic.isTestCustomer(c.name) ? '<span class="badge gray">ทดสอบ</span>' : ''}
          <span class="badge ${Logic.isLocked(a) ? 'lock' : 'ok'}">${esc(a.status)}</span></div>
        <div class="small muted">นัดตรวจ ${esc(a.plannedDate || '-')} · ถาด ${tr.trays.length} · ชิ้น ${k.total}
          (ชำรุด ${k.damaged} · หาย ${k.missing} · ยังไม่ตรวจ ${k.pending}) · ผู้ตรวจ ${esc(a.inspector)}</div></a></li>`;
    }
    V.innerHTML = html + '</ul>';
  }

  async function newAudit() {
    if (!WHO) { toast('ตั้งชื่อผู้ตรวจก่อน'); return go('#/settings'); }
    const custs = (await DB.all('customers')).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    V.innerHTML = `<h1>audit ใหม่</h1><div class="card">
      <label>ลูกค้า (โรงพยาบาล)</label>
      <select id="cust"><option value="">— ลูกค้าใหม่ —</option>${custs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div id="newc"><label>ชื่อโรงพยาบาล * <span class="small">(ข้อมูลทดสอบให้ขึ้นต้น SIM-)</span></label><input id="cname">
        <label>ชื่อภาษาอังกฤษ <span class="small">(ใช้ในรายงานภาษาอังกฤษ — เว้นได้)</span></label><input id="cnameen" placeholder="e.g. Siriraj Hospital" lang="en">
        <div class="row"><div class="grow"><label>รหัสสถานพยาบาล</label><input id="ccode"></div><div class="grow"><label>จังหวัด</label><input id="cprov"></div></div></div>
      <div class="row"><div class="grow"><label>วันที่นัดตรวจ</label><input id="pd" type="date" value="${today()}"></div>
        <div class="grow"><label>ประมาณจำนวนถาด</label><input id="et" type="number" min="0" inputmode="numeric"></div>
        <div class="grow"><label>ประมาณจำนวนชิ้น</label><input id="ei" type="number" min="0" inputmode="numeric"></div></div>
      <div id="e"></div>
      <div class="row" style="margin-top:12px"><button class="pri" id="save">บันทึก + เพิ่มแผนก</button><a class="btn" href="#/">ยกเลิก</a></div></div>`;
    $('#cust').onchange = () => $('#newc').classList.toggle('hidden', !!$('#cust').value);
    $('#save').onclick = async () => {
      let cid = $('#cust').value;
      if (!cid) {
        const name = $('#cname').value.trim();
        if (!name) return $('#e').innerHTML = '<div class="err">ต้องใส่ชื่อโรงพยาบาล</div>';
        cid = (await DB.put('customers', { name, nameEn: $('#cnameen').value.trim(), hcode: $('#ccode').value.trim(), province: $('#cprov').value.trim() }, WHO)).id;
      }
      const a = await DB.put('audits', { customerId: cid, plannedDate: $('#pd').value, estTrays: Number($('#et').value) || 0,
        estItems: Number($('#ei').value) || 0, status: 'กำลังตรวจ', inspector: WHO }, WHO);
      go(`#/audit/${a.id}?add=1`);
    };
  }

  async function auditView(id, q) {
    const a = await DB.get('audits', id); if (!a) return go('#/');
    const c = await DB.get('customers', a.customerId) || {};
    const tr = await auditTree(id);
    const k = Logic.counts(tr.items, tr.dmg, M.levels);
    const locked = Logic.isLocked(a);
    const warn = Logic.estimateWarnings(a, tr.trays.length, tr.items.length);
    const times = tr.items.flatMap(i => [i.createdAt, i.updatedAt]).filter(Boolean).sort();
    const mins = times.length ? Math.round((new Date(times.at(-1)) - new Date(times[0])) / 60000) : 0;
    let html = `<div class="crumb"><a href="#/">รายการ audit</a></div>
      <div class="row"><h1 class="grow">${esc(c.name)}</h1>${Logic.isTestCustomer(c.name) ? '<span class="badge gray">ทดสอบ</span>' : ''}<span class="badge ${locked ? 'lock' : 'ok'}">${esc(a.status)}</span>${locked ? '' : '<button class="sm" id="edc">✎ แก้ไขข้อมูล รพ.</button>'}</div>
      ${c.nameEn ? `<div class="small muted">EN: ${esc(c.nameEn)}</div>` : ''}${lockedNote(a)}
      ${locked ? '' : `<div class="card" id="eccard" hidden><b>แก้ไขข้อมูลโรงพยาบาล</b> <span class="small muted">(ใช้ร่วมกับ audit อื่นของ รพ. นี้)</span>
        <label>ชื่อโรงพยาบาล * <span class="small">(ข้อมูลทดสอบให้ขึ้นต้น SIM-)</span></label><input id="ec-n" value="${esc(c.name || '')}">
        <label>ชื่อภาษาอังกฤษ <span class="small">(ใช้ในรายงานภาษาอังกฤษ — เว้นได้)</span></label><input id="ec-ne" value="${esc(c.nameEn || '')}" placeholder="e.g. Siriraj Hospital" lang="en">
        <div class="row"><div class="grow"><label>รหัสสถานพยาบาล</label><input id="ec-h" value="${esc(c.hcode || '')}"></div><div class="grow"><label>จังหวัด</label><input id="ec-p" value="${esc(c.province || '')}"></div></div>
        <div id="ec-e"></div>
        <div class="row" style="margin-top:10px"><button class="pri" id="ec-s">บันทึก</button><button id="ec-x">ยกเลิก</button></div></div>`}
      <div class="small muted">นัดตรวจ ${esc(a.plannedDate)} · ผู้ตรวจ ${esc(a.inspector)} · ช่วงเวลาบันทึกชิ้นงาน ~${mins} นาที</div>
      <div class="stats" style="margin-top:10px">
        <div><b>${k.total}</b>ชิ้นทั้งหมด</div><div><b>${k.ok}</b>ใช้ได้ดี</div><div><b>${k.damaged}</b>ชำรุด</div>
        <div><b>${k.missing}</b>หาย</div><div><b>${k.condPass}</b>ผ่านมีเงื่อนไข</div><div><b>${k.pending}</b>ยังไม่ตรวจ</div></div>
      ${warn.map(w => `<p class="banner">⚠ ${esc(w)}</p>`).join('')}
      <h2>แผนก</h2><ul class="list">`;
    for (const d of tr.depts) {
      const ts = tr.trays.filter(t => t.departmentId === d.id);
      html += `<li><a class="main" href="#/dept/${d.id}"><div class="title">${esc(d.name)}</div>
        <div class="small muted">ถาด ${ts.length} · ${esc([d.contact, d.phone, d.location].filter(Boolean).join(' · '))}</div></a>
        ${locked ? '' : `<div class="acts"><button class="sm danger" data-deld="${d.id}">ลบ</button></div>`}</li>`;
    }
    html += `</ul>${locked ? '' : `<div class="card" id="addd" ${q.add ? '' : 'hidden'}><b>เพิ่มแผนก</b>
        <label>ชื่อแผนก *</label><input id="dn" placeholder="เช่น ห้องผ่าตัด (OR)">
        <label>ชื่อภาษาอังกฤษ <span class="small">(ใช้ในรายงานภาษาอังกฤษ — เว้นได้)</span></label><input id="dne" placeholder="e.g. Operating Room (OR)" lang="en">
        <div class="row"><div class="grow"><label>ผู้ติดต่อ</label><input id="dc"></div><div class="grow"><label>เบอร์โทร</label><input id="dp" inputmode="tel"></div></div>
        <label>ตึก / ชั้น</label><input id="dl"><div id="de"></div>
        <div class="row" style="margin-top:10px"><button class="pri" id="dsave">บันทึก + เพิ่มถาด</button></div></div>
        <button id="showd" ${q.add ? 'hidden' : ''}>＋ เพิ่มแผนก</button>`}
      <h2>จัดการ audit</h2><div class="row">
        ${locked ? `<button id="reopen">🔓 เปิดงานอีกครั้ง</button>` : `<button class="pri" id="close">✔ ปิดงาน</button>`}
        <button id="reaudit">⧉ ตรวจรอบใหม่ (คัดลอก audit)</button>
        <a class="btn" href="#/report/${id}">📄 รายงาน</a>
        ${locked ? '' : '<button class="danger" id="dela">ลบ audit</button>'}</div><div id="ae"></div>`;
    V.innerHTML = html;
    if (!locked) {
      $('#edc').onclick = () => { $('#eccard').hidden = false; $('#edc').hidden = true; $('#ec-ne').focus(); };
      $('#ec-x').onclick = () => route();
      $('#ec-s').onclick = async () => {
        const name = $('#ec-n').value.trim(); if (!name) return $('#ec-e').innerHTML = '<div class="err">ต้องใส่ชื่อโรงพยาบาล</div>';
        // เปลี่ยนชื่อแล้วสถานะ "ข้อมูลทดสอบ" เปลี่ยนตาม (กฎ SIM-) → บอกก่อนบันทึก
        if (Logic.isTestCustomer(name) !== Logic.isTestCustomer(c.name) &&
          !confirm(Logic.isTestCustomer(name) ? 'ชื่อใหม่ขึ้นต้น SIM- → audit ของ รพ. นี้จะกลายเป็น "ข้อมูลทดสอบ" (รายงานมีลายน้ำ) ยืนยัน?'
            : 'ชื่อใหม่ไม่ขึ้นต้น SIM- → audit ของ รพ. นี้จะกลายเป็น "ข้อมูลจริง" ยืนยัน?')) return;
        Object.assign(c, { name, nameEn: $('#ec-ne').value.trim(), hcode: $('#ec-h').value.trim(), province: $('#ec-p').value.trim() });
        await DB.put('customers', c, WHO); toast('บันทึกแล้ว'); route();
      };
      $('#showd').onclick = () => { $('#addd').hidden = false; $('#showd').hidden = true; $('#dn').focus(); };
      $('#dsave').onclick = async () => {
        const name = $('#dn').value.trim(); if (!name) return $('#de').innerHTML = '<div class="err">ต้องใส่ชื่อแผนก</div>';
        const d = await DB.put('departments', { auditId: id, name, nameEn: $('#dne').value.trim(), contact: $('#dc').value.trim(), phone: $('#dp').value.trim(), location: $('#dl').value.trim() }, WHO);
        go(`#/dept/${d.id}?add=1`);
      };
      V.querySelectorAll('[data-deld]').forEach(b => b.onclick = async () => { const d = await DB.get('departments', b.dataset.deld); if (await confirmDelete('departments', d.id, d.name)) route(); });
      $('#close').onclick = async () => {
        const g = Logic.canCloseAudit(tr.items);
        if (!g.ok) return $('#ae').innerHTML = `<div class="err">ปิดงานไม่ได้<ul>${g.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`;
        if (!confirm('ปิดงาน audit นี้? หลังปิดจะล็อกห้ามแก้ (เปิดใหม่ได้โดยใส่เหตุผล)')) return;
        a.status = 'ปิดงานแล้ว'; a.closedAt = new Date().toISOString(); a.closedBy = WHO;
        await DB.put('audits', a, WHO); toast('ปิดงานแล้ว — อย่าลืมแบ็กอัป'); route();
      };
      $('#dela').onclick = async () => { if (await confirmDelete('audits', id, c.name)) go('#/'); };
    } else {
      $('#reopen').onclick = async () => {
        const r = prompt('เหตุผลที่เปิดงานอีกครั้ง (บังคับ)');
        if (r === null) return;
        try { await DB.put('audits', Logic.reopenAudit(a, r, WHO, new Date().toISOString()), WHO); route(); }
        catch (e) { $('#ae').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    }
    $('#reaudit').onclick = async () => {
      if (!confirm('สร้าง audit รอบใหม่ของลูกค้านี้? (คัดลอกแผนก/ถาด/ชิ้นเป็นแม่แบบ ต้องตรวจทุกชิ้นใหม่)')) return;
      const na = await DB.put('audits', { customerId: a.customerId, plannedDate: today(), estTrays: tr.trays.length, estItems: tr.items.length,
        status: 'กำลังตรวจ', inspector: WHO, previousAuditId: id }, WHO);
      for (const d of tr.depts) {
        const nd = await DB.put('departments', { auditId: na.id, name: d.name, nameEn: d.nameEn || '', contact: d.contact, phone: d.phone, location: d.location }, WHO);
        for (const t of tr.trays.filter(t => t.departmentId === d.id)) await copyTray(t, nd.id, t.name, t.setId, t.nameEn || '');
      }
      toast('สร้างรอบใหม่แล้ว'); go(`#/audit/${na.id}`);
    };
  }

  async function copyTray(t, deptId, name, setId, nameEn) {
    const nt = await DB.put('trays', { departmentId: deptId, name, nameEn: nameEn || '', setId, copiedFrom: t.id }, WHO);
    for (const i of await DB.by('items', 'trayId', t.id)) await DB.put('items', Object.assign(Logic.templateFrom(i), { trayId: nt.id }), WHO);
    return nt;
  }

  async function deptView(id, q) {
    const d = await DB.get('departments', id); if (!d) return go('#/');
    const a = await DB.get('audits', d.auditId); const c = await DB.get('customers', a.customerId) || {};
    const locked = Logic.isLocked(a);
    const trays = await DB.by('trays', 'departmentId', id);
    let html = `<div class="crumb"><a href="#/">รายการ audit</a> › <a href="#/audit/${a.id}">${esc(c.name)}</a></div>
      <div class="row"><h1 class="grow">${esc(d.name)}</h1>${locked ? '' : '<button class="sm" id="edd">✎ แก้ไขแผนก</button>'}</div>
      ${d.nameEn ? `<div class="small muted">EN: ${esc(d.nameEn)}</div>` : ''}${lockedNote(a)}
      ${locked ? '' : `<div class="card" id="edcard" hidden><b>แก้ไขแผนก</b>
        <label>ชื่อแผนก *</label><input id="ed-n" value="${esc(d.name)}">
        <label>ชื่อภาษาอังกฤษ <span class="small">(ใช้ในรายงานภาษาอังกฤษ — เว้นได้)</span></label><input id="ed-ne" value="${esc(d.nameEn || '')}" placeholder="e.g. Operating Room (OR)" lang="en">
        <div class="row"><div class="grow"><label>ผู้ติดต่อ</label><input id="ed-c" value="${esc(d.contact || '')}"></div><div class="grow"><label>เบอร์โทร</label><input id="ed-p" inputmode="tel" value="${esc(d.phone || '')}"></div></div>
        <label>ตึก / ชั้น</label><input id="ed-l" value="${esc(d.location || '')}"><div id="ed-e"></div>
        <div class="row" style="margin-top:10px"><button class="pri" id="ed-s">บันทึก</button><button id="ed-x">ยกเลิก</button></div></div>`}
      <h2>ถาด</h2><ul class="list">`;
    for (const t of trays) {
      const items = await DB.by('items', 'trayId', t.id);
      const st = Logic.trayStatus(items);
      html += `<li><a class="main" href="#/tray/${t.id}"><div class="row"><span class="title grow">${esc(t.name)}</span>
        <span class="badge ${st === 'มีชิ้นยังไม่ตรวจ' ? 'pend' : st === 'ว่าง' ? 'gray' : 'ok'}">${st}</span></div>
        <div class="small muted">Set ID ${esc(t.setId || '-')} · ชิ้น ${items.length}</div></a>
        ${locked ? '' : `<div class="acts"><button class="sm" data-copyt="${t.id}">⧉ คัดลอกถาด</button><button class="sm danger" data-delt="${t.id}">ลบ</button></div>`}</li>`;
    }
    html += `</ul>${locked ? '' : `<div class="card" id="addt" ${q.add ? '' : 'hidden'}><b>เพิ่มถาด</b>
      <label>ชื่อถาด *</label><input id="tn" placeholder="เช่น ชุดส่องกล้องช่องท้อง">
      <label>ชื่อภาษาอังกฤษ <span class="small">(ใช้ในรายงานภาษาอังกฤษ — เว้นได้)</span></label><input id="tne" placeholder="e.g. Laparoscopy set" lang="en">
      <label>Set ID (เลขชุด/เลขถาดของ รพ.)</label><input id="ts"><div id="te"></div>
      <div class="row" style="margin-top:10px"><button class="pri" id="tsave">บันทึก + เพิ่มชิ้น</button></div></div>
      <button id="showt" ${q.add ? 'hidden' : ''}>＋ เพิ่มถาด</button>`}`;
    V.innerHTML = html;
    if (locked) return;
    $('#edd').onclick = () => { $('#edcard').hidden = false; $('#edd').hidden = true; $('#ed-ne').focus(); };
    $('#ed-x').onclick = () => route();
    $('#ed-s').onclick = async () => {
      const name = $('#ed-n').value.trim(); if (!name) return $('#ed-e').innerHTML = '<div class="err">ต้องใส่ชื่อแผนก</div>';
      Object.assign(d, { name, nameEn: $('#ed-ne').value.trim(), contact: $('#ed-c').value.trim(), phone: $('#ed-p').value.trim(), location: $('#ed-l').value.trim() });
      await DB.put('departments', d, WHO); toast('บันทึกแล้ว'); route();
    };
    $('#showt').onclick = () => { $('#addt').hidden = false; $('#showt').hidden = true; $('#tn').focus(); };
    $('#tsave').onclick = async () => {
      const name = $('#tn').value.trim(); if (!name) return $('#te').innerHTML = '<div class="err">ต้องใส่ชื่อถาด</div>';
      const t = await DB.put('trays', { departmentId: id, name, nameEn: $('#tne').value.trim(), setId: $('#ts').value.trim() }, WHO);
      go(`#/item/new/${t.id}`);
    };
    V.querySelectorAll('[data-copyt]').forEach(b => b.onclick = async () => {
      const t = await DB.get('trays', b.dataset.copyt);
      const dflt = t.name + ' (ชุดที่ 2)';
      const name = prompt('ชื่อถาดใหม่ (ชิ้นทั้งหมดจะเป็นแม่แบบ ต้องตรวจใหม่)', dflt); if (!name) return;
      const setId = prompt('Set ID ของถาดใหม่', '') ?? '';
      // ใช้ชื่อตั้งต้น "(ชุดที่ 2)" → ชื่ออังกฤษตามให้ ; พิมพ์ชื่อใหม่เอง → เว้นชื่ออังกฤษไว้แก้ทีหลัง
      await copyTray(t, id, name.trim(), setId.trim(), name.trim() === dflt && t.nameEn ? t.nameEn + ' (set 2)' : ''); toast('คัดลอกถาดแล้ว'); route();
    });
    V.querySelectorAll('[data-delt]').forEach(b => b.onclick = async () => { const t = await DB.get('trays', b.dataset.delt); if (await confirmDelete('trays', t.id, t.name)) route(); });
  }

  async function trayView(id) {
    const t = await DB.get('trays', id); if (!t) return go('#/');
    const d = await DB.get('departments', t.departmentId); const a = await DB.get('audits', d.auditId); const c = await DB.get('customers', a.customerId) || {};
    const locked = Logic.isLocked(a);
    const items = await DB.by('items', 'trayId', id);
    let html = `<div class="crumb"><a href="#/audit/${a.id}">${esc(c.name)}</a> › <a href="#/dept/${d.id}">${esc(d.name)}</a></div>
      <div class="row"><h1 class="grow">${esc(t.name)}</h1><span class="small muted">Set ID ${esc(t.setId || '-')}</span>${locked ? '' : '<button class="sm" id="edt">✎ แก้ไขถาด</button>'}</div>
      ${t.nameEn ? `<div class="small muted">EN: ${esc(t.nameEn)}</div>` : ''}${lockedNote(a)}
      ${locked ? '' : `<div class="card" id="etcard" hidden><b>แก้ไขถาด</b>
        <label>ชื่อถาด *</label><input id="et-n" value="${esc(t.name)}">
        <label>ชื่อภาษาอังกฤษ <span class="small">(ใช้ในรายงานภาษาอังกฤษ — เว้นได้)</span></label><input id="et-ne" value="${esc(t.nameEn || '')}" placeholder="e.g. Laparoscopy set" lang="en">
        <label>Set ID (เลขชุด/เลขถาดของ รพ.)</label><input id="et-s" value="${esc(t.setId || '')}"><div id="et-e"></div>
        <div class="row" style="margin-top:10px"><button class="pri" id="et-ok">บันทึก</button><button id="et-x">ยกเลิก</button></div></div>`}
      <div class="card"><b>รูปถาด</b>${locked ? '' : photoInputs('tray')}${await thumbs(id, !locked)}</div>
      <div class="row"><h2 class="grow">ชิ้นในถาด (${items.length})</h2>${locked ? '' : `<a class="btn pri" href="#/item/new/${id}">＋ เพิ่มชิ้น</a>`}</div><ul class="list">`;
    for (const i of items) {
      const dm = await DB.by('damages', 'itemId', i.id);
      const e = Logic.itemEvaluation(i, dm, M.levels);
      const p = product(i.productCode);
      html += `<li><a class="main" href="#/item/${i.id}"><div class="row"><span class="title grow">${esc(i.productCode)}</span>${badge(e)}</div>
        <div class="small muted">${esc(p ? (p[1] || '(ไม่มีคำอธิบาย)') : 'ไม่อยู่ในทะเบียนสินค้า')} ·${i.serial ? 'SN ' + esc(i.serial) : i.lot ? 'LOT ' + esc(i.lot) : 'ไม่มี SN/LOT'}
        ${e !== null ? ' · ' + esc(Logic.itemRecommendation(e, i, M.levels)) : ''}</div></a>
        ${locked ? '' : `<div class="acts"><button class="sm" data-copyi="${i.id}">⧉ คัดลอกเป็นแม่แบบ</button><button class="sm" data-movei="${i.id}">⇆ ย้ายถาด</button><button class="sm danger" data-deli="${i.id}">ลบ</button></div>`}</li>`;
    }
    V.innerHTML = html + '</ul>';
    if (locked) return;
    $('#edt').onclick = () => { $('#etcard').hidden = false; $('#edt').hidden = true; $('#et-ne').focus(); };
    $('#et-x').onclick = () => route();
    $('#et-ok').onclick = async () => {
      const name = $('#et-n').value.trim(); if (!name) return $('#et-e').innerHTML = '<div class="err">ต้องใส่ชื่อถาด</div>';
      Object.assign(t, { name, nameEn: $('#et-ne').value.trim(), setId: $('#et-s').value.trim() });
      await DB.put('trays', t, WHO); toast('บันทึกแล้ว'); route();
    };
    V.querySelectorAll('[data-photo]').forEach(inp => inp.onchange = async () => { await addPhotos('tray', id, inp.files); route(); });
    bindPhotoButtons(route);
    V.querySelectorAll('[data-copyi]').forEach(b => b.onclick = async () => {
      const i = await DB.get('items', b.dataset.copyi);
      await DB.put('items', Object.assign(Logic.templateFrom(i), { trayId: id }), WHO); toast('คัดลอกเป็นแม่แบบแล้ว (ต้องตรวจใหม่)'); route();
    });
    V.querySelectorAll('[data-movei]').forEach(b => b.onclick = async () => {
      const tr = await auditTree(a.id);
      const opts = tr.trays.filter(x => x.id !== id);
      if (!opts.length) return toast('ไม่มีถาดอื่นใน audit นี้');
      const names = opts.map((x, n) => `${n + 1}. ${tr.depts.find(dd => dd.id === x.departmentId).name} › ${x.name}`).join('\n');
      const pick = prompt('ย้ายไปถาดไหน (พิมพ์เลข)\n' + names); if (!pick) return;
      const dest = opts[Number(pick) - 1]; if (!dest) return toast('เลขไม่ถูกต้อง');
      const i = await DB.get('items', b.dataset.movei); i.trayId = dest.id; await DB.put('items', i, WHO); toast('ย้ายแล้ว'); route();
    });
    V.querySelectorAll('[data-deli]').forEach(b => b.onclick = async () => { const i = await DB.get('items', b.dataset.deli); if (await confirmDelete('items', i.id, i.productCode)) route(); });
  }

  // ---------------------------------------------------------------- item form (หน้าหลักของช่าง)
  async function itemView(id, trayId) {
    const isNew = id === 'new';
    const item = isNew ? { trayId, productCode: '', serial: '', lot: '', mfgYear: '', comment: '', missing: false, condPass: '', recOverride: '', recOverrideReason: '', repairPrice: '', hidePrice: false }
      : await DB.get('items', id);
    if (!item) return go('#/');
    const t = await DB.get('trays', item.trayId); const d = await DB.get('departments', t.departmentId);
    const a = await DB.get('audits', d.auditId); const c = await DB.get('customers', a.customerId) || {};
    const locked = Logic.isLocked(a);
    const dmg = isNew ? [] : (await DB.by('damages', 'itemId', item.id)).map(x => Object.assign({}, x));
    const removed = [];
    const recs = [...new Set(M.levels.map(l => l.rec))];
    const condOpts = ['ชิ้นเก่า (ยังใช้งานได้)', 'เคยซ่อมนอกศูนย์ (ยังใช้งานได้)', 'ของสำรอง / ไม่ได้ใช้ประจำ'];

    async function render() {
      const p = product(item.productCode);
      const g = productGroup(item.productCode);
      const ch = Logic.damageChoices(M, g);
      const e = Logic.itemEvaluation(Object.assign({}, item, { template: false }), dmg, M.levels);
      const rec = Logic.itemRecommendation(e, item, M.levels);
      const dis = locked ? 'disabled' : '';
      const opt = (i, sel) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(M.damages[i])}</option>`;
      V.innerHTML = `<div class="crumb"><a href="#/audit/${a.id}">${esc(c.name)}</a> › <a href="#/dept/${d.id}">${esc(d.name)}</a> › <a href="#/tray/${t.id}">${esc(t.name)}</a></div>
        <div class="row"><h1 class="grow">${isNew ? 'เพิ่มชิ้น' : 'ชิ้นงาน'}</h1>${item.template ? '<span class="badge pend">แม่แบบ — ต้องตรวจใหม่</span>' : ''}</div>${lockedNote(a)}
        <div class="card"><label>สินค้า * (พิมพ์รหัสหรือชื่อ)</label>
          <input id="q" value="${esc(item.productCode)}" autocomplete="off" ${dis} placeholder="เช่น 26003BA หรือ telescope 30">
          <div class="small" id="pinfo">${p ? `${esc(p[1] || '(ไม่มีคำอธิบาย)')} · กลุ่ม: ${esc(M.groups[p[2]])} · ราคา ${priceText(item.productCode)}`
            : item.productCode ? '<span class="badge gray">ไม่อยู่ในทะเบียนสินค้า</span> จะบันทึกเป็นสินค้านอกทะเบียน (กลุ่มอื่นๆ)' : ''}</div>
          <div class="results hidden" id="res"></div>
          <div class="row"><div class="grow"><label>Serial</label><input id="sn" value="${esc(item.serial)}" ${item.lot || item.missing ? 'disabled' : dis}></div>
            <div class="grow"><label>LOT</label><input id="lot" value="${esc(item.lot)}" ${item.serial || item.missing ? 'disabled' : dis}></div>
            <div class="grow"><label>ปีผลิต (ค.ศ. ถ้าทราบ)</label><input id="yr" type="number" inputmode="numeric" value="${esc(item.mfgYear)}" ${dis}></div></div>
          <label class="check"><input type="checkbox" id="miss" ${item.missing ? 'checked' : ''} ${dis}> ของหาย (ไม่มีในถาด)</label>
          <label>ผ่านแบบมีเงื่อนไข</label><select id="cp" ${item.missing || dmg.length ? 'disabled' : dis}><option value="">— ไม่ใช่ —</option>
            ${condOpts.map(o => `<option ${item.condPass === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          <label>หมายเหตุ</label><textarea id="cm" ${dis}>${esc(item.comment)}</textarea>
          <b>รูปชิ้นงาน</b>${locked || isNew ? (isNew ? '<div class="small muted">บันทึกชิ้นก่อนจึงแนบรูปได้</div>' : '') : photoInputs('item')}${isNew ? '' : await thumbs(item.id, !locked)}</div>
        <div class="card"><div class="row"><b class="grow">ตำหนิ (${dmg.length})</b>
          <button id="addd" ${item.missing || item.condPass ? 'disabled' : dis}>＋ เพิ่มตำหนิ</button></div>
          ${(await Promise.all(dmg.map(async (x, n) => `<div class="dmg"><div class="row">
            <div><label>ชนิดตำหนิ</label><select data-dt="${n}" ${dis}><option value="">— เลือก —</option>
              <optgroup label="ที่พบบ่อยในกลุ่มนี้">${ch.inGroup.map(i => opt(i, x.damageIdx)).join('')}</optgroup>
              <optgroup label="อื่น ๆ">${ch.rest.map(i => opt(i, x.damageIdx)).join('')}</optgroup></select></div>
            <div><label>ระดับ</label><select data-dl="${n}" ${dis}><option value="">— เลือก —</option>
              ${M.levels.filter(l => !['OK', 'CP', 'MS'].includes(l.code) || l.code === 'OK').map(l => `<option value="${l.code}" ${x.level === l.code ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div></div>
            <label>หมายเหตุตำหนิ</label><input data-dc="${n}" value="${esc(x.comment)}" ${dis}>
            ${x.id && !locked ? photoInputs('dmg:' + x.id) : (!x.id ? '<div class="small muted">บันทึกก่อนจึงแนบรูปตำหนิได้</div>' : '')}
            ${x.id ? await thumbs(x.id, !locked) : ''}
            ${locked ? '' : `<button class="sm danger" data-dr="${n}" style="margin-top:8px">ลบตำหนินี้</button>`}</div>`))).join('')}
        </div>
        <div class="card"><div class="rec">คำแนะนำ: ${badge(e)} <b>${esc(rec)}</b></div>
          <label>เปลี่ยนคำแนะนำ (ถ้าไม่เห็นด้วยกับระบบ)</label><select id="ro" ${dis}><option value="">— ใช้ตามระบบ —</option>${recs.map(r => `<option ${item.recOverride === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
          <div id="rowr" class="${item.recOverride ? '' : 'hidden'}"><label>เหตุผลที่เปลี่ยน *</label><input id="rr" value="${esc(item.recOverrideReason)}" ${dis}></div>
          <label>ราคาซ่อม (บาท ไม่รวม VAT — ช่างใส่เอง ถ้าแนะนำซ่อม)</label><input id="rp" type="number" min="0" inputmode="decimal" value="${esc(item.repairPrice)}" ${dis}>
          <label class="check"><input type="checkbox" id="hp" ${item.hidePrice ? 'checked' : ''} ${dis}> ไม่แสดงราคาชิ้นนี้ในรายงาน</label>
          <div class="small" id="cost">${costHint(item, e)}</div></div>
        <div id="ie"></div>
        ${locked ? '' : `<div class="stick"><button class="pri" data-save="next">บันทึก + ชิ้นถัดไป</button><button data-save="tray">บันทึก + ถาดถัดไป</button><button data-save="back">บันทึก</button></div>`}`;
      if (!locked) bind(g);
    }

    function pull() {
      item.productCode = $('#q').value.trim(); item.serial = $('#sn').value.trim(); item.lot = $('#lot').value.trim();
      item.mfgYear = $('#yr').value.trim(); item.missing = $('#miss').checked; item.condPass = $('#cp').value;
      item.comment = $('#cm').value; item.recOverride = $('#ro').value; item.recOverrideReason = $('#rr') ? $('#rr').value : '';
      item.repairPrice = $('#rp').value.trim(); item.hidePrice = $('#hp').checked;
      V.querySelectorAll('[data-dt]').forEach(s => dmg[s.dataset.dt].damageIdx = s.value === '' ? null : Number(s.value));
      V.querySelectorAll('[data-dl]').forEach(s => dmg[s.dataset.dl].level = s.value);
      V.querySelectorAll('[data-dc]').forEach(s => dmg[s.dataset.dc].comment = s.value);
    }

    function bind(g) {
      const q = $('#q'), res = $('#res');
      q.oninput = () => {
        const s = q.value.trim(); if (s.length < 2) return res.classList.add('hidden');
        const n = Logic.normCode(s), low = s.toLowerCase(), out = [];
        for (const r of P.rows) {
          if (r[0].startsWith(n) || Logic.normCode(r[0]).startsWith(n) || (r[1] && r[1].toLowerCase().includes(low))) out.push(r);
          if (out.length >= 40) break;
        }
        res.innerHTML = out.map(r => `<button data-pick="${esc(r[0])}"><b>${esc(r[0])}</b> ${esc(r[1] || '(ไม่มีคำอธิบาย)')}<br><span class="small muted">${esc(M.groups[r[2]])} · ${priceText(r[0])}</span></button>`).join('')
          || `<div class="small" style="padding:10px">ไม่พบ — กดบันทึกได้ จะเป็นสินค้านอกทะเบียน</div>`;
        res.classList.remove('hidden');
        res.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { pull(); item.productCode = b.dataset.pick; render(); });
      };
      q.onchange = () => { pull(); render(); };
      ['#sn', '#lot', '#miss', '#cp', '#ro', '#hp', '#rp'].forEach(s => $(s).onchange = () => { pull(); render(); });
      $('#addd').onclick = () => { pull(); dmg.push({ damageIdx: null, level: '', comment: '' }); render(); };
      V.querySelectorAll('[data-dt]').forEach(s => s.onchange = () => {
        pull(); const x = dmg[s.dataset.dt];
        if (x.damageIdx !== null && !x.level) x.level = Logic.defaultLevel(M, g, x.damageIdx) || '';
        render();
      });
      V.querySelectorAll('[data-dl]').forEach(s => s.onchange = () => { pull(); render(); });
      V.querySelectorAll('[data-dr]').forEach(b => b.onclick = () => { pull(); const [x] = dmg.splice(Number(b.dataset.dr), 1); if (x.id) removed.push(x.id); render(); });
      V.querySelectorAll('[data-photo]').forEach(inp => inp.onchange = async () => {
        pull(); const k = inp.dataset.photo;
        if (k === 'item') await addPhotos('item', item.id, inp.files); else await addPhotos('damage', k.slice(4), inp.files);
        render();
      });
      bindPhotoButtons(render);
      V.querySelectorAll('[data-save]').forEach(b => b.onclick = () => save(b.dataset.save));
    }

    async function save(after) {
      pull();
      const errs = Logic.validateItem(item, dmg, M.levels);
      if (errs.length) { $('#ie').innerHTML = `<div class="err">ยังบันทึกไม่ได้<ul>${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`; return $('#ie').scrollIntoView({ behavior: 'smooth' }); }
      item.productCode = Logic.normCode(item.productCode);
      item.template = false;          // ช่างกดบันทึก = ตรวจชิ้นนี้แล้ว
      const saved = await DB.put('items', item, WHO);
      for (const rid of removed) await DB.del('damages', rid, WHO);
      for (const x of dmg) { x.itemId = saved.id; await DB.put('damages', x, WHO); }
      toast('บันทึกแล้ว');
      if (after === 'next') go(`#/item/new/${t.id}?r=${Date.now()}`);
      else if (after === 'tray') go(`#/dept/${d.id}?add=1`);
      else go(`#/tray/${t.id}`);
    }
    await render();
  }

  // ---------------------------------------------------------------- รายงาน (ขั้น D)
  /** รวบรวมทุกอย่างที่รายงานต้องใช้ ครั้งเดียว — ทั้ง PDF และ Excel ใช้ชุดเดียวกัน (ตัวเลขสองไฟล์จะไม่ขัดกัน) */
  async function reportData(id) {
    const a = await DB.get('audits', id);
    const c = await DB.get('customers', a.customerId) || {};
    const tr = await auditTree(id);
    const rows = [];
    for (const d of tr.depts) for (const t of tr.trays.filter(t => t.departmentId === d.id)) {
      let n = 0;
      for (const i of tr.items.filter(i => i.trayId === t.id)) {
        const dm = tr.dmg[i.id] || [];
        const e = Logic.itemEvaluation(i, dm, M.levels);
        const p = product(i.productCode);
        rows.push({ d, t, i, dm, e, no: ++n, p, rec: e === null ? '' : Logic.itemRecommendation(e, i, M.levels),
          sysRec: e === null ? '' : Logic.itemRecommendation(e, {}, M.levels),
          line: Logic.costLine(i, e, M.levels, priceOf(i.productCode)) });
      }
    }
    const k = Logic.counts(tr.items, tr.dmg, M.levels);
    return { a, c, tr, rows, k, tot: Logic.totals(rows.map(r => r.line)), mfgKnown: rows.filter(r => r.i.mfgYear || r.i.lot).length };
  }
  // ---- ข้อความรายงาน 2 ภาษา (ข้อมูลหลักมีคำแปลใน master.json: nameEn / recEn / groupsEn / damagesEn)
  const TXT = {
    th: {
      company: 'KOSIN Medical Supply Co., Ltd.', title: 'รายงานผลการตรวจถาดเครื่องมือผ่าตัด', ref: 'เลขอ้างอิง', printed: 'วันที่ออกรายงาน',
      draft: 'ฉบับร่าง — audit ยังไม่ปิดงาน', test: 'ข้อมูลทดสอบ', dept: 'แผนก', date: 'วันที่ตรวจ', inspector: 'ผู้ตรวจ', hcode: 'รหัสสถานพยาบาล',
      dear: 'เรียน', intro: (t, n) => `ทีมงาน KOSIN ได้ตรวจสภาพเครื่องมือในถาดจำนวน <b>${t}</b> ถาด รวม <b>${n}</b> ชิ้น ผลสรุปดังนี้`,
      s1: '1. สรุปผล', mfg: (k, n) => `ทราบปีผลิต ${k} จาก ${n} ชิ้น`, net: 'ค่าใช้จ่ายที่แนะนำให้ดำเนินการ (ก่อน VAT)', vat: r => `ภาษีมูลค่าเพิ่ม ${r}%`,
      gross: 'รวมทั้งสิ้น', opt: 'ค่าซ่อมทางเลือก (ระดับ I) — ไม่รวมในยอดข้างบน', hidden: 'ชิ้นที่ไม่แสดงราคา', pcs: 'ชิ้น',
      priceNote: m => `ราคาในตารางรายถาดเป็นราคาก่อน VAT · ราคาตามรายการราคาขาย KOSIN เดือน ${m} · ค่าซ่อมตามที่ช่างประเมิน`,
      s2: '2. รายละเอียดรายถาด', item: 'รหัส / รายการ', result: 'ผลตรวจ', rec: 'คำแนะนำ', price: 'ราคา (ก่อน VAT)', noDesc: '(ไม่มีคำอธิบาย)',
      notReg: 'ไม่อยู่ในทะเบียน', damage: 'ตำหนิ', cond: 'เงื่อนไข', note: 'หมายเหตุ', made: 'ผลิต', pending: 'ยังไม่ตรวจ', stale: 'ราคาเก่า',
      adjusted: (from, why) => `(ช่างปรับจาก "${from}": ${why})`, dmgPic: 'รูปตำหนิ', trayTotal: 'รวมที่แนะนำให้ดำเนินการ (ก่อน VAT)', optShort: 'ทางเลือก',
      s3: '3. ความหมายของผลตรวจ', sign: 'ลงชื่อ', signRole: 'ผู้ตรวจ', freeText: '', print: '🖨 พิมพ์ / บันทึกเป็น PDF', baht: 'บาท'
    },
    en: {
      company: 'KOSIN Medical Supply Co., Ltd.', title: 'Surgical Instrument Tray Inspection Report', ref: 'Reference', printed: 'Report date',
      draft: 'DRAFT — audit not yet closed', test: 'TEST DATA', dept: 'Department', date: 'Inspection date', inspector: 'Inspector', hcode: 'Facility code',
      dear: 'Dear', intro: (t, n) => `The KOSIN team inspected <b>${t}</b> tray(s) containing <b>${n}</b> item(s). Summary of findings:`,
      s1: '1. Summary', mfg: (k, n) => `Manufacturing year known for ${k} of ${n} items`, net: 'Recommended actions (excl. VAT)', vat: r => `VAT ${r}%`,
      gross: 'Total', opt: 'Optional repairs (Level I) — not included above', hidden: 'Items without price shown', pcs: 'item(s)',
      priceNote: m => `Prices in the tray tables exclude VAT · Based on KOSIN price list ${m} · Repair costs as estimated by the technician`,
      s2: '2. Details by tray', item: 'Code / description', result: 'Result', rec: 'Recommendation', price: 'Price (excl. VAT)', noDesc: '(no description)',
      notReg: 'not in product register', damage: 'Findings', cond: 'Condition', note: 'Note', made: 'Mfd.', pending: 'Not inspected', stale: 'old price',
      adjusted: (from, why) => `(adjusted by technician from "${from}": ${why})`, dmgPic: 'Photo', trayTotal: 'Recommended actions (excl. VAT)', optShort: 'optional',
      s3: '3. Result definitions', sign: 'Signature', signRole: 'Inspector', freeText: 'Technician notes are shown as entered.', print: '🖨 Print / Save as PDF', baht: 'THB'
    }
  };
  // ตัวเลือก "ผ่านแบบมีเงื่อนไข" (ค่าคงที่ในหน้ากรอกชิ้น) — แปลตรงนี้ ; ค่าที่ไม่รู้จักแสดงตามที่บันทึก
  const COND_EN = { 'ชิ้นเก่า (ยังใช้งานได้)': 'Old item (still functional)', 'เคยซ่อมนอกศูนย์ (ยังใช้งานได้)': 'Third-party repaired (still functional)', 'ของสำรอง / ไม่ได้ใช้ประจำ': 'Spare / not in regular use' };
  const lvName = (code, lang) => { const l = level(code); return !l ? '' : lang === 'en' ? l.nameEn : l.name; };
  const recIn = (rec, lang) => { if (lang !== 'en') return rec; const l = M.levels.find(x => x.rec === rec); return l ? l.recEn : rec; };
  const dmgName = (i, lang) => (lang === 'en' ? M.damagesEn : M.damages)[i] ?? '?';
  const grpName = (i, lang) => (lang === 'en' ? M.groupsEn : M.groups)[i] ?? '';
  const condIn = (c, lang) => lang === 'en' ? (COND_EN[c] || c) : c;
  const dmgText = (dm, lang) => dm.map(x => `${dmgName(x.damageIdx, lang)} (${lvName(x.level, lang) || '?'})${x.comment ? ' — ' + x.comment : ''}`).join('; ');
  const ACTION = {
    th: { none: 'ไม่มีค่าใช้จ่าย', optional: 'ซ่อม (ทางเลือก)', repair: 'ซ่อม', replace: 'เปลี่ยน / สั่งใหม่', pending: 'ยังไม่ตรวจ', unknown: '?' },
    en: { none: 'No cost', optional: 'Repair (optional)', repair: 'Repair', replace: 'Replace / order', pending: 'Not inspected', unknown: '?' }
  };
  const money = (n, lang) => (n === null || n === undefined || n === '') ? '—'
    : Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'th-TH', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' ' + TXT[lang].baht;

  async function reportView(id) {
    const R = await reportData(id);
    const o = Object.assign({ refNo: R.a.id, contact: '', era: 'BE', lang: 'th', noPrices: !P.price.size, photos: true }, R.a.reportOpts || {});
    const noEn = Logic.missingEnNames([R.c]).map(n => 'โรงพยาบาล ' + n).concat(Logic.missingEnNames(R.tr.depts).map(n => 'แผนก ' + n)).concat(Logic.missingEnNames(R.tr.trays).map(n => 'ถาด ' + n));
    const gate = Logic.reportGate(R.rows.map(r => ({ label: `${r.t.name} › ${r.i.productCode}${r.i.serial ? ' ' + r.i.serial : ''}`, line: r.line })), { noPrices: o.noPrices });
    V.innerHTML = `<div class="crumb noprint"><a href="#/audit/${id}">กลับไป audit</a></div>
      <div class="noprint"><h1>รายงาน — ${esc(R.c.name)}</h1>
      <div class="card"><div class="row"><div class="grow"><label>ภาษาของรายงาน</label><select id="o-lang"><option value="th" ${o.lang === 'th' ? 'selected' : ''}>ไทย</option><option value="en" ${o.lang === 'en' ? 'selected' : ''}>English</option></select></div>
        <div class="grow"><label>รูปแบบปี ${o.lang === 'en' ? '(อังกฤษใช้ ค.ศ. เสมอ)' : ''}</label><select id="o-era" ${o.lang === 'en' ? 'disabled' : ''}><option value="BE" ${o.era === 'BE' ? 'selected' : ''}>พ.ศ.</option><option value="CE" ${o.era === 'CE' ? 'selected' : ''}>ค.ศ.</option></select></div></div>
        <div class="row"><div class="grow"><label>เลขอ้างอิง *</label><input id="o-ref" value="${esc(o.refNo)}"></div>
        <div class="grow"><label>เรียน (ผู้ติดต่อ — เว้นว่างได้ ไม่มีช่องว่างในรายงาน)</label><input id="o-con" value="${esc(o.contact)}"></div></div>
        <label class="check"><input type="checkbox" id="o-np" ${o.noPrices ? 'checked' : ''}> ออกรายงานแบบไม่มีราคา ${P.price.size ? '' : '<span class="small muted">(ยังไม่ได้นำเข้าไฟล์ราคา)</span>'}</label>
        <label class="check"><input type="checkbox" id="o-ph" ${o.photos ? 'checked' : ''}> ใส่รูปในรายงาน</label>
        ${o.lang === 'en' ? '<p class="small muted">หมายเหตุ/เหตุผลที่ช่างพิมพ์เอง จะแสดงตามที่พิมพ์ (ไม่แปล) — รายงานมีบรรทัดแจ้งให้ผู้อ่านทราบ</p>' : ''}
        ${o.lang === 'en' && noEn.length ? `<p class="banner">⚠ ยังไม่มีชื่อภาษาอังกฤษ ${noEn.length} รายการ — รายงานจะใช้ชื่อไทยแทน: ${esc(noEn.join(', '))} (แก้ได้ที่ปุ่ม ✎ แก้ไข ในหน้า audit / แผนก / ถาด)</p>` : ''}
        <div class="row"><button class="pri" id="o-show" ${gate.ok ? '' : 'disabled'}>📄 ดูรายงาน / บันทึก PDF</button>
          <button id="o-xls" ${gate.ok ? '' : 'disabled'}>⬇ ส่งออก Excel</button></div>
        ${gate.errors.length ? `<div class="err">ยังออกรายงานไม่ได้<ul>${gate.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${gate.warnings.map(w => `<p class="banner">⚠ ${esc(w)}</p>`).join('')}</div></div>
      <div id="rep"></div>`;
    const readOpts = async () => {
      Object.assign(o, { refNo: $('#o-ref').value.trim() || R.a.id, contact: $('#o-con').value.trim(), era: $('#o-era').value, lang: $('#o-lang').value,
        noPrices: $('#o-np').checked, photos: $('#o-ph').checked });
      if (JSON.stringify(R.a.reportOpts || {}) !== JSON.stringify(o)) { R.a.reportOpts = Object.assign({}, o); await DB.put('audits', R.a, WHO); }
    };
    ['#o-np', '#o-lang'].forEach(s => $(s).onchange = async () => { await readOpts(); route(); });   // ด่าน/หน้าตัวเลือกเปลี่ยนตามค่านี้
    $('#o-show').onclick = async () => { await readOpts(); $('#rep').innerHTML = await reportHtml(R, o); $('#rep').scrollIntoView(); };
    $('#o-xls').onclick = async () => { await readOpts(); exportExcel(R, o); };
  }

  async function reportHtml(R, o) {
    const L = o.lang === 'en' ? 'en' : 'th', T = TXT[L];
    const date = Logic.fmtDate(R.a.plannedDate, o.era, L), printed = Logic.fmtDate(today(), o.era, L);
    const depts = R.tr.depts.map(d => Logic.nameIn(d, L)).join(', ');
    const test = Logic.isTestCustomer(R.c.name);
    const evalCount = {}; for (const r of R.rows) if (r.e) evalCount[r.e] = (evalCount[r.e] || 0) + 1;
    const pics = async (ownerId) => {
      if (!o.photos) return '';
      const ps = (await DB.by('photos', 'ownerId', ownerId)).filter(p => p.inReport);
      return ps.length ? `<div class="r-pics">${ps.map(p => `<img src="${URL.createObjectURL(p.blob)}" alt="">`).join('')}</div>` : '';
    };
    const cell = l => o.noPrices || l.hidden ? '—' : l.amount === null ? '?' : (l.amount ? money(l.amount, L) : '-') + (l.stale ? `<br><span class="r-stale">${T.stale}</span>` : '');
    let h = `<article class="report" lang="${L}">${test ? `<div class="r-water">${T.test}</div>` : ''}
      <header class="r-head"><div><b>${T.company}</b><br><span class="small">${T.title}</span></div>
        <div class="r-ref">${T.ref} ${esc(o.refNo)}<br>${T.printed} ${esc(printed)}${Logic.isLocked(R.a) ? '' : `<br><b class="r-draft">${T.draft}</b>`}</div></header>
      <h2 class="r-title">${esc(Logic.nameIn(R.c, L))}</h2>
      <table class="r-kv"><tr><th>${T.dept}</th><td>${esc(depts)}</td><th>${T.date}</th><td>${esc(date)}</td></tr>
        <tr><th>${T.inspector}</th><td>${esc(R.a.inspector)}</td><th>${T.hcode}</th><td>${esc(R.c.hcode || '-')}</td></tr></table>
      ${o.contact ? `<p>${T.dear} ${esc(o.contact)}</p>` : ''}
      <p>${T.intro(R.tr.trays.length, R.k.total)}</p>
      <h3>${T.s1}</h3><div class="r-bars">${M.levels.filter(l => evalCount[l.code]).map(l => `<div class="r-bar"><span>${esc(lvName(l.code, L))}</span>
        <i style="width:${Math.round(100 * evalCount[l.code] / Math.max(...Object.values(evalCount)))}%;background:${l.color}"></i><b>${evalCount[l.code]}</b></div>`).join('')}</div>
      <p class="small">${T.mfg(R.mfgKnown, R.k.total)}</p>`;
    if (!o.noPrices) {
      const v = Logic.withVat(R.tot.required), vo = Logic.withVat(R.tot.optional);
      h += `<table class="r-kv"><tr><th>${T.net}</th><td class="num">${money(v.net, L)}</td></tr>
        <tr><th>${T.vat(Math.round(v.rate * 100))}</th><td class="num">${money(v.vat, L)}</td></tr>
        <tr><th>${T.gross}</th><td class="num"><b>${money(v.gross, L)}</b></td></tr>
        <tr><th>${T.opt}</th><td class="num">${money(vo.net, L)} + VAT ${money(vo.vat, L)} = ${money(vo.gross, L)}</td></tr>
        ${R.tot.hiddenCount ? `<tr><th>${T.hidden}</th><td>${R.tot.hiddenCount} ${T.pcs}</td></tr>` : ''}</table>
        <p class="small">${T.priceNote(esc(P.priceMonth || '-'))}</p>`;
    }
    h += `<h3>${T.s2}</h3>`;
    for (const t of R.tr.trays) {
      const rs = R.rows.filter(r => r.t.id === t.id);
      const sub = Logic.totals(rs.map(r => r.line));
      h += `<section class="r-tray"><h4>${esc(rs[0] ? Logic.nameIn(rs[0].d, L) : '')} › ${esc(Logic.nameIn(t, L))} <span class="small">Set ID ${esc(t.setId || '-')}</span></h4>${await pics(t.id)}
        <table class="r-tab"><thead><tr><th>#</th><th>${T.item}</th><th>SN / LOT</th><th>${T.result}</th><th>${T.rec}</th>${o.noPrices ? '' : `<th>${T.price}</th>`}</tr></thead><tbody>`;
      for (const r of rs) {
        const lv = level(r.e);
        h += `<tr><td>${r.no}</td><td><b>${esc(r.i.productCode)}</b><br><span class="small">${esc(r.p ? (r.p[1] || T.noDesc) : T.notReg)}</span>
          ${r.dm.length ? `<br><span class="small">${T.damage}: ${esc(dmgText(r.dm, L))}</span>` : ''}${r.i.condPass ? `<br><span class="small">${T.cond}: ${esc(condIn(r.i.condPass, L))}</span>` : ''}
          ${r.i.comment ? `<br><span class="small">${T.note}: ${esc(r.i.comment)}</span>` : ''}${await pics(r.i.id)}</td>
          <td>${esc(r.i.serial || r.i.lot || '-')}${r.i.mfgYear ? `<br><span class="small">${T.made} ${esc(r.i.mfgYear)}</span>` : ''}</td>
          <td><span class="r-dot" style="background:${lv ? lv.color : '#999'}"></span>${esc(lv ? lvName(lv.code, L) : T.pending)}</td>
          <td>${esc(recIn(r.rec, L))}${r.i.recOverride ? `<br><span class="small">${esc(T.adjusted(recIn(r.sysRec, L), r.i.recOverrideReason))}</span>` : ''}</td>
          ${o.noPrices ? '' : `<td class="num">${cell(r.line)}</td>`}</tr>`;
        if (o.photos) for (const x of r.dm) { const ph = await pics(x.id); if (ph) h += `<tr class="r-dmgpic"><td></td><td colspan="${o.noPrices ? 4 : 5}"><span class="small">${T.dmgPic}: ${esc(dmgName(x.damageIdx, L))}</span>${ph}</td></tr>`; }
      }
      h += `</tbody>${o.noPrices ? '' : `<tfoot><tr><td colspan="5">${T.trayTotal}${sub.optional ? ` · ${T.optShort} ${money(sub.optional, L)}` : ''}</td><td class="num"><b>${money(sub.required, L)}</b></td></tr></tfoot>`}</table></section>`;
    }
    h += `<h3>${T.s3}</h3><table class="r-tab r-legend"><tbody>${M.levels.map(l => `<tr><td><span class="r-dot" style="background:${l.color}"></span>${esc(lvName(l.code, L))}</td><td>${esc(L === 'en' ? l.recEn : l.rec)}</td></tr>`).join('')}</tbody></table>
      ${T.freeText ? `<p class="small">${T.freeText}</p>` : ''}
      <div class="r-sign"><div>${T.sign} ............................................<br>(${esc(R.a.inspector)})<br>${T.signRole}</div></div>
      <footer class="r-foot">KOSIN Tray Audit v${Logic.APP_VERSION} · ${esc(R.a.id)}</footer></article>
      <div class="noprint row" style="margin-top:12px"><button class="pri" onclick="window.print()">${T.print}</button></div>`;
    return h;
  }

  function exportExcel(R, o) {
    const L = o.lang === 'en' ? 'en' : 'th', en = L === 'en', pr = !o.noPrices, A = ACTION[L];
    const yes = en ? 'Yes' : 'ใช่', vat = Logic.withVat(R.tot.required);
    const k = (th, eng) => en ? eng : th;
    const summary = [[k('หัวข้อ', 'Item'), k('ค่า', 'Value')], [k('ลูกค้า', 'Customer'), Logic.nameIn(R.c, L)], [k('รหัสสถานพยาบาล', 'Facility code'), R.c.hcode || ''],
      [k('แผนก', 'Departments'), R.tr.depts.map(d => Logic.nameIn(d, L)).join(', ')], [k('วันที่ตรวจ', 'Inspection date'), Logic.fmtDate(R.a.plannedDate, o.era, L)],
      [k('ผู้ตรวจ', 'Inspector'), R.a.inspector], [k('เลขอ้างอิง', 'Reference'), o.refNo],
      [k('สถานะ audit', 'Audit status'), en ? (Logic.isLocked(R.a) ? 'Closed' : 'Open (draft)') : R.a.status],
      [k('จำนวนถาด', 'Trays'), R.tr.trays.length], [k('ชิ้นทั้งหมด', 'Items'), R.k.total], [lvName('OK', L), R.k.ok], [k('ชำรุด', 'Damaged'), R.k.damaged],
      [lvName('MS', L), R.k.missing], [lvName('CP', L), R.k.condPass], [k('ยังไม่ตรวจ', 'Not inspected'), R.k.pending],
      [k('ทราบปีผลิต', 'Mfg. year known'), `${R.mfgKnown} / ${R.k.total}`]]
      .concat(pr ? [[k('ค่าใช้จ่ายที่แนะนำ ก่อน VAT (บาท)', 'Recommended, excl. VAT (THB)'), vat.net], [k('VAT 7% (บาท)', 'VAT 7% (THB)'), vat.vat],
        [k('รวมทั้งสิ้น (บาท)', 'Total incl. VAT (THB)'), vat.gross], [k('ค่าซ่อมทางเลือก ก่อน VAT (บาท)', 'Optional repairs, excl. VAT (THB)'), R.tot.optional],
        [k('ชิ้นที่ไม่แสดงราคา', 'Items without price shown'), R.tot.hiddenCount], [k('ราคาตาม pricelist เดือน', 'Price list month'), P.priceMonth || '']]
        : [[k('ราคา', 'Prices'), k('ไม่แสดงในรายงานนี้', 'Not shown in this report')]])
      .concat(en ? [['Note', TXT.en.freeText]] : []).concat([[k('สร้างโดย', 'Generated by'), `KOSIN Tray Audit v${Logic.APP_VERSION} · ${Logic.APP_DEVELOPER}`]]);
    const head = (en ? ['Department', 'Tray', 'Set ID', 'No.', 'Code', 'Description', 'Product group', 'Serial', 'LOT', 'Mfg. year', 'Findings', 'Result',
      'System recommendation', 'Recommendation used', 'Reason for change', 'Conditional pass', 'Missing', 'Action']
      : ['แผนก', 'ถาด', 'Set ID', 'ลำดับ', 'รหัสสินค้า', 'คำอธิบาย', 'กลุ่มสินค้า', 'Serial', 'LOT', 'ปีผลิต', 'ตำหนิ', 'ผลตรวจ',
        'คำแนะนำของระบบ', 'คำแนะนำที่ใช้', 'เหตุผลที่ช่างเปลี่ยน', 'ผ่านแบบมีเงื่อนไข', 'ของหาย', 'การดำเนินการ'])
      .concat(pr ? (en ? ['Price excl. VAT (THB)', 'Price source', 'Old price', 'Price hidden'] : ['ราคาก่อน VAT (บาท)', 'ที่มาราคา', 'ราคาเก่า', 'ไม่แสดงราคา']) : [])
      .concat(en ? ['Note', 'Item ID'] : ['หมายเหตุ', 'รหัสชิ้น']);
    const items = [head].concat(R.rows.map(r => [Logic.nameIn(r.d, L), Logic.nameIn(r.t, L), r.t.setId || '', r.no, r.i.productCode, r.p ? (r.p[1] || TXT[L].noDesc) : '',
      grpName(r.p ? r.p[2] : M.otherGroup, L), r.i.serial || '', r.i.lot || '', r.i.mfgYear ? Number(r.i.mfgYear) : '', dmgText(r.dm, L),
      lvName(r.e, L) || TXT[L].pending, recIn(r.sysRec, L), recIn(r.rec, L), r.i.recOverrideReason || '', condIn(r.i.condPass || '', L), r.i.missing ? yes : '',
      A[r.line.action]].concat(pr ? [r.line.hidden ? '' : r.line.amount, en && r.line.source === 'ราคาซ่อม (ช่างใส่)' ? 'Repair price (technician)' : r.line.source, r.line.stale ? yes : '', r.line.hidden ? yes : ''] : [])
      .concat([r.i.comment || '', r.i.id])));
    const dmg = [en ? ['Tray', 'Code', 'Serial/LOT', 'Finding', 'Level', 'Note', 'Item ID'] : ['ถาด', 'รหัสสินค้า', 'Serial/LOT', 'ชนิดตำหนิ', 'ระดับ', 'หมายเหตุตำหนิ', 'รหัสชิ้น']]
      .concat(R.rows.flatMap(r => r.dm.map(x => [Logic.nameIn(r.t, L), r.i.productCode, r.i.serial || r.i.lot || '', dmgName(x.damageIdx, L), lvName(x.level, L), x.comment || '', r.i.id])));
    const blob = XLSX.build([
      { name: en ? 'Summary' : 'สรุป', rows: summary, widths: [34, 50] },
      { name: en ? 'Items' : 'รายชิ้น', rows: items, widths: [18, 24, 10, 6, 14, 40, 30, 14, 10, 8, 50, 22, 24, 24, 24, 24, 8, 16, 14, 18, 8, 10, 30, 16] },
      { name: en ? 'Findings' : 'ตำหนิ', rows: dmg, widths: [24, 14, 16, 40, 22, 30, 16] }],
      { title: `KOSIN Tray Audit — ${Logic.nameIn(R.c, L)}`, creator: Logic.APP_DEVELOPER, description: `KOSIN Tray Audit v${Logic.APP_VERSION} ${R.a.id} (${L})` });
    const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob);
    aEl.download = `TrayAudit_${Logic.nameIn(R.c, L).replace(/[\\/:*?"<>|]/g, '_')}_${R.a.plannedDate || ''}_${L.toUpperCase()}.xlsx`;
    document.body.appendChild(aEl); aEl.click(); aEl.remove();
    toast(en ? 'ส่งออก Excel (English) แล้ว' : 'ส่งออก Excel แล้ว');
  }

  async function settings() {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
    const lastBackup = await DB.getMeta('lastBackup');
    const trash = await DB.trashBatches();
    V.innerHTML = `<h1>ตั้งค่า</h1>
      <div class="card"><label>ชื่อผู้ตรวจ (ใช้บันทึกว่าใครทำอะไร) *</label><input id="who" value="${esc(WHO)}">
        <button class="pri" id="swho" style="margin-top:10px">บันทึกชื่อ</button></div>
      <div class="card"><b>ราคาขาย KOSIN</b> <span class="small muted">— ไม่อยู่บนเว็บ ต้องนำเข้าไฟล์ราคาที่ได้รับจากบริษัท (เก็บในเครื่องนี้เท่านั้น)</span>
        <p class="small">${P.price.size ? `นำเข้าแล้ว: ราคาเดือน ${esc(P.priceMonth)} · ${P.price.size.toLocaleString()} รหัส` : '<b>ยังไม่ได้นำเข้า</b> — รายงานจะไม่มีราคา'}</p>
        <label class="btn" style="margin:0">⬆ นำเข้าไฟล์ราคา<input type="file" id="impp" accept=".json,application/json" hidden></label><div id="pe"></div></div>
      <div class="card"><b>แบ็กอัป</b> <span class="small muted">— รุ่นนี้ยังไม่มีศูนย์กลาง ไฟล์แบ็กอัปคือด่านกันข้อมูลหาย</span>
        <p class="small">แบ็กอัปล่าสุด: ${lastBackup ? esc(lastBackup) : '<b>ยังไม่เคย</b>'}</p>
        <div class="row"><button class="pri" id="exp">⬇ ส่งออกไฟล์แบ็กอัป</button>
          <label class="btn" style="margin:0">⬆ นำเข้าไฟล์แบ็กอัป<input type="file" id="imp" accept=".json,application/json" hidden></label></div><div id="be"></div></div>
      <div class="card"><b>ถังขยะ</b> (${trash.length})<ul class="list">${trash.map(b => `<li><div class="row" style="padding:10px">
        <span class="grow small">${esc(b.at.slice(0, 16).replace('T', ' '))} · ${esc(b.first.store)} ${esc(b.first.row.name || b.first.row.productCode || b.first.row.id)} · ${b.count} แถว · โดย ${esc(b.by)}</span>
        <button class="sm" data-rest="${b.batch}">กู้คืน</button></div></li>`).join('') || '<li class="muted" style="padding:10px">ว่าง</li>'}</ul></div>
      <div class="card small"><b>เครื่องนี้</b><br>รหัสเครื่อง ${esc(await DB.deviceId())} · พื้นที่ใช้ ${est ? (est.usage / 1048576).toFixed(1) + ' MB จาก ' + (est.quota / 1048576).toFixed(0) + ' MB' : 'ไม่ทราบ'}
        · เก็บถาวร: ${persisted === null ? 'ไม่รองรับ' : persisted ? 'ใช่' : '<b>ไม่</b>'}<br>
        ข้อมูลหลัก: สินค้า ${P.rows.length.toLocaleString()} รหัส · กฎ ${M.rules.length} · ${esc(M.meta.exporter)}<br>
        แอป v${Logic.APP_VERSION} (${Logic.APP_DATE}) · พัฒนาโดย ${Logic.APP_DEVELOPER}</div>`;
    $('#swho').onclick = async () => { WHO = $('#who').value.trim(); await DB.setMeta('inspector', WHO); toast('บันทึกชื่อแล้ว'); banners(); };
    $('#exp').onclick = async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob);
      aEl.download = `KOSIN-Tray-Audit-backup-${data.deviceId}-${data.exportedAt.slice(0, 16).replace(/[:T]/g, '')}.json`;
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      await DB.setMeta('lastBackup', new Date().toLocaleString('th-TH')); await DB.setMeta('lastBackupIso', new Date().toISOString()); toast('ส่งออกแล้ว'); banners(); route();
    };
    $('#impp').onchange = async e => {
      try {
        const d = JSON.parse(await e.target.files[0].text());
        if (d.app !== 'KOSIN Tray Audit' || d.kind !== 'prices' || !Array.isArray(d.rows)) throw new Error('ไม่ใช่ไฟล์ราคาของ KOSIN Tray Audit');
        await DB.setMeta('prices', { month: d.month, rows: d.rows }); loadPrices({ month: d.month, rows: d.rows });
        toast(`นำเข้าราคา ${d.rows.length.toLocaleString()} รหัส`); route();
      } catch (err) { $('#pe').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    };
    $('#imp').onchange = async e => {
      try { const s = await DB.importAll(JSON.parse(await e.target.files[0].text()));
        $('#be').innerHTML = `<div class="card small">นำเข้าแล้ว: ${esc(Object.entries(s).map(([k, v]) => k + ' ' + v).join(' · '))}</div>`; }
      catch (err) { $('#be').innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    };
    V.querySelectorAll('[data-rest]').forEach(b => b.onclick = async () => { const n = await DB.restore(b.dataset.rest, WHO); toast(`กู้คืน ${n} แถว`); route(); });
  }

  // ---------------------------------------------------------------- router + startup
  async function route() {
    const [path, qs] = (location.hash.slice(1) || '/').split('?');
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    const s = path.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    try {
      if (!s.length) return await home();
      if (s[0] === 'new-audit') return await newAudit();
      if (s[0] === 'audit') return await auditView(s[1], q);
      if (s[0] === 'dept') return await deptView(s[1], q);
      if (s[0] === 'tray') return await trayView(s[1]);
      if (s[0] === 'item' && s[1] === 'new') return await itemView('new', s[2]);
      if (s[0] === 'item') return await itemView(s[1]);
      if (s[0] === 'report') return await reportView(s[1]);
      if (s[0] === 'settings') return await settings();
      go('#/');
    } catch (e) { console.error(e); V.innerHTML = `<div class="err">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`; }
  }

  async function banners() {
    const out = [];
    if (NEWVER) out.push(`<p class="banner new">🔄 มีเวอร์ชันใหม่ v${NEWVER} (ตอนนี้ v${Logic.APP_VERSION}) — บันทึกงานที่ทำค้างก่อน แล้วกด <button id="doUpdate" class="sm pri">อัปเดตเลย</button></p>`);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (ios && !standalone) out.push('<p class="banner bad">⚠ iPhone/iPad: กดปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดจากไอคอน — ถ้าใช้ผ่าน Safari ตรง ๆ ข้อมูลอาจถูกลบเมื่อไม่ได้เปิดนาน</p>');
    if (!WHO) out.push('<p class="banner">ยังไม่ได้ตั้งชื่อผู้ตรวจ — <a href="#/settings">ตั้งค่า</a></p>');
    const closed = (await DB.all('audits')).filter(a => Logic.isLocked(a) && (!a.backedUpAt));
    const lastBackupIso = await DB.getMeta('lastBackupIso');
    const after = closed.filter(a => !lastBackupIso || a.closedAt > lastBackupIso);
    if (after.length) out.push(`<p class="banner">💾 มี audit ที่ปิดแล้วแต่ยังไม่ได้แบ็กอัป ${after.length} รายการ — <a href="#/settings">ส่งออกไฟล์แบ็กอัป</a></p>`);
    $('#banners').innerHTML = out.join('');
    const up = $('#doUpdate'); if (up) up.onclick = () => location.reload();
  }

  /** แถบ "มีเวอร์ชันใหม่": ถาม SW ที่คุมเครื่องว่าเป็นเวอร์ชันไหน (ตอนเปิด + ทุกครั้งที่ SW ตัวใหม่เข้าคุม)
   *  และสั่งเช็กไฟล์ใหม่ทุกครั้งที่กลับมาเปิดแอปจากพื้นหลัง — มือถือมักไม่โหลดหน้าใหม่เลยถ้าไม่ได้ปิดแอป */
  function watchUpdates(reg) {
    const sw = navigator.serviceWorker;
    sw.addEventListener('message', e => {
      if (!e.data || e.data.type !== 'version') return;
      const v = Logic.updateAvailable(Logic.APP_VERSION, e.data.cache);
      if (v !== NEWVER) { NEWVER = v; banners(); }
    });
    const ask = () => { if (sw.controller) sw.controller.postMessage('version'); };
    sw.addEventListener('controllerchange', ask);
    ask();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(() => {});
    });
  }

  function loadPrices(d) {
    P.price = new Map(); P.priceMonth = '';
    if (!d || !d.rows) return;
    for (const r of d.rows) P.price.set(Logic.normCode(r[0]), r);
    P.priceMonth = d.month;
  }

  function net() { $('#net').textContent = navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์ (ทำงานต่อได้)'; }

  async function start() {
    $('#foot').textContent = `KOSIN Tray Audit v${Logic.APP_VERSION} (${Logic.APP_DATE}) · พัฒนาโดย ${Logic.APP_DEVELOPER}`;
    await DB.open();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').then(watchUpdates).catch(e => console.warn('SW', e));
    const [m, p] = await Promise.all([fetch('data/master.json').then(r => r.json()), fetch('data/products.json').then(r => r.json())]);
    M = m;
    P = { rows: p.rows, byCode: new Map(p.rows.map(r => [Logic.normCode(r[0]), r])), price: new Map() };
    loadPrices(await DB.getMeta('prices'));
    WHO = await DB.getMeta('inspector', '');
    addEventListener('online', net); addEventListener('offline', net); net();
    addEventListener('hashchange', route);
    await banners(); await route();
  }
  start().catch(e => { V.innerHTML = `<div class="err">เปิดแอปไม่ได้: ${esc(e.message)}</div>`; console.error(e); });
})();
