'use strict';
// POST /api/auth  { action:'login', phone, password }    -> { token, role, name }
// POST /api/auth  { action:'register', name, phone, password } -> akun menunggu persetujuan admin
// (Gabungan auth-login.js + auth-register.js sejak v1.4.1 — hemat jatah function Vercel Hobby.)
const { getJSON, setJSON, kv, isMemoryMode } = require('../lib/store');
const { verifyPassword, hashPassword, createSession, getSession, readBody, send, normPhone } = require('../lib/auth');
const { audit } = require('../lib/audit');

const STORAGE = () => (isMemoryMode() ? 'memory' : 'kv');

/** Tanggal hari ini dalam WIB (untuk jendela rate limit harian). */
function todayWIB() {
  return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
}

/** IP klien (Vercel: x-forwarded-for). */
function clientIP(req) {
  const h = req.headers || {};
  const fwd = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  const ip = String(fwd).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  return ip || 'unknown';
}

// ============ RATE LIMIT LOGIN: 3x gagal/hari per nomor HP (v2.0) ============
async function loginLocked(ph) {
  const rec = await getJSON('rl:login:' + ph);
  return !!(rec && rec.date === todayWIB() && rec.fails >= 3);
}

async function loginFail(ph) {
  const today = todayWIB();
  const rec = (await getJSON('rl:login:' + ph)) || { fails: 0, date: today };
  if (rec.date !== today) { rec.fails = 0; rec.date = today; }
  rec.fails += 1;
  await setJSON('rl:login:' + ph, rec, { ex: 2 * 86400 });
  return rec.fails;
}

async function loginClear(ph) {
  try { await kv().del('rl:login:' + ph); } catch { /* abaikan */ }
}

async function idxPush(key, val) {
  const arr = (await getJSON(key)) || [];
  if (!arr.includes(val)) { arr.push(val); await setJSON(key, arr); }
}

async function login(body, res) {
  const ph = normPhone(body.phone);
  const pw = String(body.password || '');
  if (!ph || !pw) return send(res, 400, { ok: false, error: 'Nomor HP dan password wajib diisi.' });

  // Kunci setelah 3x gagal dalam sehari (WIB)
  if (await loginLocked(ph)) {
    return send(res, 429, { ok: false, error: 'Terlalu banyak percobaan gagal. Coba lagi besok.' });
  }
  const fail = async () => {
    const n = await loginFail(ph);
    const sisa = Math.max(0, 3 - n);
    return send(res, 401, {
      ok: false,
      error: n >= 3
        ? 'Terlalu banyak percobaan gagal. Coba lagi besok.'
        : `Nomor HP / password salah. Sisa ${sisa} percobaan hari ini.`,
    });
  };

  // Admin dari environment variable
  const adminPhone = normPhone(process.env.ADMIN_PHONE || '');
  const adminPass = process.env.ADMIN_PASSWORD || '';
  if (adminPhone && ph === adminPhone && adminPass && pw === adminPass) {
    await loginClear(ph);
    const token = await createSession({ phone: ph, role: 'admin', name: 'Admin' });
    return send(res, 200, { ok: true, token, role: 'admin', name: 'Admin', storage: STORAGE() });
  }

  const user = await getJSON('user:' + ph);
  if (!user || !verifyPassword(pw, user.pass)) {
    return fail();
  }
  if (user.status === 'pending') {
    return send(res, 403, { ok: false, error: 'Akun menunggu persetujuan admin.' });
  }
  if (user.status !== 'active') {
    return send(res, 403, { ok: false, error: 'Akun tidak aktif.' });
  }
  await loginClear(ph);
  const token = await createSession({ phone: ph, role: 'borrower', name: user.name });
  return send(res, 200, { ok: true, token, role: 'borrower', name: user.name, storage: STORAGE() });
}

// ============ RATE LIMIT REGISTER: 3x/jam per IP (v2.0) ============
async function registerAllowed(ip) {
  if (!ip || ip === 'unknown') return true; // IP tak terdeteksi: jangan blokir
  const key = 'rl:reg:' + ip;
  const nowH = Math.floor(Date.now() / 3600e3);
  const rec = (await getJSON(key)) || { hour: nowH, count: 0 };
  if (rec.hour !== nowH) { rec.hour = nowH; rec.count = 0; }
  if (rec.count >= 3) return false;
  rec.count += 1;
  await setJSON(key, rec, { ex: 2 * 3600 });
  return true;
}

async function register(req, body, res) {
  const ip = clientIP(req);
  if (!(await registerAllowed(ip))) {
    return send(res, 429, { ok: false, error: 'Terlalu banyak pendaftaran. Coba lagi nanti.' });
  }
  const nm = String(body.name || '').trim();
  const ph = normPhone(body.phone);
  const pw = String(body.password || '');
  if (nm.length < 2) return send(res, 400, { ok: false, error: 'Nama terlalu pendek.' });
  if (!/^[0-9]{9,15}$/.test(ph)) return send(res, 400, { ok: false, error: 'Nomor HP tidak valid.' });
  if (pw.length < 8) return send(res, 400, { ok: false, error: 'Password minimal 8 karakter.' });

  if (await getJSON('user:' + ph)) {
    return send(res, 400, { ok: false, error: 'Nomor HP sudah terdaftar.' });
  }
  await setJSON('user:' + ph, {
    name: nm, phone: ph, pass: hashPassword(pw),
    status: 'pending', limit: 0, createdAt: new Date().toISOString(),
  });
  await idxPush('idx:users', ph);
  return send(res, 200, { ok: true, message: 'Pendaftaran diterima. Menunggu persetujuan admin.' });
}

/** Ganti password sendiri (peminjam) — butuh password lama (v2.0). */
async function changePassword(req, body, res) {
  const sess = await getSession(req);
  if (!sess || sess.role !== 'borrower') return send(res, 401, { ok: false, error: 'Belum login.' });
  const oldPw = String(body.oldPassword || '');
  const newPw = String(body.newPassword || '');
  if (!oldPw || !newPw) return send(res, 400, { ok: false, error: 'Password lama dan baru wajib diisi.' });
  if (newPw.length < 8) return send(res, 400, { ok: false, error: 'Password baru minimal 8 karakter.' });
  const user = await getJSON('user:' + sess.phone);
  if (!user || !verifyPassword(oldPw, user.pass)) {
    return send(res, 400, { ok: false, error: 'Password lama salah.' });
  }
  user.pass = hashPassword(newPw);
  await setJSON('user:' + sess.phone, user);
  await audit('ganti-password', sess.phone, `Peminjam ${user.name} mengganti password.`);
  return send(res, 200, { ok: true, message: 'Password berhasil diganti.' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  try {
    const body = await readBody(req);
    if (body.action === 'login') return await login(body, res);
    if (body.action === 'register') return await register(req, body, res);
    if (body.action === 'change-password') return await changePassword(req, body, res);
    return send(res, 400, { ok: false, error: 'Aksi tidak dikenal.' });
  } catch (e) {
    console.error('[auth]', e);
    return send(res, 500, { ok: false, error: 'Terjadi kesalahan server. Silakan coba lagi.' });
  }
};
