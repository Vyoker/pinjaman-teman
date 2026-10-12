'use strict';
// /api/broadcast (admin) — notifikasi in-app ke peminjam.
//   GET  -> riwayat broadcast terakhir
//   POST { mode:'all' }                       -> ke semua peminjam aktif
//        { mode:'selected', phones:[...] }    -> ke peminjam terpilih
//        { message }                          -> isi pesan (wajib)
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');

async function history() {
  const ids = (await getJSON('idx:notifs')) || [];
  const out = [];
  for (const id of ids.slice(-20)) {
    const n = await getJSON('notif:' + id);
    if (n) out.push(n);
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

module.exports = requireAuth(async (req, res) => {
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, history: await history() });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });

  const body = await readBody(req);
  const message = String(body.message || '').trim();
  if (message.length < 3 || message.length > 500) {
    return send(res, 400, { ok: false, error: 'Pesan harus 3–500 karakter.' });
  }
  const mode = body.mode === 'selected' ? 'selected' : 'all';

  let targets = []; // [{ to, targetName }]
  if (mode === 'all') {
    targets = [{ to: 'all', targetName: 'Semua user' }];
  } else {
    const phones = [...new Set((Array.isArray(body.phones) ? body.phones : []).map(normPhone).filter(Boolean))];
    if (!phones.length) return send(res, 400, { ok: false, error: 'Pilih minimal satu user.' });
    for (const ph of phones) {
      const u = await getJSON('user:' + ph);
      if (u && u.status === 'active') targets.push({ to: ph, targetName: u.name });
    }
    if (!targets.length) return send(res, 400, { ok: false, error: 'User terpilih tidak ditemukan/aktif.' });
  }

  const createdAt = new Date().toISOString();
  const ids = (await getJSON('idx:notifs')) || [];
  const sent = [];
  for (const t of targets) {
    const id = await nextId('notif');
    const rec = { id, to: t.to, targetName: t.targetName, message, createdAt };
    await setJSON('notif:' + id, rec);
    ids.push(id);
    sent.push(rec);
  }
  await setJSON('idx:notifs', ids);
  return send(res, 200, { ok: true, sent: sent.length, notifications: sent });
}, { admin: true });
