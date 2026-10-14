// /api/profile
//   GET  -> profil data diri (peminjam: milik sendiri; admin: ?phone=...)
//   POST { field, value } (peminjam) -> kirim/ubah satu data (status -> menunggu)
//   POST { action:'verify', phone, field, approve } (admin) -> setujui/tolak satu data
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');
const { FIELD_MAP, ensureProfile, validateField, validatePencairan, limitBonus, maxBonus, effectiveLimit } = require('../lib/profile');
const { rankBonusFor } = require('../lib/calc');

function shape(user) {
  const profile = ensureProfile(user);
  const bonus = limitBonus(profile);
  const rankBonus = rankBonusFor((user.stats && user.stats.payments) || 0);
  return {
    ok: true,
    name: user.name,
    phone: user.phone,
    limit: user.limit || 0,
    bonus,
    rankBonus,
    maxBonus: maxBonus(),
    effectiveLimit: effectiveLimit(user),
    pencairan: user.pencairan || null,
    profile,
    fields: Object.values(FIELD_MAP).map((f) => ({ key: f.key, label: f.label, type: f.type, bonus: f.bonus, options: f.options || null })),
  };
}

module.exports = requireAuth(async (req, res) => {
  const sess = req.session;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const qPhone = url.searchParams.get('phone');
    if (qPhone) {
      if (sess.role !== 'admin') return send(res, 403, { ok: false, error: 'Khusus admin.' });
      const user = await getJSON('user:' + normPhone(qPhone));
      if (!user) return send(res, 404, { ok: false, error: 'Peminjam tidak ditemukan.' });
      return send(res, 200, shape(user));
    }
    if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
    const user = await getJSON('user:' + sess.phone);
    if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });
    return send(res, 200, shape(user));
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    // Peminjam: simpan data pencairan (gabungan pencairan.js sejak v1.4.1)
    if (body.action === 'pencairan') {
      if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
      const check = validatePencairan(body);
      if (!check.ok) return send(res, 400, { ok: false, error: check.error });
      const user = await getJSON('user:' + sess.phone);
      if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });
      user.pencairan = check.value;
      await setJSON('user:' + sess.phone, user);
      return send(res, 200, { ok: true, pencairan: user.pencairan });
    }
    // Admin: verifikasi satu data (setujui/tolak)
    if (body.action === 'verify') {
      if (sess.role !== 'admin') return send(res, 403, { ok: false, error: 'Khusus admin.' });
      const phone = normPhone(body.phone || '');
      const { field } = body;
      const approve = body.approve === true || body.approve === 'true';
      if (!FIELD_MAP[field]) return send(res, 400, { ok: false, error: 'Field tidak dikenal.' });
      const target = await getJSON('user:' + phone);
      if (!target) return send(res, 404, { ok: false, error: 'Peminjam tidak ditemukan.' });
      const tProfile = ensureProfile(target);
      const cur = tProfile[field];
      if (!cur || cur.status !== 'menunggu') {
        return send(res, 400, { ok: false, error: 'Field tidak sedang menunggu verifikasi.' });
      }
      cur.status = approve ? 'disetujui' : 'ditolak';
      cur.updatedAt = new Date().toISOString();
      await setJSON('user:' + phone, target);
      return send(res, 200, {
        ok: true, field, status: cur.status,
        bonus: limitBonus(tProfile), effectiveLimit: effectiveLimit(target),
        rankBonus: rankBonusFor((target.stats && target.stats.payments) || 0),
      });
    }
    // Peminjam: kirim/ubah satu data
    if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
    const { field, value } = body;
    const check = validateField(field, value);
    if (!check.ok) return send(res, 400, { ok: false, error: check.error });
    const user = await getJSON('user:' + sess.phone);
    if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });
    const profile = ensureProfile(user);
    profile[field] = { value: check.value, status: 'menunggu', updatedAt: new Date().toISOString() };
    await setJSON('user:' + sess.phone, user);
    return send(res, 200, shape(user));
  }

  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
});
