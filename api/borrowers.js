'use strict';
// /api/borrowers (admin) — gabungan borrowers + user-delete (hemat slot function Vercel Hobby, maks 12)
//   GET  -> daftar peminjam
//   POST { phone, approve, limit }  -> setujui/tolak pendaftaran + atur limit (dari borrowers)
//   POST { action:'delete', phone } -> hapus akun peminjam permanen (dari user-delete)
//     Syarat hapus: tidak ada pinjaman berstatus diajukan/berjalan.
//     Riwayat pinjaman yang sudah selesai tetap tersimpan untuk pembukuan.
const { getJSON, setJSON, ensureStats, kv } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');
const { rankFor } = require('../lib/calc');

async function listUsers() {
  const phones = (await getJSON('idx:users')) || [];
  const out = [];
  for (const ph of phones) {
    const u = await getJSON('user:' + ph);
    if (!u) continue;
    const stats = ensureStats(u);
    const { current } = rankFor(stats.payments);
    out.push({
      name: u.name, phone: u.phone, status: u.status, limit: u.limit,
      createdAt: u.createdAt, stats, rank: current ? current.name : null,
    });
  }
  return out;
}

async function doDelete(req, res, body) {
  const ph = normPhone(body.phone || '');
  const user = await getJSON('user:' + ph);
  if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });

  const loanIds = (await getJSON('idx:loans')) || [];
  for (const id of loanIds) {
    const l = await getJSON('loan:' + id);
    if (l && l.borrowerPhone === ph && (l.status === 'diajukan' || l.status === 'berjalan')) {
      return send(res, 400, { ok: false, error: 'Tidak bisa hapus: masih ada pinjaman aktif. Batalkan dulu.' });
    }
  }

  await kv().del('user:' + ph);
  const phones = (await getJSON('idx:users')) || [];
  await setJSON('idx:users', phones.filter((x) => x !== ph));
  return send(res, 200, { ok: true, phone: ph, name: user.name });
}

module.exports = requireAuth(async (req, res) => {
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, borrowers: await listUsers() });
  }
  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (body.action === 'delete') return doDelete(req, res, body);
      const { phone, approve, limit } = body;
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
