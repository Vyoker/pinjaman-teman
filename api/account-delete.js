'use strict';
// /api/account-delete — POST { password } (peminjam): hapus akun sendiri permanen.
// Syarat: kata sandi benar + tidak ada pinjaman diajukan/berjalan.
const { getJSON, setJSON, kv } = require('../lib/store');
const { requireAuth, readBody, send, verifyPassword } = require('../lib/auth');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  if (req.session.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
  const { password } = await readBody(req);
  const user = await getJSON('user:' + req.session.phone);
  if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });
  if (!verifyPassword(String(password || ''), user.pass)) {
    return send(res, 401, { ok: false, error: 'Kata sandi salah.' });
  }
  const loanIds = (await getJSON('idx:loans')) || [];
  for (const id of loanIds) {
    const l = await getJSON('loan:' + id);
    if (l && l.borrowerPhone === user.phone && (l.status === 'diajukan' || l.status === 'berjalan')) {
      return send(res, 400, { ok: false, error: 'Tidak bisa hapus akun: masih ada tagihan berjalan. Lunasi dulu.' });
    }
  }
  await kv().del('user:' + user.phone);
  const phones = (await getJSON('idx:users')) || [];
  await setJSON('idx:users', phones.filter((x) => x !== user.phone));
  await kv().del('sess:' + req.session.token);
  return send(res, 200, { ok: true });
});
