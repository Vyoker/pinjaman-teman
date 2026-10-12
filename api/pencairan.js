'use strict';
// /api/pencairan — POST { metode, nomor, atasNama, namaBank } (peminjam)
// Menyimpan tujuan pencairan dana milik peminjam (Dana / ShopeePay / Bank).
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { validatePencairan } = require('../lib/profile');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  if (req.session.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
  const body = await readBody(req);
  const check = validatePencairan(body);
  if (!check.ok) return send(res, 400, { ok: false, error: check.error });
  const user = await getJSON('user:' + req.session.phone);
  if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });
  user.pencairan = check.value;
  await setJSON('user:' + req.session.phone, user);
  return send(res, 200, { ok: true, pencairan: user.pencairan });
});
