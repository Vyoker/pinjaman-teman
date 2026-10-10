'use strict';
// /api/settings
//   GET  (login) -> info pembayaran (Dana/ShopeePay/QRIS milik admin)
//   POST (admin) { dana, shopeepay, qrisNote } -> ubah info pembayaran
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');

module.exports = requireAuth(async (req, res) => {
  if (req.method === 'GET') {
    const s = (await getJSON('settings')) || {};
    return send(res, 200, {
      ok: true,
      settings: { dana: s.dana || '', shopeepay: s.shopeepay || '', qrisNote: s.qrisNote || '' },
    });
  }
  if (req.method === 'POST') {
    if (req.session.role !== 'admin') return send(res, 403, { ok: false, error: 'Khusus admin.' });
    try {
      const { dana, shopeepay, qrisNote } = await readBody(req);
      const s = {
        dana: String(dana || '').trim(),
        shopeepay: String(shopeepay || '').trim(),
        qrisNote: String(qrisNote || '').trim(),
      };
      await setJSON('settings', s);
      return send(res, 200, { ok: true, settings: s });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }
  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
});
