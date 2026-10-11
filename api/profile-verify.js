// /api/profile-verify
//   POST { phone, field, approve } (admin) -> setujui/tolak satu data peminjam
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');
const { FIELD_MAP, ensureProfile, limitBonus, effectiveLimit } = require('../lib/profile');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });

  const body = await readBody(req);
  const phone = normPhone(body.phone || '');
  const { field } = body;
  const approve = body.approve === true || body.approve === 'true';

  if (!FIELD_MAP[field]) return send(res, 400, { ok: false, error: 'Field tidak dikenal.' });
  const user = await getJSON('user:' + phone);
  if (!user) return send(res, 404, { ok: false, error: 'Peminjam tidak ditemukan.' });
  const profile = ensureProfile(user);
  const cur = profile[field];
  if (!cur || cur.status !== 'menunggu') {
    return send(res, 400, { ok: false, error: 'Field tidak sedang menunggu verifikasi.' });
  }
  cur.status = approve ? 'disetujui' : 'ditolak';
  cur.updatedAt = new Date().toISOString();
  await setJSON('user:' + phone, user);
  return send(res, 200, {
    ok: true,
    field,
    status: cur.status,
    bonus: limitBonus(profile),
    effectiveLimit: effectiveLimit(user),
  });
}, { admin: true });
