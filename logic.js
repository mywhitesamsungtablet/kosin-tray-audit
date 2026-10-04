/* KOSIN Tray Audit — กฎธุรกิจ (ไม่แตะหน้าจอ/ฐานข้อมูล ทดสอบด้วย Node ได้)
 * ทุกด่านที่ "ห้าม" อยู่ที่นี่ที่เดียว — หน้าจอเรียกใช้ ไม่เขียนกฎซ้ำเอง
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_VERSION = '1.01';
  const APP_DATE = '2026-10-04';
  const APP_DEVELOPER = 'KOSIE';

  // รหัสระดับที่ตรรกะต้องรู้จักชื่อ (ค่าอื่นมาจาก master.json)
  const OK = 'OK', CP = 'CP', MS = 'MS';

  /** รหัสสินค้าตามมาตรฐาน KOSIN: ตัดช่องว่าง/ขีด/จุด + ตัด .0 ท้าย + ตัวใหญ่ */
  function normCode(v) {
    if (v === null || v === undefined) return '';
    let s = String(v).trim();
    if (/^-?\d+\.0$/.test(s)) s = s.slice(0, -2);
    return s.replace(/[\s\-.]/g, '').toUpperCase();
  }

  /** ข้อมูลทดสอบ ⟺ ชื่อลูกค้าขึ้นต้น SIM- (มาตรฐาน KOSIN §6.7) — คำนวณจากชื่อเสมอ ไม่เก็บแยก จึงขัดกันไม่ได้ */
  function isTestCustomer(name) {
    return /^SIM-/i.test(String(name || '').trim());
  }

  function rankMap(levels) {
    const m = {};
    for (const l of levels) m[l.code] = l.rank;
    return m;
  }

  /** ระดับตั้งต้นของตำหนิตามกฎ ; ไม่มีกฎ (กลุ่ม "อื่นๆ" หรือคู่ที่ไม่เคยเกิด) = null ให้ช่างเลือกเอง */
  function defaultLevel(master, groupIdx, damageIdx) {
    for (const r of master.rules) if (r[0] === groupIdx && r[1] === damageIdx) return r[2];
    return null;
  }

  /** ชนิดตำหนิที่แสดงในรายการ: ของกลุ่มนั้นก่อน (ตามกฎ) แล้วตามด้วยที่เหลือ — ไม่ซ่อน เพราะของจริงอาจไม่เคยอยู่ในใบซ่อม */
  function damageChoices(master, groupIdx) {
    const inGroup = master.rules.filter(r => r[0] === groupIdx).map(r => r[1]);
    const rest = master.damages.map((_, i) => i).filter(i => !inGroup.includes(i));
    return { inGroup, rest };
  }

  /**
   * ผลประเมินของชิ้น = ระดับหนักสุด
   * item: {missing, condPass, template}  damages: [{level}]
   * ชิ้นแม่แบบที่ยังไม่ตรวจ (template) ไม่มีผลประเมิน -> null
   */
  function itemEvaluation(item, damages, levels) {
    if (item.template) return null;
    if (item.missing) return MS;
    if (item.condPass) return CP;
    if (!damages || damages.length === 0) return OK;
    const rk = rankMap(levels);
    let best = null;
    for (const d of damages) {
      if (!d.level || !(d.level in rk)) continue;
      if (best === null || rk[d.level] > rk[best]) best = d.level;
    }
    return best || OK;
  }

  /** คำแนะนำ: ช่างเปลี่ยนได้ (ต้องมีเหตุผล — ตรวจใน validateItem) */
  function itemRecommendation(evalCode, item, levels) {
    if (item && item.recOverride) return item.recOverride;
    const l = levels.find(x => x.code === evalCode);
    return l ? l.rec : '';
  }

  /** ด่านของชิ้นงาน — คืนรายการข้อผิดพลาด (ว่าง = ผ่าน) */
  function validateItem(item, damages, levels) {
    const err = [];
    const codes = new Set(levels.map(l => l.code));
    if (!normCode(item.productCode)) err.push('ยังไม่ได้เลือกสินค้า');
    if (item.serial && item.lot) err.push('ใส่ได้อย่างใดอย่างหนึ่ง: Serial หรือ LOT');
    if (item.missing && (damages.length || item.condPass || item.serial || item.lot))
      err.push('ของหาย: ใส่ตำหนิ / ผ่านแบบมีเงื่อนไข / Serial / LOT ไม่ได้');
    if (item.condPass && damages.length) err.push('ผ่านแบบมีเงื่อนไข: ใส่ตำหนิไม่ได้');
    damages.forEach((d, i) => {
      if (d.damageIdx === null || d.damageIdx === undefined || d.damageIdx === '') err.push(`ตำหนิรายการที่ ${i + 1}: ยังไม่ได้เลือกชนิด`);
      if (!d.level || !codes.has(d.level)) err.push(`ตำหนิรายการที่ ${i + 1}: ยังไม่ได้เลือกระดับ`);
    });
    if (item.recOverride && !String(item.recOverrideReason || '').trim())
      err.push('เปลี่ยนคำแนะนำแล้ว ต้องใส่เหตุผล');
    if (item.repairPrice !== null && item.repairPrice !== undefined && item.repairPrice !== '') {
      const p = Number(item.repairPrice);
      if (!isFinite(p) || p < 0) err.push('ราคาซ่อมต้องเป็นตัวเลขไม่ติดลบ');
    }
    if (item.mfgYear !== null && item.mfgYear !== undefined && item.mfgYear !== '') {
      const y = Number(item.mfgYear);
      if (!Number.isInteger(y) || y < 1970 || y > 2100) err.push('ปีผลิตต้องเป็น ค.ศ. 1970-2100');
    }
    return err;
  }

  /** นับจำนวนสรุป — ชิ้นแม่แบบที่ยังไม่ตรวจ "ไม่ถูกนับเป็นไม่ชำรุด" (StayReady นับ) */
  function counts(items, damagesByItem, levels) {
    const c = { total: 0, pending: 0, ok: 0, damaged: 0, missing: 0, condPass: 0 };
    for (const it of items) {
      c.total++;
      const e = itemEvaluation(it, damagesByItem[it.id] || [], levels);
      if (e === null) c.pending++;
      else if (e === MS) c.missing++;
      else if (e === CP) c.condPass++;
      else if (e === OK) c.ok++;
      else c.damaged++;
    }
    return c;
  }

  /** สถานะถาดรวมจากชิ้น */
  function trayStatus(items) {
    if (!items.length) return 'ว่าง';
    return items.some(i => i.template) ? 'มีชิ้นยังไม่ตรวจ' : 'ตรวจแล้ว';
  }

  /** ด่านปิด audit: ห้ามปิดถ้ายังมีชิ้นยังไม่ตรวจ หรือไม่มีชิ้นเลย */
  function canCloseAudit(items) {
    const reasons = [];
    if (!items.length) reasons.push('ยังไม่มีชิ้นงานใน audit นี้');
    const pending = items.filter(i => i.template).length;
    if (pending) reasons.push(`ยังมีชิ้นที่คัดลอกมาแต่ยังไม่ตรวจ ${pending} ชิ้น`);
    return { ok: reasons.length === 0, reasons };
  }

  /** audit ที่ปิดแล้ว = ล็อก ; เปิดใหม่ต้องมีเหตุผล */
  function isLocked(audit) { return audit.status === 'ปิดงานแล้ว'; }
  function reopenAudit(audit, reason, who, now) {
    if (!isLocked(audit)) throw new Error('audit นี้ยังไม่ได้ปิด');
    if (!String(reason || '').trim()) throw new Error('เปิดงานอีกครั้งต้องใส่เหตุผล');
    return Object.assign({}, audit, {
      status: 'กำลังตรวจ',
      reopenLog: (audit.reopenLog || []).concat([{ at: now, by: who, reason: String(reason).trim() }])
    });
  }

  /** คัดลอกชิ้นเป็นแม่แบบ: เก็บรุ่น ล้าง serial/LOT/ตำหนิ/ผลตรวจ — ต้องตรวจใหม่ */
  function templateFrom(item) {
    return {
      productCode: item.productCode,
      serial: '', lot: '', mfgYear: '', comment: '',
      missing: false, condPass: '', recOverride: '', recOverrideReason: '', repairPrice: '',
      template: true, copiedFrom: item.id
    };
  }

  /** เตือนเมื่อจริงเกินที่ประมาณ */
  function estimateWarnings(audit, trayCount, itemCount) {
    const w = [];
    if (audit.estTrays && trayCount > audit.estTrays) w.push(`ถาดจริง ${trayCount} เกินที่ประมาณ ${audit.estTrays}`);
    if (audit.estItems && itemCount > audit.estItems) w.push(`ชิ้นจริง ${itemCount} เกินที่ประมาณ ${audit.estItems}`);
    return w;
  }

  return {
    APP_VERSION, APP_DATE, APP_DEVELOPER, OK, CP, MS,
    normCode, isTestCustomer, defaultLevel, damageChoices, itemEvaluation, itemRecommendation,
    validateItem, counts, trayStatus, canCloseAudit, isLocked, reopenAudit, templateFrom, estimateWarnings
  };
});
