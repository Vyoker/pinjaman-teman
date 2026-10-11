'use strict';
// POST /api/loan-decide (admin) — gabungan loan-decide + loan-cancel (hemat slot function Vercel Hobby, maks 12)
//   { loanId, approve, tenorHari? } -> setujui/tolak pengajuan (dari loan-decide)
//     approve=true  -> tenor final (15-30, default usulan), hitung jadwal, status 'berjalan'
//     approve=false -> status 'ditolak'
//   { action:'cancel', loanId }     -> batalkan pinjaman yang sudah berjalan (dari loan-cancel)
//     Syarat: belum ada pembayaran/laporan sama sekali (semua item masih 'belum').
const { getJSON, setJSON, ensureStats } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { calcLoan, MIN_TENOR, MAX_TENOR } = require('../lib/calc');

const DAY = 864e5;

async function doCancel(req, res, body) {
  const { loanId } = body;
  const loan = await getJSON('loan:' + loanId);
  if (!loan) return send(res, 404, { ok: false, error: 'Pinjaman tidak ditemukan.' });
  if (loan.status !== 'berjalan') {
    return send(res, 400, { ok: false, error: 'Hanya pinjaman berjalan yang bisa dibatalkan.' });
  }
  if (loan.schedule.some((s) => s.status !== 'belum')) {
    return send(res, 400, { ok: false, error: 'Tidak bisa dibatalkan: sudah ada pembayaran/laporan.' });
  }
  loan.status = 'dibatalkan';
  loan.cancelledAt = new Date().toISOString();
  await setJSON('loan:' + loan.id, loan);
  // Koreksi statistik peminjam
  const borrower = await getJSON('user:' + loan.borrowerPhone);
  if (borrower) {
    const stats = ensureStats(borrower);
    stats.totalPinjam = Math.max(0, stats.totalPinjam - loan.pokok);
    await setJSON('user:' + loan.borrowerPhone, borrower);
  }
  return send(res, 200, { ok: true, loan });
}

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
  if (body.action === 'cancel') return doCancel(req, res, body);
  try {
    const { loanId, approve, tenorHari } = body;
    const loan = await getJSON('loan:' + String(loanId || ''));
    if (!loan) return send(res, 404, { ok: false, error: 'Pinjaman tidak ditemukan.' });
    if (loan.status !== 'diajukan') return send(res, 400, { ok: false, error: 'Pinjaman sudah diproses.' });

    if (!approve) {
      loan.status = 'ditolak';
      await setJSON('loan:' + loan.id, loan);
      return send(res, 200, { ok: true, loan });
    }

    const tn = tenorHari === undefined || tenorHari === null ? loan.tenorProposal : Number(tenorHari);
    if (!Number.isInteger(tn) || tn < MIN_TENOR || tn > MAX_TENOR) {
      return send(res, 400, { ok: false, error: `Tenor harus ${MIN_TENOR}-${MAX_TENOR} hari.` });
    }
    const sim = calcLoan(loan.pokok, tn, loan.metode);
    const now = Date.now();
    loan.tenorHari = tn;
    loan.nCicilan = sim.nCicilan;
    loan.bunga = sim.bunga;
    loan.biayaLayanan = sim.biayaLayanan;
    loan.total = sim.total;
    loan.schedule = sim.schedule.map((s) => ({
      ...s,
      dueDate: new Date(now + s.dueInDays * DAY).toISOString().slice(0, 10),
      status: 'belum', // belum | diklaim | lunas
      paidAt: null,
      payMethod: null,
      claimId: null,
    }));
    loan.status = 'berjalan';
    loan.approvedAt = new Date(now).toISOString();
    loan.disbursedAt = loan.approvedAt; // v1: cair manual saat disetujui
    await setJSON('loan:' + loan.id, loan);
    // Catat total pinjaman peminjam (untuk sistem rank)
    const borrower = await getJSON('user:' + loan.borrowerPhone);
    if (borrower) {
      ensureStats(borrower).totalPinjam += loan.pokok;
      await setJSON('user:' + loan.borrowerPhone, borrower);
    }
    return send(res, 200, { ok: true, loan });
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
}, { admin: true });
