'use strict';
// /api/payments
//   GET  -> daftar klaim pembayaran (peminjam: milik sendiri; admin: semua, ?status=menunggu)
//   POST { action:'claim', loanId, schedIdx, payMethod } (peminjam) -> lapor bayar
//        (nominal klaim = tagihan + denda telat s.d. tanggal lapor; MDR QRIS di atasnya)
//   POST { action:'confirm', claimId, approve } (admin) -> konfirmasi/tolak klaim
const { getJSON, setJSON, nextId, ensureStats } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { amountWithMethod, calcLateFee, todayStr } = require('../lib/calc');

async function idxPush(key, val) {
  const arr = (await getJSON(key)) || [];
  if (!arr.includes(val)) { arr.push(val); await setJSON(key, arr); }
}

async function listClaims(filter) {
  const ids = (await getJSON('idx:claims')) || [];
  const out = [];
  for (const id of ids) {
    const c = await getJSON('claim:' + id);
    if (!c) continue;
    if (filter && filter.phone && c.borrowerPhone !== filter.phone) continue;
    if (filter && filter.status && c.status !== filter.status) continue;
    out.push(c);
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

module.exports = requireAuth(async (req, res) => {
  const sess = req.session;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || '';
    const filter = sess.role === 'admin' ? { status } : { phone: sess.phone, status };
    return send(res, 200, { ok: true, claims: await listClaims(filter) });
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });

  try {
    const body = await readBody(req);

    // --- Peminjam lapor bayar ---
    if (body.action === 'claim') {
      if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Hanya peminjam.' });
      const { loanId, schedIdx, payMethod } = body;
      const loan = await getJSON('loan:' + String(loanId || ''));
      if (!loan || loan.borrowerPhone !== sess.phone) {
        return send(res, 404, { ok: false, error: 'Pinjaman tidak ditemukan.' });
      }
      if (loan.status !== 'berjalan') return send(res, 400, { ok: false, error: 'Pinjaman tidak aktif.' });
      const item = loan.schedule[Number(schedIdx)];
      if (!item) return send(res, 400, { ok: false, error: 'Tagihan tidak valid.' });
      if (item.status !== 'belum') return send(res, 400, { ok: false, error: 'Tagihan ini sudah diproses.' });
      if (!['dana', 'shopeepay', 'qris'].includes(payMethod)) {
        return send(res, 400, { ok: false, error: 'Metode bayar tidak valid.' });
      }
      // Denda dihitung sampai tanggal lapor bayar
      const today = todayStr();
      const { daysLate, lateFee } = calcLateFee(item.amount, item.dueDate, today);
      const base = item.amount + lateFee;
      const amount = amountWithMethod(base, payMethod);
      const id = await nextId('claim');
      const claim = {
        id, loanId: loan.id, schedIdx: Number(schedIdx),
        borrowerPhone: sess.phone, borrowerName: loan.borrowerName,
        baseAmount: item.amount, lateFee, daysLate,
        amount, payMethod, status: 'menunggu',
        createdAt: new Date().toISOString(), decidedAt: null,
      };
      item.status = 'diklaim';
      item.claimId = id;
      await setJSON('claim:' + id, claim);
      await setJSON('loan:' + loan.id, loan);
      await idxPush('idx:claims', id);
      return send(res, 200, { ok: true, claim });
    }

    // --- Admin konfirmasi ---
    if (body.action === 'confirm') {
      if (sess.role !== 'admin') return send(res, 403, { ok: false, error: 'Khusus admin.' });
      const { claimId, approve } = body;
      const claim = await getJSON('claim:' + String(claimId || ''));
      if (!claim) return send(res, 404, { ok: false, error: 'Klaim tidak ditemukan.' });
      if (claim.status !== 'menunggu') return send(res, 400, { ok: false, error: 'Klaim sudah diproses.' });
      const loan = await getJSON('loan:' + claim.loanId);
      if (!loan) return send(res, 404, { ok: false, error: 'Pinjaman tidak ditemukan.' });
      const item = loan.schedule[claim.schedIdx];

      if (approve) {
        claim.status = 'diterima';
        item.status = 'lunas';
        item.paidAt = new Date().toISOString();
        item.payMethod = claim.payMethod;
        item.claimId = null;
        item.lateFeePaid = claim.lateFee || 0;
        if (loan.schedule.every((s) => s.status === 'lunas')) loan.status = 'lunas';
        // Statistik peminjam (untuk sistem rank)
        const borrower = await getJSON('user:' + loan.borrowerPhone);
        if (borrower) {
          const stats = ensureStats(borrower);
          stats.payments += 1;
          if (loan.status === 'lunas') stats.loansLunas += 1;
          await setJSON('user:' + loan.borrowerPhone, borrower);
        }
      } else {
        claim.status = 'ditolak';
        item.status = 'belum';
        item.claimId = null;
      }
      claim.decidedAt = new Date().toISOString();
      await setJSON('claim:' + claim.id, claim);
      await setJSON('loan:' + loan.id, loan);
      return send(res, 200, { ok: true, claim, loan });
    }

    return send(res, 400, { ok: false, error: 'Action tidak dikenal.' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
});
