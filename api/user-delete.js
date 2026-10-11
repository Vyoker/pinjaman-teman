'use strict';
// /api/user-delete — POST { phone } (admin): hapus akun peminjam permanen.
// Syarat: tidak ada pinjaman berstatus diajukan/berjalan.
// Riwayat pinjaman yang sudah selesai tetap tersimpan untuk pembukuan.
const { getJSON, setJSON, kv } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  const { phone } = await readBody(req);
  const ph = normPhone(phone || '');
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
}, { admin: true });
