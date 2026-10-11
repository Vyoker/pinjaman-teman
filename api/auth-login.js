'use strict';
// POST /api/auth-login  { phone, password } -> { token, role, name }
const { getJSON } = require('../lib/store');
const { verifyPassword, createSession, readBody, send, normPhone } = require('../lib/auth');
const { isMemoryMode } = require('../lib/store');

const STORAGE = () => (isMemoryMode() ? 'memory' : 'kv');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  try {
    const { phone, password } = await readBody(req);
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
};
