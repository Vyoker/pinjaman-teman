'use strict';
// /api/borrowers (admin)
//   GET  -> daftar peminjam
//   POST { phone, approve, limit }   -> setujui/tolak pendaftaran + atur limit
//   POST { action:'delete', phone }  -> hapus akun permanen (tanpa pinjaman aktif)
const { getJSON, setJSON, ensureStats, kv, nextId } = require('../lib/store');
const { requireAuth, readBody, send, normPhone, destroyAllSessions } = require('../lib/auth');
const { rankFor, formatRp } = require('../lib/calc');
const { audit } = require('../lib/audit');

async function listUsers() {
  const phones = (await getJSON('idx:users')) || [];
  const out = [];
  for (const ph of phones) {
    const u = await getJSON('user:' + ph);
    if (!u) continue;
    const stats = ensureStats(u);
    const { current } = rankFor(stats.payments);
    out.push({
      name: u.name, phone: u.phone, status: u.status, limit: u.limit,
      createdAt: u.createdAt, stats, rank: current ? current.name : null,
      pencairan: u.pencairan || null,
    });
  }
  return out;
}

module.exports = requireAuth(async (req, res) => {
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    // Daftar permintaan logout semua perangkat yang menunggu persetujuan
    if (url.searchParams.get('view') === 'logout-requests') {
      const ids = (await getJSON('idx:logoutreqs')) || [];
      const out = [];
      for (const ph of ids) {
        const rq = await getJSON('logoutreq:' + ph);
        if (rq && rq.status === 'menunggu') out.push(rq);
      }
      return send(res, 200, { ok: true, requests: out });
    }
    return send(res, 200, { ok: true, borrowers: await listUsers() });
  }
  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const actor = req.session.phone;
      // Setujui permintaan logout semua perangkat (v2.0)
      if (body.action === 'logout-approve') {
        const ph = normPhone(body.phone);
        const rq = await getJSON('logoutreq:' + ph);
        if (!rq || rq.status !== 'menunggu') {
          return send(res, 400, { ok: false, error: 'Tidak ada permintaan menunggu untuk nomor ini.' });
        }
        const n = await destroyAllSessions(ph);
        rq.status = 'disetujui';
        rq.decidedAt = new Date().toISOString();
        await setJSON('logoutreq:' + ph, rq);
        // Notifikasi ke peminjam
        const nid = await nextId('notif');
        await setJSON('notif:' + nid, {
          id: nid, to: ph, targetName: rq.name,
          message: 'Permintaan logout semua perangkat disetujui admin. Silakan login ulang di perangkat kamu.',
          createdAt: new Date().toISOString(), kind: 'logout-approved',
        });
        const ids = (await getJSON('idx:notifs')) || [];
        ids.push(nid);
        await setJSON('idx:notifs', ids);
        await audit('logout-semua-disetujui', actor, `${rq.name} (${ph}): ${n} sesi dihanguskan.`);
        return send(res, 200, { ok: true, sessions: n });
      }
      const { approve, limit } = body;
      const ph = normPhone(body.phone);
      const user = await getJSON('user:' + ph);
      if (!user) return send(res, 404, { ok: false, error: 'Peminjam tidak ditemukan.' });
      // Hapus akun permanen (syarat: tidak ada pinjaman aktif)
      if (body.action === 'delete') {
        const loanIds = (await getJSON('idx:loans')) || [];
        for (const id of loanIds) {
          const l = await getJSON('loan:' + id);
          if (l && l.borrowerPhone === ph && (l.status === 'diajukan' || l.status === 'berjalan')) {
            return send(res, 400, { ok: false, error: 'Tidak bisa hapus: masih ada pinjaman aktif. Batalkan dulu.' });
          }
        }
        await kv().del('user:' + ph);
        const phones = (await getJSON('idx:users')) || [];
        await setJSON('idx:users', phones.filter((x) => x !== ph));
        await audit('hapus-akun', actor, `${user.name} (${ph}) dihapus permanen oleh admin.`);
        return send(res, 200, { ok: true, phone: ph, name: user.name });
      }
      if (approve) {
        const lim = Number(limit);
        if (!Number.isInteger(lim) || lim <= 0) {
          return send(res, 400, { ok: false, error: 'Limit harus bilangan bulat positif.' });
        }
        const wasActive = user.status === 'active';
        const oldLimit = user.limit || 0;
        user.status = 'active';
        user.limit = lim;
        await audit(wasActive ? 'ubah-limit' : 'setujui-pendaftaran', actor,
          wasActive
            ? `${user.name} (${ph}): limit ${formatRp(oldLimit)} -> ${formatRp(lim)}.`
            : `${user.name} (${ph}) disetujui, limit ${formatRp(lim)}.`);
      } else {
        user.status = 'rejected';
        await audit('tolak-pendaftaran', actor, `${user.name} (${ph}) ditolak.`);
      }
      await setJSON('user:' + ph, user);
      return send(res, 200, { ok: true });
    } catch (e) {
      console.error('[borrowers]', e);
      return send(res, 500, { ok: false, error: 'Terjadi kesalahan server. Silakan coba lagi.' });
    }
  }
  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
}, { admin: true });
