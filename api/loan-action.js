'use strict';
// POST /api/loan-action (admin) — semua aksi admin terhadap pinjaman:
//   { action:'decide', loanId, approve, tenorHari? } -> setujui (jadwal dibuat) / tolak
//   { action:'cancel', loanId }                      -> batalkan pinjaman berjalan
//        (syarat: belum ada pembayaran sama sekali)
const { getJSON, setJSON, nextId, ensureStats } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { calcLoan, MIN_TENOR, maxTenorFor, calcLateFee, todayStr, formatRp } = require('../lib/calc');
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
  const maxTenor = maxTenorFor((borrower && borrower.stats && borrower.stats.payments) || 0);
  if (!Number.isInteger(tn) || tn < MIN_TENOR || tn > maxTenor) {
    return send(res, 400, { ok: false, error: `Tenor harus ${MIN_TENOR}-${maxTenor} hari (maks rank peminjam).` });
  }
  const sim = calcLoan(loan.pokok, tn, loan.metode, maxTenor);
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

/* ============ PEMBAYARAN MANUAL (TUNAI KE ADMIN) — v1.9 ============
 * Admin menandai satu tagihan sebagai lunas karena dibayar tunai langsung,
 * mis. cicilan minggu pertama. Denda dihitung sampai tanggal bayar yang
 * diinput (bisa backdate), statistik & notifikasi peminjam ikut diperbarui.
 */
async function manualPay(res, loan, body) {
  const schedIdx = Number(body.schedIdx);
  const item = loan.schedule[schedIdx];
  if (loan.status !== 'berjalan') return send(res, 400, { ok: false, error: 'Pinjaman tidak aktif.' });
  if (!item) return send(res, 400, { ok: false, error: 'Tagihan tidak valid.' });
  if (item.status !== 'belum') return send(res, 400, { ok: false, error: 'Tagihan ini sudah diproses.' });
  const today = todayStr();
  let paidDate = String(body.paidDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) paidDate = today;
  if (paidDate > today) return send(res, 400, { ok: false, error: 'Tanggal bayar tidak boleh melebihi hari ini.' });
  const { daysLate, lateFee } = calcLateFee(item.amount, item.dueDate, paidDate);
  const note = String(body.note || '').trim().slice(0, 200);
  item.status = 'lunas';
  item.paidAt = new Date(paidDate + 'T12:00:00').toISOString();
  item.payMethod = 'tunai';
  item.claimId = null;
  item.lateFeePaid = lateFee;
  item.manualNote = note || 'Tunai ke admin';
  if (loan.schedule.every((s) => s.status === 'lunas')) loan.status = 'lunas';
  // Statistik peminjam (untuk sistem rank) — sama seperti konfirmasi klaim
  const borrower = await getJSON('user:' + loan.borrowerPhone);
  if (borrower) {
    const stats = ensureStats(borrower);
    stats.payments += 1;
    if (loan.status === 'lunas') stats.loansLunas += 1;
    await setJSON('user:' + loan.borrowerPhone, borrower);
  }
  await setJSON('loan:' + loan.id, loan);
  // Notifikasi ke peminjam
  const judul = loan.metode === 'cicilan' ? `Cicilan ${item.n}/${loan.nCicilan}` : 'Pelunasan';
  const message = `Admin mencatat ${judul} ${formatRp(item.amount)} sebagai LUNAS (tunai ke admin, ${paidDate})${daysLate > 0 ? ` — termasuk denda ${formatRp(lateFee)} (telat ${daysLate} hari)` : ''}. Terima kasih.`;
  const id = await nextId('notif');
  await setJSON('notif:' + id, {
    id, to: loan.borrowerPhone, targetName: loan.borrowerName,
    message, createdAt: new Date().toISOString(), kind: 'manual-pay',
  });
  const ids = (await getJSON('idx:notifs')) || [];
  ids.push(id);
  await setJSON('idx:notifs', ids);
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
    if (action === 'manual-pay') return manualPay(res, loan, body);
    return send(res, 400, { ok: false, error: 'Aksi tidak dikenal.' });
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
}, { admin: true });
