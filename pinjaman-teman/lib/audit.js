'use strict';
// lib/audit.js — jejak audit aksi sensitif admin (append-only, v2.0).
// Disimpan di KV: audit:<id> + idx:audits (dibatasi 500 entri terakhir).
const { getJSON, setJSON, nextId } = require('./store');

const MAX_AUDIT = 500;

async function audit(action, actor, detail) {
  try {
    const id = await nextId('audit');
    await setJSON('audit:' + id, {
      id,
      action: String(action || '').slice(0, 60),
      actor: String(actor || '').slice(0, 60),
      detail: String(detail || '').slice(0, 300),
      createdAt: new Date().toISOString(),
    });
    const ids = (await getJSON('idx:audits')) || [];
    ids.push(id);
    // Batasi: hanya 500 terakhir
    const keep = ids.slice(-MAX_AUDIT);
    await setJSON('idx:audits', keep);
  } catch (e) {
    console.error('[audit]', e);
  }
}

async function listAudit(limit = 100) {
  const ids = (await getJSON('idx:audits')) || [];
  const out = [];
  for (const id of ids.slice(-Math.max(1, Math.min(200, limit))).reverse()) {
    const a = await getJSON('audit:' + id);
    if (a) out.push(a);
  }
  return out;
}

module.exports = { audit, listAudit, MAX_AUDIT };
