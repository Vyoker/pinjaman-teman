// /api/profile
//   GET  -> profil data diri (peminjam: milik sendiri; admin: ?phone=...)
//   POST { field, value } (peminjam) -> kirim/ubah satu data (status -> menunggu)
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');
const { FIELD_MAP, ensureProfile, validateField, limitBonus, maxBonus, effectiveLimit } = require('../lib/profile');

function shape(user) {
  const profile = ensureProfile(user);
  const bonus = limitBonus(profile);
  return {
    ok: true,
    name: user.name,
    phone: user.phone,
    limit: user.limit || 0,
    bonus,
    maxBonus: maxBonus(),
    effectiveLimit: effectiveLimit(user),
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
    if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
    const body = await readBody(req);
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
