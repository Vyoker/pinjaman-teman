'use strict';
// /api/notifications
// Peminjam:
//   GET  -> daftar notifikasi untuk saya (broadcast 'all' + khusus saya) + jumlah belum dibaca
//   POST { action:'read', id } | { action:'readAll' } -> tandai sudah dibaca
// Admin (gabungan broadcast.js sejak v1.4.1 — hemat jatah function Vercel Hobby):
//   GET  -> riwayat broadcast terakhir
//   POST { mode:'all' } | { mode:'selected', phones:[...] } + { message } -> kirim broadcast
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');

async function listFor(user) {
  const ids = (await getJSON('idx:notifs')) || [];
  const readSet = new Set(user.readNotifIds || []);
  const out = [];
  for (const id of ids) {
    const n = await getJSON('notif:' + id);
    if (!n) continue;
    if (n.to !== 'all' && n.to !== user.phone) continue;
    out.push({ id: n.id, message: n.message, createdAt: n.createdAt, read: readSet.has(n.id) });
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

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

async function broadcast(req, res) {
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
}

module.exports = requireAuth(async (req, res) => {
  if (req.session.role === 'admin') return broadcast(req, res);

  if (req.session.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
  const user = await getJSON('user:' + req.session.phone);
  if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });

  if (req.method === 'GET') {
    const notifications = await listFor(user);
    return send(res, 200, { ok: true, notifications, unread: notifications.filter((n) => !n.read).length });
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    // Percobaan broadcast oleh peminjam -> tolak seperti endpoint admin lama
    if (body.mode !== undefined || body.message !== undefined) {
      return send(res, 403, { ok: false, error: 'Khusus admin.' });
    }
    const read = new Set(user.readNotifIds || []);
    if (body.action === 'readAll') {
      const all = await listFor(user);
      all.forEach((n) => read.add(n.id));
    } else if (body.action === 'read' && body.id) {
      read.add(String(body.id));
    } else {
      return send(res, 400, { ok: false, error: 'Aksi tidak dikenal.' });
    }
    user.readNotifIds = [...read].slice(-300);
    await setJSON('user:' + user.phone, user);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
});
