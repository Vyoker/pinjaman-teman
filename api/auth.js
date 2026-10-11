'use strict';
// POST /api/auth — gabungan auth-login + auth-register (hemat slot function Vercel Hobby, maks 12)
//   { action:'login', phone, password }          -> { token, role, name }            (dari auth-login)
//   { action:'register', name, phone, password } -> akun menunggu persetujuan admin  (dari auth-register)
//   Tanpa action -> dianggap 'login' (kompatibel).
const { getJSON, setJSON, isMemoryMode } = require('../lib/store');
const { verifyPassword, hashPassword, createSession, readBody, send, normPhone } = require('../lib/auth');

const STORAGE = () => (isMemoryMode() ? 'memory' : 'kv');

async function idxPush(key, val) {
  const arr = (await getJSON(key)) || [];
  if (!arr.includes(val)) { arr.push(val); await setJSON(key, arr); }
}

async function doLogin(res, body) {
  try {
    const { phone, password } = body;
    const ph = normPhone(phone);
    const pw = String(password || '');
    if (!ph || !pw) return send(res, 400, { ok: false, error: 'Nomor HP dan password wajib diisi.' });

    // Admin dari environment variable
    const adminPhone = normPhone(process.env.ADMIN_PHONE || '');
    const adminPass = process.env.ADMIN_PASSWORD || '';
    if (adminPhone && ph === adminPhone && adminPass && pw === adminPass) {
      const token = await createSession({ phone: ph, role: 'admin', name: 'Admin' });
      return send(res, 200, { ok: true, token, role: 'admin', name: 'Admin', storage: STORAGE() });
    }

    const user = await getJSON('user:' + ph);
    if (!user || !verifyPassword(pw, user.pass)) {
      return send(res, 401, { ok: false, error: 'Nomor HP / password salah.' });
    }
    if (user.status === 'pending') {
      return send(res, 403, { ok: false, error: 'Akun menunggu persetujuan admin.' });
    }
    if (user.status !== 'active') {
      return send(res, 403, { ok: false, error: 'Akun tidak aktif.' });
    }
    const token = await createSession({ phone: ph, role: 'borrower', name: user.name });
    return send(res, 200, { ok: true, token, role: 'borrower', name: user.name, storage: STORAGE() });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
}

async function doRegister(res, body) {
  try {
    const { name, phone, password } = body;
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
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
  const action = body.action || 'login';
  if (action === 'login') return doLogin(res, body);
  if (action === 'register') return doRegister(res, body);
  return send(res, 400, { ok: false, error: 'Aksi tidak dikenal.' });
};
