'use strict';
// GET /api/me -> profil sesi berjalan
const { getJSON, isMemoryMode, ensureStats } = require('../lib/store');
const { requireAuth, send } = require('../lib/auth');
const { rankFor, rankBonusFor, activeSubPlan, cooldownHoursFor, SUB_PLANS, ensurePetData, petProductionPerSec } = require('../lib/calc');
const { limitBonus, effectiveLimit } = require('../lib/profile');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  const { phone, role, name } = req.session;
  const out = { ok: true, phone, role, name, storage: isMemoryMode() ? 'memory' : 'kv' };
  if (role === 'borrower') {
    const user = await getJSON('user:' + phone);
    const stats = ensureStats(user || {});
    const { current, next } = rankFor(stats.loansLunas);
    out.limit = user ? user.limit : 0;
    out.bonusLimit = user ? limitBonus(user.profile) : 0;
    out.rankBonus = rankBonusFor(stats.loansLunas);
    out.effectiveLimit = user ? effectiveLimit(user) : 0;
    out.pencairan = user ? user.pencairan || null : null;
    out.status = user ? user.status : 'unknown';
    out.restricted = user ? !!user.restricted : false; // v2.9.2: akun dibatasi admin
    // v2.9.3: langganan aktif (null bila tidak ada / kedaluwarsa)
    const plan = user ? activeSubPlan(user) : null;
    out.subPlan = plan;
    out.subPlanName = plan ? SUB_PLANS[plan].name : null;
    out.subExpiresAt = plan && user.subExpiresAt ? user.subExpiresAt : null;
    out.subBonus = user ? (user.subBonus || 0) : 0;
    out.subCooldownHours = cooldownHoursFor(user);
    out.stats = stats;
    // v2.9.5: Pet, kristal, koin
    ensurePetData(user || {});
    out.kristal = user ? (user.kristal || 0) : 0;
    out.koin = user ? (user.koin || 0) : 0;
    out.petCount = user && user.pets ? user.pets.length : 0;
    out.petProductionPerSec = user ? petProductionPerSec(user.pets || []) : 0;
    out.rank = current;
    out.nextRank = next;
  }
  return send(res, 200, out);
});
