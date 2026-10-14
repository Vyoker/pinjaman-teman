'use strict';
// /api/loans
//   GET  -> daftar pinjaman (peminjam: milik sendiri; admin: semua, ?status=)
//   POST (peminjam) { pokok, tenorHari, metode } -> ajukan pinjaman (status 'diajukan')
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { MIN_TENOR, calcLateFee, todayStr, maxTenorFor } = require('../lib/calc');
const { effectiveLimit } = require('../lib/profile');

async function idxPush(key, val) {
  const arr = (await getJSON(key)) || [];
  if (!arr.includes(val)) { arr.push(val); await setJSON(key, arr); }
}

async function listLoans(filter) {
  const ids = (await getJSON('idx:loans')) || [];
  const out = [];
  for (const id of ids) {
    const l = await getJSON('loan:' + id);
    if (!l) continue;
    if (filter && filter.phone && l.borrowerPhone !== filter.phone) continue;
    if (filter && filter.status && l.status !== filter.status) continue;
    out.push(l);
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  // Tambahkan info denda berjalan (dihitung, tidak disimpan)
  const today = todayStr();
  for (const l of out) {
    if (l.status !== 'berjalan' || !Array.isArray(l.schedule)) continue;
    l.schedule = l.schedule.map((s) => {
      if (s.status === 'lunas') return { ...s, daysLate: 0, lateFee: 0, totalDue: s.amount };
      const { daysLate, lateFee } = calcLateFee(s.amount, s.dueDate, today);
      return { ...s, daysLate, lateFee, totalDue: s.amount + lateFee };
    });
  }
  return out;
}

async function hasActiveLoan(phone) {
  const loans = await listLoans({ phone });
  return loans.some((l) => l.status === 'diajukan' || l.status === 'berjalan');
}

module.exports = requireAuth(async (req, res) => {
  const sess = req.session;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || '';
    const filter = sess.role === 'admin' ? { status } : { phone: sess.phone, status };
    const loans = await listLoans(filter);
    // Admin perlu tahu tenor maksimum tiap peminjam (unlock rank) saat menyetujui
    if (sess.role === 'admin') {
      for (const l of loans) {
        const u = await getJSON('user:' + l.borrowerPhone);
        l.maxTenor = maxTenorFor((u && u.stats && u.stats.payments) || 0);
      }
    }
    return send(res, 200, { ok: true, loans });
  }

  if (req.method === 'POST') {
    if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Hanya peminjam.' });
    try {
      const { pokok, tenorHari, metode } = await readBody(req);
      const pk = Number(pokok);
      const tn = Number(tenorHari);
      if (!Number.isInteger(pk) || pk <= 0) return send(res, 400, { ok: false, error: 'Pokok tidak valid.' });
      if (metode !== 'lunas' && metode !== 'cicilan') {
        return send(res, 400, { ok: false, error: 'Metode pelunasan tidak valid.' });
      }
      const user = await getJSON('user:' + sess.phone);
      if (!user || user.status !== 'active') return send(res, 403, { ok: false, error: 'Akun tidak aktif.' });
      const maxTenor = maxTenorFor((user.stats && user.stats.payments) || 0);
      if (!Number.isInteger(tn) || tn < MIN_TENOR || tn > maxTenor) {
        return send(res, 400, { ok: false, error: `Tenor harus ${MIN_TENOR}-${maxTenor} hari.` });
      }
      if (pk > effectiveLimit(user)) return send(res, 400, { ok: false, error: 'Pokok melebihi limit kamu.' });
      if (await hasActiveLoan(sess.phone)) {
        return send(res, 400, { ok: false, error: 'Masih ada pinjaman aktif. Selesaikan dulu.' });
      }
      const id = await nextId('loan');
      const loan = {
        id, borrowerPhone: sess.phone, borrowerName: user.name,
        pokok: pk, tenorProposal: tn, tenorHari: null, metode,
        nCicilan: null, bunga: null, biayaLayanan: null, total: null,
        schedule: [], status: 'diajukan',
        createdAt: new Date().toISOString(), approvedAt: null, disbursedAt: null,
      };
      await setJSON('loan:' + id, loan);
      await idxPush('idx:loans', id);
      return send(res, 200, { ok: true, loan });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }

  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
}, );
