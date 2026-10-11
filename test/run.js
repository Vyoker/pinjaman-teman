'use strict';
// Tes logika & alur API end-to-end (mode memori, tanpa KV).
// Jalankan: node test/run.js   (dari root project)

process.env.ADMIN_PHONE = '0811000000';
process.env.ADMIN_PASSWORD = 'admin-kuat-123';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { EventEmitter } = require('events');
const assert = require('assert');

const calc = require('../lib/calc');
const { isMemoryMode, getJSON, setJSON } = require('../lib/store');

assert.ok(isMemoryMode(), 'harus jalan dalam mode memori untuk tes');

function mockReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', JSON.stringify(body));
    req.emit('end');
  });
  return req;
}
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, _body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(d) { this._body += (d || ''); if (this._done) this._done(); },
    onDone(fn) { this._done = fn; },
  };
  return res;
}
async function call(handlerPath, opts) {
  const handler = require(handlerPath);
  const req = mockReq(opts);
  const res = mockRes();
  await new Promise((resolve, reject) => {
    res.onDone(resolve);
    Promise.resolve(handler(req, res)).then(() => {}, reject);
  });
  return { status: res.statusCode, json: JSON.parse(res._body) };
}
const auth = (t) => ({ Authorization: 'Bearer ' + t });

let n = 0;
function ok(cond, label) {
  n++;
  assert.ok(cond, 'GAGAL: ' + label);
  console.log('  ok -', label);
}

(async () => {
  console.log('== Tes kalkulasi ==');
  const a = calc.calcLoan(500000, 30, 'lunas');
  ok(a.total === 532000, 'contoh user: 500rb/30hr/lunas = 532.000 (dapat ' + a.total + ')');
  ok(a.bunga === 30000, 'bunga 30.000');
  ok(a.nCicilan === 1, 'lunas = 1 tagihan');

  const b = calc.calcLoan(500000, 30, 'cicilan');
  ok(b.nCicilan === 4, '30 hari -> 4 cicilan');
  ok(b.schedule.reduce((s, x) => s + x.amount, 0) === 532000, 'cicilan genap 4x133.000 = 532.000');
  ok(JSON.stringify(b.schedule.map((x) => x.dueInDays)) === '[8,15,23,30]', 'jatuh tempo tiap ~7-8 hari');

  const c = calc.calcLoan(500000, 15, 'cicilan');
  ok(c.nCicilan === 2, '15 hari -> 2 cicilan');
  ok(c.total === 517000, 'total 15 hari = 517.000');

  const d = calc.calcLoan(1000001, 30, 'cicilan');
  ok(d.schedule.reduce((s, x) => s + x.amount, 0) === d.total, 'sisa pembulatan masuk angsuran terakhir');

  ok(calc.amountWithMethod(532000, 'qris') === 537320, 'QRIS +1% MDR = 537.320');
  ok(calc.amountWithMethod(532000, 'dana') === 532000, 'Dana tanpa tambahan');
  assert.throws(() => calc.calcLoan(500000, 10, 'lunas'), /Tenor/, 'tenor <15 ditolak');
  assert.throws(() => calc.calcLoan(500000, 31, 'lunas'), /Tenor/, 'tenor >30 ditolak');
  console.log('  ok - validasi tenor');

  console.log('== Tes denda & rank ==');
  const lf = calc.calcLateFee(133000, '2026-10-01', '2026-10-06');
  ok(lf.daysLate === 5 && lf.lateFee === 6650, 'denda 1%/hari x 5 hari = 6.650');
  const lf0 = calc.calcLateFee(133000, '2026-10-06', '2026-10-06');
  ok(lf0.daysLate === 0 && lf0.lateFee === 0, 'belum jatuh tempo = tanpa denda');
  const lfEarly = calc.calcLateFee(133000, '2026-10-10', '2026-10-06');
  ok(lfEarly.daysLate === 0 && lfEarly.lateFee === 0, 'bayar lebih awal = tanpa denda');
  ok(calc.rankFor(0).current === null && calc.rankFor(0).next.name === 'Bronze', 'rank 0 pembayaran');
  ok(calc.rankFor(9).current === null, 'rank 9 pembayaran masih kosong');
  ok(calc.rankFor(10).current.name === 'Bronze', 'rank 10 = Bronze');
  ok(calc.rankFor(25).current.name === 'Silver' && calc.rankFor(25).next.name === 'Gold', 'rank 25 = Silver, next Gold');
  ok(calc.rankFor(55).current.name === 'Diamond' && calc.rankFor(55).next === null, 'rank 55 = Diamond (max)');

  console.log('== Tes alur API ==');
  // 1. registrasi
  let r = await call('../api/auth-register', { method: 'POST', body: { name: 'Budi', phone: '08123456789', password: 'budi123' } });
  ok(r.json.ok, 'registrasi Budi');
  // 2. login sebelum disetujui -> 403
  r = await call('../api/auth-login', { method: 'POST', body: { phone: '08123456789', password: 'budi123' } });
  ok(r.status === 403, 'login pending ditolak (403)');
  // 3. login admin
  r = await call('../api/auth-login', { method: 'POST', body: { phone: '0811000000', password: 'admin-kuat-123' } });
  ok(r.json.ok && r.json.role === 'admin', 'login admin');
  ok(r.json.storage === 'memory', 'login info mode penyimpanan (memory saat tes)');
  const tA = r.json.token;
  // 4. admin setujui + limit
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '08123456789', approve: true, limit: 1000000 } });
  ok(r.json.ok, 'admin setujui Budi, limit 1jt');
  // 5. login Budi
  r = await call('../api/auth-login', { method: 'POST', body: { phone: '08123456789', password: 'budi123' } });
  ok(r.json.ok && r.json.role === 'borrower', 'login Budi');
  const tB = r.json.token;
  // 6. simulasi melebihi limit
  r = await call('../api/simulate', { method: 'POST', headers: auth(tB), body: { pokok: 2000000, tenorHari: 30, metode: 'lunas' } });
  ok(r.json.lebihDariLimit === true, 'simulasi tandai melebihi limit');
  // 7. ajukan
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 500000, tenorHari: 30, metode: 'cicilan' } });
  ok(r.json.ok && r.json.loan.status === 'diajukan', 'pengajuan pinjaman');
  const loanId = r.json.loan.id;
  // 8. ajukan lagi saat masih aktif -> tolak
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 100000, tenorHari: 15, metode: 'lunas' } });
  ok(!r.json.ok, 'pengajuan ganda ditolak');
  // 9. admin setujui dengan tenor final
  r = await call('../api/loan-decide', { method: 'POST', headers: auth(tA), body: { loanId, approve: true, tenorHari: 30 } });
  ok(r.json.ok && r.json.loan.status === 'berjalan', 'pinjaman disetujui -> berjalan');
  ok(r.json.loan.schedule.length === 4, 'jadwal 4 cicilan dibuat');
  ok(r.json.loan.total === 532000, 'total jadwal 532.000');
  // 10. bayar cicilan 1 via QRIS
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId, schedIdx: 0, payMethod: 'qris' } });
  ok(r.json.ok && r.json.claim.amount === 134330, 'klaim cicilan-1 QRIS = 134.330 (dapat ' + (r.json.claim && r.json.claim.amount) + ')');
  const claimId = r.json.claim.id;
  // 11. klaim ganda item sama -> tolak
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId, schedIdx: 0, payMethod: 'dana' } });
  ok(!r.json.ok, 'klaim ganda ditolak');
  // 12. admin konfirmasi terima
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId, approve: true } });
  ok(r.json.ok && r.json.claim.status === 'diterima', 'klaim diterima');
  ok(r.json.loan.schedule[0].status === 'lunas', 'cicilan-1 lunas');
  // 13. lunasi sisa 3 via dana
  for (let i = 1; i <= 3; i++) {
    r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId, schedIdx: i, payMethod: 'dana' } });
    assert.ok(r.json.ok, 'klaim cicilan-' + (i + 1));
    r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: r.json.claim.id, approve: true } });
    assert.ok(r.json.ok, 'konfirmasi cicilan-' + (i + 1));
  }
  r = await call('../api/loans', { method: 'GET', headers: auth(tB) });
  ok(r.json.loans[0].status === 'lunas', 'pinjaman lunas setelah semua cicilan');
  // 14. stats
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  ok(r.json.ok && r.json.outstanding === 0, 'outstanding 0 setelah lunas');
  // 15. borrower tidak bisa akses admin
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tB) });
  ok(r.status === 403, 'peminjam ditolak akses stats admin');
  // 16. tanpa token
  r = await call('../api/loans', { method: 'GET' });
  ok(r.status === 401, 'tanpa token -> 401');

  console.log('== Tes e2e denda & statistik ==');
  // 17. statistik & rank tercatat setelah alur pertama
  r = await call('../api/me', { method: 'GET', headers: auth(tB) });
  ok(r.json.stats.payments === 4 && r.json.stats.loansLunas === 1 && r.json.stats.totalPinjam === 500000,
    'statistik: 4 bayar, 1 lunas, total pinjam 500rb');
  ok(r.json.rank === null && r.json.nextRank.name === 'Bronze', 'rank masih kosong di 4 pembayaran');

  // 18. pinjaman kedua, jatuh tempo dimundurkan 5 hari -> kena denda
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 300000, tenorHari: 15, metode: 'lunas' } });
  assert.ok(r.json.ok, 'pengajuan kedua');
  const loan2 = r.json.loan.id;
  r = await call('../api/loan-decide', { method: 'POST', headers: auth(tA), body: { loanId: loan2, approve: true, tenorHari: 15 } });
  assert.ok(r.json.ok, 'pinjaman kedua disetujui');
  assert.strictEqual(r.json.loan.total, 311000, 'total pinjaman kedua 311.000');
  const l2 = await getJSON('loan:' + loan2);
  l2.schedule[0].dueDate = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  await setJSON('loan:' + loan2, l2);
  r = await call('../api/loans', { method: 'GET', headers: auth(tB) });
  const it2 = r.json.loans[0].schedule[0];
  ok(it2.daysLate === 5 && it2.lateFee === 15550 && it2.totalDue === 326550,
    'denda tampil: 5 hari x 1% x 311.000 = 15.550');
  // 19. klaim via dana (tanpa MDR) -> nominal termasuk denda
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId: loan2, schedIdx: 0, payMethod: 'dana' } });
  ok(r.json.ok && r.json.claim.lateFee === 15550 && r.json.claim.amount === 326550, 'klaim termasuk denda');
  // 20. admin konfirmasi -> denda tercatat, statistik bertambah
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: r.json.claim.id, approve: true } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'pinjaman kedua lunas');
  ok(r.json.loan.schedule[0].lateFeePaid === 15550, 'denda tercatat lunas');
  r = await call('../api/me', { method: 'GET', headers: auth(tB) });
  ok(r.json.stats.payments === 5 && r.json.stats.loansLunas === 2 && r.json.stats.totalPinjam === 800000,
    'statistik terakumulasi: 5 bayar, 2 lunas, 800rb');
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  ok(r.json.ok && r.json.outstanding === 0, 'outstanding kembali 0');

  console.log(`\nSEMUA TES LOLOS (${n} asersi)`);
})().catch((e) => {
  console.error('\nTES GAGAL:', e.message);
  process.exit(1);
});
