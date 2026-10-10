'use strict';
// /api/borrowers (admin)
//   GET  -> daftar peminjam
//   POST { phone, approve, limit } -> setujui/tolak pendaftaran + atur limit
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');

async function listUsers() {
  const phones = (await getJSON('idx:users')) || [];
  const out = [];
  for (const ph of phones) {
    const u = await getJSON('user:' + ph);
    if (u) out.push({ name: u.name, phone: u.phone, status: u.status, limit: u.limit, createdAt: u.createdAt });
  }
  return out;
}

module.exports = requireAuth(async (req, res) => {
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, borrowers: await listUsers() });
  }
  if (req.method === 'POST') {
    try {
      const { phone, approve, limit } = await readBody(req);
      const ph = normPhone(phone);
      const user = await getJSON('user:' + ph);
      if (!user) return send(res, 404, { ok: false, error: 'Peminjam tidak ditemukan.' });
      if (approve) {
        const lim = Number(limit);
        if (!Number.isInteger(lim) || lim <= 0) {
          return send(res, 400, { ok: false, error: 'Limit harus bilangan bulat positif.' });
        }
        user.status = 'active';
        user.limit = lim;
      } else {
        user.status = 'rejected';
      }
      await setJSON('user:' + ph, user);
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }
  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
}, { admin: true });
