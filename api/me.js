'use strict';
// GET /api/me -> profil sesi berjalan
const { getJSON } = require('../lib/store');
const { requireAuth, send } = require('../lib/auth');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  const { phone, role, name } = req.session;
  const out = { ok: true, phone, role, name };
  if (role === 'borrower') {
    const user = await getJSON('user:' + phone);
    out.limit = user ? user.limit : 0;
    out.status = user ? user.status : 'unknown';
  }
  return send(res, 200, out);
});
