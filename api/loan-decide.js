'use strict';
// POST /api/loan-decide (admin) { loanId, approve, tenorHari? }
//   approve=true  -> tenor final (15-30, default usulan), hitung jadwal, status 'berjalan'
//   approve=false -> status 'ditolak'
const { getJSON, setJSON } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { calcLoan, MIN_TENOR, MAX_TENOR } = require('../lib/calc');

const DAY = 864e5;

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  try {
    const { loanId, approve, tenorHari } = await readBody(req);
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
    return send(res, 200, { ok: true, loan });
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
}, { admin: true });
