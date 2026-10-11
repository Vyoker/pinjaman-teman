'use strict';
// GET /api/admin-stats (admin) -> ringkasan: outstanding, jatuh tempo minggu ini, telat, antrean
const { getJSON } = require('../lib/store');
const { requireAuth, send } = require('../lib/auth');
const { calcLateFee, todayStr } = require('../lib/calc');

function addDaysStr(base, n) {
  return new Date(new Date(base + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
}

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });

  const loanIds = (await getJSON('idx:loans')) || [];
  const claimIds = (await getJSON('idx:claims')) || [];
  const userPhones = (await getJSON('idx:users')) || [];

  let outstanding = 0;
  const dueThisWeek = [];
  const late = [];
  let activeLoans = 0;
  let pendingLoans = 0;
  const today = todayStr();
  const weekAhead = addDaysStr(today, 7);

  for (const id of loanIds) {
    const l = await getJSON('loan:' + id);
    if (!l) continue;
    if (l.status === 'diajukan') { pendingLoans++; continue; }
    if (l.status !== 'berjalan') continue;
    activeLoans++;
    for (const s of l.schedule) {
      if (s.status === 'lunas') continue;
      const { daysLate, lateFee } = calcLateFee(s.amount, s.dueDate, today);
      outstanding += s.amount + lateFee; // termasuk denda berjalan
      const info = {
        loanId: l.id, borrowerName: l.borrowerName, borrowerPhone: l.borrowerPhone,
        n: s.n, nCicilan: l.nCicilan, dueDate: s.dueDate, amount: s.amount,
        status: s.status, daysLate, lateFee, totalDue: s.amount + lateFee,
      };
      if (s.dueDate < today) late.push(info);
      else if (s.dueDate <= weekAhead) dueThisWeek.push(info);
    }
  }

  let pendingBorrowers = 0;
  for (const ph of userPhones) {
    const u = await getJSON('user:' + ph);
    if (u && u.status === 'pending') pendingBorrowers++;
  }
  let pendingClaims = 0;
  for (const id of claimIds) {
    const c = await getJSON('claim:' + id);
    if (c && c.status === 'menunggu') pendingClaims++;
  }

  dueThisWeek.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  late.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return send(res, 200, {
    ok: true,
    outstanding, activeLoans, pendingLoans, pendingBorrowers, pendingClaims,
    dueThisWeek, late,
  });
}, { admin: true });
