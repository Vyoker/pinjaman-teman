'use strict';
// POST /api/simulate  { pokok } -> simulasi tutup buku v2.5:
//   jatuh tempo = tanggal 1 bulan depan, tenor = hari sampai tanggal itu,
//   pelunasan sekali lunas.
const { getJSON } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { calcLoan, amountWithMethod, daysToNextFirst, nextFirstDate, localDateStr } = require('../lib/calc');
const { effectiveLimit, limitBonus } = require('../lib/profile');

module.exports = requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
  try {
    const { pokok } = await readBody(req);
    const pk = Number(pokok);
    if (!Number.isInteger(pk) || pk <= 0) {
      return send(res, 400, { ok: false, error: 'Pokok tidak valid.' });
    }
    const days = daysToNextFirst(new Date());
    const dueDate = localDateStr(nextFirstDate(new Date()));
    const sim = calcLoan(pk, days, 'lunas');

    const withPay = (amount) => ({
      dana: amountWithMethod(amount, 'dana'),
      shopeepay: amountWithMethod(amount, 'shopeepay'),
      qris: amountWithMethod(amount, 'qris'),
    });

    const schedule = sim.schedule.map((s) => ({ ...s, bayar: withPay(s.amount) }));
    const out = { ok: true, ...sim, days, dueDate, schedule, totalBayar: withPay(sim.total) };

    if (req.session.role === 'borrower') {
      const user = await getJSON('user:' + req.session.phone);
      const eff = user ? effectiveLimit(user) : 0;
      out.limit = eff;
      out.limitDasar = user ? user.limit : 0;
      out.bonusLimit = user ? limitBonus(user.profile) : 0;
      out.lebihDariLimit = sim.pokok > eff;
    }
    return send(res, 200, out);
  } catch (e) {
    return send(res, 400, { ok: false, error: e.message });
  }
});
