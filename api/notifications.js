'use strict';
// /api/notifications (peminjam)
//   GET  -> daftar notifikasi untuk saya (broadcast 'all' + khusus saya) + jumlah belum dibaca
//   POST { action:'read', id } | { action:'readAll' } -> tandai sudah dibaca
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');

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

module.exports = requireAuth(async (req, res) => {
  if (req.session.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
  const user = await getJSON('user:' + req.session.phone);
  if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });

  if (req.method === 'GET') {
    const notifications = await listFor(user);
    return send(res, 200, { ok: true, notifications, unread: notifications.filter((n) => !n.read).length });
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
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
