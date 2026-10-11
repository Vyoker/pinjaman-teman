'use strict';
// GET /api/me -> profil sesi berjalan
const { getJSON, isMemoryMode, ensureStats } = require('../lib/store');
const { requireAuth, send } = require('../lib/auth');
const { rankFor } = require('../lib/calc');
const { limitBonus, effectiveLimit } = require('../lib/profile');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  const { phone, role, name } = req.session;
  const out = { ok: true, phone, role, name, storage: isMemoryMode() ? 'memory' : 'kv' };
  if (role === 'borrower') {
    const user = await getJSON('user:' + phone);
    const stats = ensureStats(user || {});
    const { current, next } = rankFor(stats.payments);
    out.limit = user ? user.limit : 0;
    out.bonusLimit = user ? limitBonus(user.profile) : 0;
    out.effectiveLimit = user ? effectiveLimit(user) : 0;
    out.status = user ? user.status : 'unknown';
    out.stats = stats;
    out.rank = current;
    out.nextRank = next;
  }
  return send(res, 200, out);
});
