'use strict';
// POST /api/auth-register  { name, phone, password } -> akun menunggu persetujuan admin
const { getJSON, setJSON } = require('../lib/store');
const { hashPassword, readBody, send, normPhone } = require('../lib/auth');

async function idxPush(key, val) {
  const arr = (await getJSON(key)) || [];
  if (!arr.includes(val)) { arr.push(val); await setJSON(key, arr); }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  try {
    const { name, phone, password } = await readBody(req);
    const nm = String(name || '').trim();
    const ph = normPhone(phone);
    const pw = String(password || '');
    if (nm.length < 2) return send(res, 400, { ok: false, error: 'Nama terlalu pendek.' });
    if (!/^[0-9]{9,15}$/.test(ph)) return send(res, 400, { ok: false, error: 'Nomor HP tidak valid.' });
    if (pw.length < 6) return send(res, 400, { ok: false, error: 'Password minimal 6 karakter.' });

    if (await getJSON('user:' + ph)) {
      return send(res, 400, { ok: false, error: 'Nomor HP sudah terdaftar.' });
    }
    await setJSON('user:' + ph, {
      name: nm, phone: ph, pass: hashPassword(pw),
      status: 'pending', limit: 0, createdAt: new Date().toISOString(),
    });
    await idxPush('idx:users', ph);
    return send(res, 200, { ok: true, message: 'Pendaftaran diterima. Menunggu persetujuan admin.' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
