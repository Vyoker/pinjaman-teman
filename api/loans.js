'use strict';
// /api/loans
//   GET  -> daftar pinjaman (peminjam: milik sendiri; admin: semua, ?status=)
//   POST (peminjam) { pokok } -> ajukan pinjaman (status 'diajukan');
//     v2.5: tenor & metode ditentukan sistem (tutup buku tanggal 1).
//   POST { action:'simulate', pokok } -> simulasi tutup buku (dulu /api/simulate,
//     digabung ke sini di v2.9.5 karena Vercel Hobby maks 12 Serverless Function).
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { calcLateFee, todayStr, cooldownRemaining, daysToNextFirst, totalDueOf, MIN_POKOK, calcLoan, amountWithMethod, nextFirstDate, localDateStr } = require('../lib/calc');
const { effectiveLimit, limitBonus } = require('../lib/profile');

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
      const { daysLate, lateFee, totalDue } = totalDueOf(s, today);
      return { ...s, daysLate, lateFee, totalDue };
    });
  }
  return out;
}

async function hasActiveLoan(phone) {
  const loans = await listLoans({ phone });
  return loans.some((l) => ['diajukan', 'berjalan'].includes(l.status));
}

module.exports = requireAuth(async (req, res) => {
  const sess = req.session;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || '';
    const filter = sess.role === 'admin' ? { status } : { phone: sess.phone, status };
    const loans = await listLoans(filter);
    return send(res, 200, { ok: true, loans });
  }

  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      // v2.9.5: simulasi (dulu /api/simulate, digabung karena batas 12 function).
      if (body.action === 'simulate') {
        const pk = Number(body.pokok);
        if (!Number.isInteger(pk) || pk <= 0) {
          return send(res, 400, { ok: false, error: 'Pokok tidak valid.' });
        }
        if (pk < MIN_POKOK) {
          return send(res, 400, { ok: false, error: 'Minimal pengajuan Rp10.000.' });
        }
        const days = daysToNextFirst(new Date());
        const dueDate = localDateStr(nextFirstDate(new Date()));
        const sim = calcLoan(pk, days, 'lunas');
        const withPay = (amount) => ({
          dana: amountWithMethod(amount, 'dana'),
          qris: amountWithMethod(amount, 'qris'),
        });
        const schedule = sim.schedule.map((s) => ({ ...s, bayar: withPay(s.amount) }));
        const out = { ok: true, ...sim, days, dueDate, schedule, totalBayar: withPay(sim.total) };
        if (sess.role === 'borrower') {
          const user = await getJSON('user:' + sess.phone);
          const eff = user ? effectiveLimit(user) : 0;
          out.limit = eff;
          out.limitDasar = user ? user.limit : 0;
          out.bonusLimit = user ? limitBonus(user.profile) : 0;
          out.lebihDariLimit = sim.pokok > eff;
        }
        return send(res, 200, out);
      }
      if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Hanya peminjam.' });
      // v2.5: tutup buku — pengajuan hanya membawa pokok; tenor & metode
      // ditentukan sistem (sekali lunas, jatuh tempo tanggal 1 bulan depan).
      const { pokok } = body;
      const pk = Number(pokok);
      if (!Number.isInteger(pk) || pk <= 0) return send(res, 400, { ok: false, error: 'Pokok tidak valid.' });
      if (pk < MIN_POKOK) return send(res, 400, { ok: false, error: 'Minimal pengajuan Rp10.000.' });
      const user = await getJSON('user:' + sess.phone);
      if (!user || user.status !== 'active') return send(res, 403, { ok: false, error: 'Akun tidak aktif.' });
      // v2.9.2: akun dibatasi admin — tidak bisa mengajukan pinjaman baru.
      if (user.restricted) return send(res, 400, { ok: false, error: 'Akun dibatasi admin. Kamu tidak bisa mengajukan pinjaman baru.' });
      if (pk > effectiveLimit(user)) {
        return send(res, 400, { ok: false, error: 'Pokok melebihi limit kamu.' });
      }
      if (await hasActiveLoan(sess.phone)) {
        return send(res, 400, { ok: false, error: 'Masih ada pinjaman aktif. Selesaikan dulu.' });
      }
      // v2.3: jeda 3 hari setelah pelunasan sebelum boleh mengajukan lagi
      const loansMine = await listLoans({ phone: sess.phone });
      const sisa = cooldownRemaining(loansMine, user); // v2.9.3: durasi ikut paket langganan
      if (sisa > 0) {
        const bisa = new Date(Date.now() + sisa);
        const tgl = bisa.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        return send(res, 400, { ok: false, error: `Baru bisa mengajukan lagi pada ${tgl} (jeda 3 hari setelah pelunasan).` });
      }
      const id = await nextId('loan');
      const loan = {
        id, borrowerPhone: sess.phone, borrowerName: user.name,
        pokok: pk, tenorProposal: daysToNextFirst(new Date()), tenorHari: null, metode: 'lunas',
        tutupBuku: true, // v2.5: jatuh tempo tanggal 1 bulan depan
        nCicilan: null, bunga: null, biayaLayanan: null, biayaPencairan: null, total: null,
        schedule: [], status: 'diajukan',
        createdAt: new Date().toISOString(), approvedAt: null, disbursedAt: null,
      };
      await setJSON('loan:' + id, loan);
      await idxPush('idx:loans', id);
      return send(res, 200, { ok: true, loan });
    } catch (e) {
      console.error('[loans]', e);
      return send(res, 500, { ok: false, error: 'Terjadi kesalahan server. Silakan coba lagi.' });
    }
  }

  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
}, );
