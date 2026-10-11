'use strict';
// /api/loan-cancel — POST { loanId } (admin): batalkan pinjaman yang sudah berjalan.
// Syarat: belum ada pembayaran/laporan sama sekali (semua item masih 'belum').
const { getJSON, setJSON, ensureStats } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  const { loanId } = await readBody(req);
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
}, { admin: true });
