'use strict';
// POST /api/loan-action (admin) — semua aksi admin terhadap pinjaman:
//   { action:'decide', loanId, approve, tenorHari? } -> setujui (jadwal dibuat) / tolak
//   { action:'cancel', loanId }                      -> batalkan pinjaman berjalan
//        (syarat: belum ada pembayaran sama sekali)
const { getJSON, setJSON, ensureStats } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { calcLoan, MIN_TENOR, MAX_TENOR } = require('../lib/calc');
const { isPencairanComplete } = require('../lib/profile');

const DAY = 864e5;

async function decide(res, loan, body) {
  if (loan.status !== 'diajukan') return send(res, 400, { ok: false, error: 'Pinjaman sudah diproses.' });
  if (!body.approve) {
    loan.status = 'ditolak';
    await setJSON('loan:' + loan.id, loan);
    return send(res, 200, { ok: true, loan });
  }
  const borrower = await getJSON('user:' + loan.borrowerPhone);
  if (!isPencairanComplete(borrower || {})) {
    return send(res, 400, { ok: false, error: 'Peminjam belum mengisi data pencairan (Dana/ShopeePay/ATM).' });
  }
  const tn = body.tenorHari === undefined || body.tenorHari === null ? loan.tenorProposal : Number(body.tenorHari);
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
  loan.disbursedAt = loan.approvedAt; // cair manual saat disetujui
  await setJSON('loan:' + loan.id, loan);
  ensureStats(borrower).totalPinjam += loan.pokok;
  await setJSON('user:' + loan.borrowerPhone, borrower);
  return send(res, 200, { ok: true, loan });
}

async function cancel(res, loan) {
  if (loan.status !== 'berjalan') {
    return send(res, 400, { ok: false, error: 'Hanya pinjaman berjalan yang bisa dibatalkan.' });
  }
  if (loan.schedule.some((s) => s.status !== 'belum')) {
    return send(res, 400, { ok: false, error: 'Tidak bisa dibatalkan: sudah ada pembayaran/laporan.' });
  }
  loan.status = 'dibatalkan';
  loan.cancelledAt = new Date().toISOString();
  await setJSON('loan:' + loan.id, loan);
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
  try {
    const body = await readBody(req);
    const action = body.action || 'decide';
    const loan = await getJSON('loan:' + String(body.loanId || ''));
    if (!loan) return send(res, 404, { ok: false, error: 'Pinjaman tidak ditemukan.' });
    if (action === 'decide') return decide(res, loan, body);
    if (action === 'cancel') return cancel(res, loan);
    return send(res, 400, { ok: false, error: 'Aksi tidak dikenal.' });
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
}, { admin: true });
