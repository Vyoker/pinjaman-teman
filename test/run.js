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

  console.log('== Tes profil & bonus limit ==');
  const prof = require('../lib/profile');
  ok(prof.validateField('noNIK', '1234567890123456').ok, 'NIK 16 digit valid');
  ok(!prof.validateField('noNIK', '123').ok, 'NIK pendek ditolak');
  ok(!prof.validateField('noKK', 'abcdefghijklmnop').ok, 'KK non-digit ditolak');
  ok(!prof.validateField('usia', '16').ok, 'usia <17 ditolak');
  ok(prof.validateField('usia', '25').value === 25, 'usia 25 valid');
  ok(!prof.validateField('jenisKelamin', 'X').ok, 'gender invalid ditolak');
  ok(prof.validateField('jenisKelamin', 'Perempuan').ok, 'gender valid');
  ok(!prof.validateField('tanggalLahir', '2030-01-01').ok, 'tgl lahir masa depan ditolak');
  ok(prof.validateField('tanggalLahir', '1995-05-20').ok, 'tgl lahir valid');
  ok(!prof.validateField('ngawur', 'x').ok, 'field unknown ditolak');
  ok(!prof.validateField('fotoKTP', 'bukan-data-url').ok, 'foto invalid ditolak');
  ok(prof.validateField('fotoKTP', 'data:image/jpeg;base64,AAAA').ok, 'foto dataURL valid');
  const p0 = prof.emptyProfile();
  p0.namaLengkap.status = 'disetujui';
  p0.fotoKTP.status = 'disetujui';
  p0.noNIK.status = 'menunggu';
  ok(prof.limitBonus(p0) === 12500, 'bonus 2500+10000 = 12.500');
  ok(prof.maxBonus() === 45000, 'maks bonus 45.000');
  ok(prof.effectiveLimit({ limit: 100000, profile: p0 }) === 112500, 'limit efektif 112.500');
  ok(prof.countPending(p0) === 1, 'satu field menunggu');

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

  console.log('== Tes e2e profil & limit ==');
  r = await call('../api/auth-register', { method: 'POST', body: { name: 'Siti', phone: '081900000002', password: 'siti1234' } });
  assert.ok(r.json.ok, 'registrasi Siti');
  const tS = (await call('../api/auth-login', { method: 'POST', body: { phone: '081900000002', password: 'siti1234' } })).json.token;
  assert.ok(!tS, 'Siti belum bisa login sebelum disetujui');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000002', approve: true, limit: 100000 } });
  assert.ok(r.json.ok, 'Siti disetujui limit 100rb');
  const tS2 = (await call('../api/auth-login', { method: 'POST', body: { phone: '081900000002', password: 'siti1234' } })).json.token;
  const authS = auth(tS2);
  // kirim namaLengkap -> menunggu, bonus belum aktif
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { field: 'namaLengkap', value: 'Siti Aminah' } });
  ok(r.json.ok && r.json.profile.namaLengkap.status === 'menunggu', 'namaLengkap menunggu verifikasi');
  ok(r.json.bonus === 0 && r.json.effectiveLimit === 100000, 'bonus 0 sebelum disetujui');
  // NIK invalid ditolak
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { field: 'noNIK', value: '123' } });
  ok(r.status === 400, 'NIK 15 digit ditolak');
  // admin setujui -> limit naik 2.500
  r = await call('../api/profile-verify', { method: 'POST', headers: auth(tA), body: { phone: '081900000002', field: 'namaLengkap', approve: true } });
  ok(r.json.ok && r.json.status === 'disetujui' && r.json.effectiveLimit === 102500, 'approve -> limit efektif 102.500');
  r = await call('../api/profile-verify', { method: 'POST', headers: auth(tA), body: { phone: '081900000002', field: 'namaLengkap', approve: true } });
  ok(r.status === 400, 'verifikasi ganda ditolak');
  // peminjam tidak boleh verifikasi
  r = await call('../api/profile-verify', { method: 'POST', headers: authS, body: { phone: '081900000002', field: 'usia', approve: true } });
  ok(r.status === 403, 'peminjam ditolak akses verifikasi');
  // foto KTP -> admin tolak
  const fakePhoto = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { field: 'fotoKTP', value: fakePhoto } });
  ok(r.json.ok && r.json.profile.fotoKTP.status === 'menunggu', 'foto KTP menunggu');
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  ok(r.json.pendingVerifikasi === 1, 'satu data menunggu verifikasi');
  r = await call('../api/profile-verify', { method: 'POST', headers: auth(tA), body: { phone: '081900000002', field: 'fotoKTP', approve: false } });
  ok(r.json.ok && r.json.status === 'ditolak' && r.json.effectiveLimit === 102500, 'tolak -> limit tetap 102.500');
  // me tampilkan bonus & efektif
  r = await call('../api/me', { method: 'GET', headers: authS });
  ok(r.json.bonusLimit === 2500 && r.json.effectiveLimit === 102500, 'me: bonus 2.500, efektif 102.500');
  // pengajuan di atas efektif ditolak, di bawah efektif lolos
  r = await call('../api/loans', { method: 'POST', headers: authS, body: { pokok: 103000, tenorHari: 15, metode: 'lunas' } });
  ok(!r.json.ok && /limit/i.test(r.json.error), 'pengajuan 103rb ditolak (di atas 102.500)');
  r = await call('../api/loans', { method: 'POST', headers: authS, body: { pokok: 102000, tenorHari: 15, metode: 'lunas' } });
  ok(r.json.ok, 'pengajuan 102rb lolos berkat bonus limit');

  console.log('== Tes e2e cancel & hapus akun ==');
  r = await call('../api/loans', { method: 'GET', headers: authS });
  const loanS = r.json.loans.find((l) => l.status === 'diajukan').id;
  r = await call('../api/loan-decide', { method: 'POST', headers: auth(tA), body: { loanId: loanS, approve: true, tenorHari: 15 } });
  assert.ok(r.json.ok, 'pinjaman Siti disetujui');
  r = await call('../api/loan-cancel', { method: 'POST', headers: authS, body: { loanId: loanS } });
  ok(r.status === 403, 'peminjam ditolak cancel');
  r = await call('../api/loan-cancel', { method: 'POST', headers: auth(tA), body: { loanId: 'L999' } });
  ok(r.status === 404, 'cancel pinjaman tidak ada -> 404');
  r = await call('../api/loan-cancel', { method: 'POST', headers: auth(tA), body: { loanId: loanS } });
  ok(r.json.ok && r.json.loan.status === 'dibatalkan', 'pinjaman dibatalkan');
  r = await call('../api/me', { method: 'GET', headers: authS });
  ok(r.json.stats.totalPinjam === 0, 'totalPinjam dikoreksi ke 0');
  r = await call('../api/loan-cancel', { method: 'POST', headers: auth(tA), body: { loanId: loanS } });
  ok(r.status === 400, 'cancel pinjaman dibatalkan ditolak');
  // cancel terhalang pembayaran: Budi cicilan 2x, bayar 1x
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 200000, tenorHari: 15, metode: 'cicilan' } });
  assert.ok(r.json.ok, 'pengajuan cicilan Budi');
  const loanB = r.json.loan.id;
  r = await call('../api/loan-decide', { method: 'POST', headers: auth(tA), body: { loanId: loanB, approve: true, tenorHari: 15 } });
  assert.ok(r.json.ok, 'pinjaman Budi disetujui');
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId: loanB, schedIdx: 0, payMethod: 'dana' } });
  const cB = r.json.claim.id;
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: cB, approve: true } });
  assert.ok(r.json.ok, 'cicilan-1 Budi diterima');
  r = await call('../api/loan-cancel', { method: 'POST', headers: auth(tA), body: { loanId: loanB } });
  ok(r.status === 400, 'cancel pinjaman yang sudah dibayar sebagian ditolak');
  // hapus akun
  r = await call('../api/user-delete', { method: 'POST', headers: auth(tA), body: { phone: '08123456789' } });
  ok(r.status === 400, 'hapus akun dengan pinjaman aktif ditolak');
  r = await call('../api/user-delete', { method: 'POST', headers: authS, body: { phone: '08123456789' } });
  ok(r.status === 403, 'peminjam ditolak hapus akun');
  r = await call('../api/user-delete', { method: 'POST', headers: auth(tA), body: { phone: '081900000002' } });
  ok(r.json.ok && r.json.phone === '081900000002', 'akun Siti dihapus');
  r = await call('../api/me', { method: 'GET', headers: authS });
  ok(r.status === 401, 'sesi akun terhapus -> 401');
  r = await call('../api/user-delete', { method: 'POST', headers: auth(tA), body: { phone: '081900000002' } });
  ok(r.status === 404, 'hapus akun tidak ada -> 404');

  console.log(`\nSEMUA TES LOLOS (${n} asersi)`);
})().catch((e) => {
  console.error('\nTES GAGAL:', e.message);
  process.exit(1);
});
