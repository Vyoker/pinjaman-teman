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
  const handler = require(handlerPath.split('?')[0]); // query string hanya untuk req.url
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
  const PROOF = 'data:image/jpeg;base64,' + 'A'.repeat(2000); // bukti dummy untuk tes v1.6+
  console.log('== Tes kalkulasi ==');
  const a = calc.calcLoan(500000, 30, 'lunas');
  ok(a.total === 534500, 'contoh user: 500rb/30hr/lunas = 534.500 (dapat ' + a.total + ')');
  ok(a.bunga === 30000 && a.biayaLayanan === 2000 && a.biayaPencairan === 2500, 'bunga 30.000 + biaya layanan 2.000 + biaya pencairan 2.500');
  ok(a.nCicilan === 1, 'lunas = 1 tagihan');

  const b = calc.calcLoan(500000, 30, 'cicilan');
  ok(b.nCicilan === 4, '30 hari -> 4 cicilan');
  ok(b.schedule.reduce((s, x) => s + x.amount, 0) === 534500, 'cicilan genap 4x133.625 = 534.500');
  ok(JSON.stringify(b.schedule.map((x) => x.dueInDays)) === '[8,15,23,30]', 'jatuh tempo tiap ~7-8 hari');

  const c = calc.calcLoan(500000, 15, 'cicilan');
  ok(c.nCicilan === 2, '15 hari -> 2 cicilan');
  ok(c.total === 519500, 'total 15 hari = 519.500');

  const d = calc.calcLoan(1000001, 30, 'cicilan');
  ok(d.schedule.reduce((s, x) => s + x.amount, 0) === d.total, 'sisa pembulatan masuk angsuran terakhir');

  ok(calc.amountWithMethod(534500, 'qris') === 539845, 'QRIS +1% MDR = 539.845');
  ok(calc.amountWithMethod(534500, 'dana') === 534500, 'Dana tanpa tambahan');
  assert.throws(() => calc.calcLoan(500000, 0, 'lunas'), /Tenor/, 'tenor 0 ditolak');
  assert.throws(() => calc.calcLoan(500000, 61, 'lunas'), /Tenor/, 'tenor >60 ditolak');
  console.log('  ok - validasi tenor');

  console.log('== Tes denda & rank ==');
  const lf = calc.calcLateFee(133000, '2026-10-01', '2026-10-06');
  ok(lf.daysLate === 5 && lf.lateFee === 6650, 'denda 1%/hari x 5 hari = 6.650');
  const lf0 = calc.calcLateFee(133000, '2026-10-06', '2026-10-06');
  ok(lf0.daysLate === 0 && lf0.lateFee === 0, 'belum jatuh tempo = tanpa denda');
  const lfEarly = calc.calcLateFee(133000, '2026-10-10', '2026-10-06');
  ok(lfEarly.daysLate === 0 && lfEarly.lateFee === 0, 'bayar lebih awal = tanpa denda');
  ok(calc.rankFor(0).current === null && calc.rankFor(0).next.name === 'Bronze', 'rank 0 pelunasan');
  ok(calc.rankFor(4).current === null && calc.rankFor(4).next.name === 'Bronze', 'rank 4 = belum ada rank');
  ok(calc.rankFor(5).current.name === 'Bronze' && calc.rankFor(5).next.name === 'Silver', 'rank 5 = Bronze, next Silver');
  ok(calc.rankFor(10).current.name === 'Silver' && calc.rankFor(10).next.name === 'Gold', 'rank 10 = Silver, next Gold');
  ok(calc.rankFor(15).current.name === 'Gold' && calc.rankFor(15).next.name === 'Platinum', 'rank 15 = Gold, next Platinum');
  ok(calc.rankFor(20).current.name === 'Platinum' && calc.rankFor(20).next.name === 'Diamond', 'rank 20 = Platinum, next Diamond');
  ok(calc.rankFor(25).current.name === 'Diamond' && calc.rankFor(25).next.name === 'KING', 'rank 25 = Diamond, next KING');
  ok(calc.rankFor(30).current.name === 'KING' && calc.rankFor(30).next === null, 'rank 30 = KING (max)');
  ok(calc.rankBonusFor(5) === 10000 && calc.rankBonusFor(10) === 15000 && calc.rankBonusFor(15) === 20000 && calc.rankBonusFor(20) === 25000 && calc.rankBonusFor(25) === 50000 && calc.rankBonusFor(30) === 100000, 'bonus rank v2.6');

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
  let r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Budi', phone: '08123456789', password: 'budi1234' } });
  ok(r.json.ok, 'registrasi Budi');
  // 2. login sebelum disetujui -> 403
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '08123456789', password: 'budi1234' } });
  ok(r.status === 403, 'login pending ditolak (403)');
  // 3. login admin
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '0811000000', password: 'admin-kuat-123' } });
  ok(r.json.ok && r.json.role === 'admin', 'login admin');
  ok(r.json.storage === 'memory', 'login info mode penyimpanan (memory saat tes)');
  const tA = r.json.token;
  // 4. admin setujui + limit
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '08123456789', approve: true, limit: 1000000 } });
  ok(r.json.ok, 'admin setujui Budi, limit 1jt');
  // 5. login Budi
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '08123456789', password: 'budi1234' } });
  ok(r.json.ok && r.json.role === 'borrower', 'login Budi');
  const tB = r.json.token;
  // Budi isi data pencairan (wajib sebelum approve)
  r = await call('../api/profile', { method: 'POST', headers: auth(tB), body: { action: 'pencairan', metode: 'dana', nomor: '081299998888', atasNama: 'Budi Santoso' } });
  assert.ok(r.json.ok, 'Budi isi data pencairan');
  // 6. simulasi melebihi limit
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { action: 'simulate', pokok: 2000000 } });
  ok(r.json.lebihDariLimit === true, 'simulasi tandai melebihi limit');
  // 7. ajukan
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 500000 } });
  ok(r.json.ok && r.json.loan.status === 'diajukan', 'pengajuan pinjaman');
  const loanId = r.json.loan.id;
  // 8. ajukan lagi saat masih aktif -> tolak
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 100000 } });
  ok(!r.json.ok, 'pengajuan ganda ditolak');
  // 9. admin setujui (tutup buku: jatuh tempo tanggal 1 bulan depan)
  const daysB = calc.daysToNextFirst(new Date());
  const expTotalB = calc.calcLoan(500000, daysB, 'lunas').total;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId, approve: true } });
  ok(r.json.ok && r.json.loan.status === 'berjalan', 'pinjaman disetujui -> berjalan');
  ok(r.json.loan.schedule.length === 1, 'jadwal 1 tagihan (tutup buku)');
  ok(r.json.loan.total === expTotalB, 'total sesuai hari sampai tanggal 1 (dapat ' + r.json.loan.total + ')');
  ok(r.json.loan.tenorHari === daysB && r.json.loan.schedule[0].dueDate === calc.localDateStr(calc.nextFirstDate(new Date())), 'jatuh tempo tanggal 1 bulan depan');
  // 10. bayar tagihan via QRIS
  const expQrisB = calc.amountWithMethod(expTotalB, 'qris');
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId, schedIdx: 0, payMethod: 'qris', proof: PROOF } });
  ok(r.json.ok && r.json.claim.amount === expQrisB, 'klaim QRIS = total +1% (dapat ' + (r.json.claim && r.json.claim.amount) + ')');
  const claimId = r.json.claim.id;
  // 11. klaim ganda item sama -> tolak
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId, schedIdx: 0, payMethod: 'dana' } });
  ok(!r.json.ok, 'klaim ganda ditolak');
  // 12. admin konfirmasi terima
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId, approve: true } });
  ok(r.json.ok && r.json.claim.status === 'diterima', 'klaim diterima');
  ok(r.json.loan.schedule[0].status === 'lunas', 'tagihan lunas');
  r = await call('../api/loans', { method: 'GET', headers: auth(tB) });
  ok(r.json.loans[0].status === 'lunas', 'pinjaman lunas setelah tagihan dibayar');
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
  ok(r.json.stats.payments === 1 && r.json.stats.loansLunas === 1 && r.json.stats.totalPinjam === 500000,
    'statistik: 1 bayar, 1 lunas, total pinjam 500rb');
  ok(r.json.rank === null && r.json.nextRank.name === 'Bronze', 'v2.6: 1 pelunasan belum ada rank (Bronze butuh 5)');

  // 18. pinjaman kedua, jatuh tempo dimundurkan 5 hari -> kena denda
  // v2.3: cooldown 3 hari setelah pelunasan -> mundurkan lunasAt pinjaman pertama
  const l1 = await getJSON('loan:' + loanId);
  l1.lunasAt = new Date(Date.now() - 4 * 864e5).toISOString();
  await setJSON('loan:' + loanId, l1);
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 300000 } });
  assert.ok(r.json.ok, 'pengajuan kedua');
  const loan2 = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loan2, approve: true } });
  assert.ok(r.json.ok, 'pinjaman kedua disetujui');
  const tot2 = r.json.loan.total;
  assert.strictEqual(tot2, calc.calcLoan(300000, calc.daysToNextFirst(new Date()), 'lunas').total, 'total pinjaman kedua sesuai hari tutup buku');
  const l2 = await getJSON('loan:' + loan2);
  l2.schedule[0].dueDate = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  await setJSON('loan:' + loan2, l2);
  r = await call('../api/loans', { method: 'GET', headers: auth(tB) });
  const expFee2 = Math.round(tot2 * 0.01 * 5);
  const it2 = r.json.loans[0].schedule[0];
  ok(it2.daysLate === 5 && it2.lateFee === expFee2 && it2.totalDue === tot2 + expFee2,
    'denda tampil: 5 hari x 1% x total');
  // 19. klaim via dana (tanpa MDR) -> nominal termasuk denda
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId: loan2, schedIdx: 0, payMethod: 'dana', proof: PROOF } });
  ok(r.json.ok && r.json.claim.lateFee === expFee2 && r.json.claim.amount === tot2 + expFee2, 'klaim termasuk denda');
  // 20. admin konfirmasi -> denda tercatat, statistik bertambah
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: r.json.claim.id, approve: true } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'pinjaman kedua lunas');
  ok(r.json.loan.schedule[0].lateFeePaid === expFee2, 'denda tercatat lunas');
  r = await call('../api/me', { method: 'GET', headers: auth(tB) });
  ok(r.json.stats.payments === 2 && r.json.stats.loansLunas === 2 && r.json.stats.totalPinjam === 800000,
    'statistik terakumulasi: 2 bayar, 2 lunas, 800rb');
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  ok(r.json.ok && r.json.outstanding === 0, 'outstanding kembali 0');

  console.log('== Tes e2e profil & limit ==');
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Siti', phone: '081900000002', password: 'siti1234' } });
  assert.ok(r.json.ok, 'registrasi Siti');
  const tS = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000002', password: 'siti1234' } })).json.token;
  assert.ok(!tS, 'Siti belum bisa login sebelum disetujui');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000002', approve: true, limit: 100000 } });
  assert.ok(r.json.ok, 'Siti disetujui limit 100rb');
  const tS2 = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000002', password: 'siti1234' } })).json.token;
  const authS = auth(tS2);
  // Siti isi data pencairan juga
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { action: 'pencairan', metode: 'bank', nomor: '1234567890', atasNama: 'Siti Aminah', namaBank: 'BCA' } });
  assert.ok(r.json.ok, 'Siti isi data pencairan');
  // kirim namaLengkap -> menunggu, bonus belum aktif
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { field: 'namaLengkap', value: 'Siti Aminah' } });
  ok(r.json.ok && r.json.profile.namaLengkap.status === 'menunggu', 'namaLengkap menunggu verifikasi');
  ok(r.json.bonus === 0 && r.json.effectiveLimit === 100000, 'bonus 0 sebelum disetujui');
  // NIK invalid ditolak
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { field: 'noNIK', value: '123' } });
  ok(r.status === 400, 'NIK 15 digit ditolak');
  // admin setujui -> limit naik 2.500
  r = await call('../api/profile', { method: 'POST', headers: auth(tA), body: { action: 'verify', phone: '081900000002', field: 'namaLengkap', approve: true } });
  ok(r.json.ok && r.json.status === 'disetujui' && r.json.effectiveLimit === 102500, 'approve -> limit efektif 102.500');
  r = await call('../api/profile', { method: 'POST', headers: auth(tA), body: { action: 'verify', phone: '081900000002', field: 'namaLengkap', approve: true } });
  ok(r.status === 400, 'verifikasi ganda ditolak');
  // peminjam tidak boleh verifikasi
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { action: 'verify', phone: '081900000002', field: 'usia', approve: true } });
  ok(r.status === 403, 'peminjam ditolak akses verifikasi');
  // foto KTP -> admin tolak
  const fakePhoto = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  r = await call('../api/profile', { method: 'POST', headers: authS, body: { field: 'fotoKTP', value: fakePhoto } });
  ok(r.json.ok && r.json.profile.fotoKTP.status === 'menunggu', 'foto KTP menunggu');
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  ok(r.json.pendingVerifikasi === 1, 'satu data menunggu verifikasi');
  r = await call('../api/profile', { method: 'POST', headers: auth(tA), body: { action: 'verify', phone: '081900000002', field: 'fotoKTP', approve: false } });
  ok(r.json.ok && r.json.status === 'ditolak' && r.json.effectiveLimit === 102500, 'tolak -> limit tetap 102.500');
  // me tampilkan bonus & efektif
  r = await call('../api/me', { method: 'GET', headers: authS });
  ok(r.json.bonusLimit === 2500 && r.json.effectiveLimit === 102500, 'me: bonus 2.500, efektif 102.500');
  // pengajuan di atas efektif ditolak, di bawah efektif lolos
  r = await call('../api/loans', { method: 'POST', headers: authS, body: { pokok: 103000 } });
  ok(!r.json.ok && /limit/i.test(r.json.error), 'pengajuan 103rb ditolak (di atas 102.500)');
  r = await call('../api/loans', { method: 'POST', headers: authS, body: { pokok: 102000 } });
  ok(r.json.ok, 'pengajuan 102rb lolos berkat bonus limit');

  console.log('== Tes e2e cancel & hapus akun ==');
  r = await call('../api/loans', { method: 'GET', headers: authS });
  const loanS = r.json.loans.find((l) => l.status === 'diajukan').id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanS, approve: true } });
  assert.ok(r.json.ok, 'pinjaman Siti disetujui');
  r = await call('../api/loan-action', { method: 'POST', headers: authS, body: { action: 'cancel', loanId: loanS } });
  ok(r.status === 403, 'peminjam ditolak cancel');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'cancel', loanId: 'L999' } });
  ok(r.status === 404, 'cancel pinjaman tidak ada -> 404');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'cancel', loanId: loanS } });
  ok(r.json.ok && r.json.loan.status === 'dibatalkan', 'pinjaman dibatalkan');
  r = await call('../api/me', { method: 'GET', headers: authS });
  ok(r.json.stats.totalPinjam === 0, 'totalPinjam dikoreksi ke 0');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'cancel', loanId: loanS } });
  ok(r.status === 400, 'cancel pinjaman dibatalkan ditolak');
  // cancel terhalang pembayaran: Budi sudah membayar tagihannya
  // v2.3: mundurkan lunasAt pinjaman kedua agar lewat cooldown
  const l2b = await getJSON('loan:' + loan2);
  l2b.lunasAt = new Date(Date.now() - 4 * 864e5).toISOString();
  await setJSON('loan:' + loan2, l2b);
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 200000 } });
  assert.ok(r.json.ok, 'pengajuan Budi');
  const loanB = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanB, approve: true } });
  assert.ok(r.json.ok, 'pinjaman Budi disetujui');
  r = await call('../api/payments', { method: 'POST', headers: auth(tB), body: { action: 'claim', loanId: loanB, schedIdx: 0, payMethod: 'dana', proof: PROOF } });
  const cB = r.json.claim.id;
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: cB, approve: true } });
  assert.ok(r.json.ok, 'tagihan Budi diterima');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'cancel', loanId: loanB } });
  ok(r.status === 400, 'cancel pinjaman yang sudah dibayar sebagian ditolak');
  // hapus akun: Budi perlu pinjaman aktif (pinjaman sebelumnya sudah lunas penuh)
  const lBb = await getJSON('loan:' + loanB);
  lBb.lunasAt = new Date(Date.now() - 4 * 864e5).toISOString();
  await setJSON('loan:' + loanB, lBb);
  r = await call('../api/loans', { method: 'POST', headers: auth(tB), body: { pokok: 100000 } });
  assert.ok(r.json.ok, 'pengajuan Budi baru');
  const loanB2 = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanB2, approve: true } });
  assert.ok(r.json.ok, 'pinjaman Budi baru disetujui');
  // hapus akun
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'delete', phone: '08123456789' } });
  ok(r.status === 400, 'hapus akun dengan pinjaman aktif ditolak');
  r = await call('../api/borrowers', { method: 'POST', headers: authS, body: { action: 'delete', phone: '08123456789' } });
  ok(r.status === 403, 'peminjam ditolak hapus akun');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'delete', phone: '081900000002' } });
  ok(r.json.ok && r.json.phone === '081900000002', 'akun Siti dihapus');
  r = await call('../api/me', { method: 'GET', headers: authS });
  ok(r.status === 401, 'sesi akun terhapus -> 401');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'delete', phone: '081900000002' } });
  ok(r.status === 404, 'hapus akun tidak ada -> 404');

  console.log('== Tes e2e pencairan wajib & broadcast ==');
  // validasi pencairan
  r = await call('../api/profile', { method: 'POST', headers: auth(tB), body: { action: 'pencairan', metode: 'ovo', nomor: '081234567890', atasNama: 'Budi' } });
  ok(r.status === 400, 'metode pencairan invalid ditolak');
  r = await call('../api/profile', { method: 'POST', headers: auth(tB), body: { action: 'pencairan', metode: 'bank', nomor: '1234567890', atasNama: 'Budi' } });
  ok(r.status === 400, 'bank tanpa nama bank ditolak');
  r = await call('../api/profile', { method: 'POST', headers: auth(tB), body: { action: 'pencairan', metode: 'dana', nomor: '123', atasNama: 'Budi' } });
  ok(r.status === 400, 'nomor terlalu pendek ditolak');
  // user baru Dodi: approve pinjaman terhalang tanpa pencairan
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Dodi', phone: '081900000003', password: 'dodi1234' } });
  assert.ok(r.json.ok, 'registrasi Dodi');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000003', approve: true, limit: 500000 } });
  assert.ok(r.json.ok, 'Dodi disetujui');
  const tD = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000003', password: 'dodi1234' } })).json.token;
  const authD = auth(tD);
  r = await call('../api/loans', { method: 'POST', headers: authD, body: { pokok: 100000 } });
  assert.ok(r.json.ok, 'pengajuan Dodi');
  const loanD = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanD, approve: true } });
  ok(r.status === 400 && /pencairan/i.test(r.json.error), 'approve terhalang: pencairan kosong');
  r = await call('../api/profile', { method: 'POST', headers: authD, body: { action: 'pencairan', metode: 'dana', nomor: '081377776666', atasNama: 'Dodi' } });
  ok(r.json.ok && r.json.pencairan.metode === 'dana', 'Dodi simpan pencairan');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanD, approve: true } });
  ok(r.json.ok && r.json.loan.status === 'berjalan', 'approve lolos setelah pencairan terisi');
  // broadcast: validasi
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { mode: 'all', message: '' } });
  ok(r.status === 400, 'broadcast tanpa pesan ditolak');
  r = await call('../api/notifications', { method: 'POST', headers: auth(tB), body: { mode: 'all', message: 'Halo' } });
  ok(r.status === 403, 'peminjam ditolak broadcast');
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { mode: 'selected', phones: [], message: 'Halo' } });
  ok(r.status === 400, 'broadcast selected tanpa user ditolak');
  // broadcast semua
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { mode: 'all', message: 'Info: aplikasi diperbarui ke v1.4.' } });
  ok(r.json.ok && r.json.sent === 1, 'broadcast all terkirim');
  r = await call('../api/notifications', { method: 'GET', headers: auth(tB) });
  ok(r.json.unread === 1 && r.json.notifications.length === 1, 'Budi terima 1 notifikasi');
  // broadcast khusus Budi
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { mode: 'selected', phones: ['08123456789'], message: 'Pengingat khusus Budi.' } });
  ok(r.json.ok && r.json.sent === 1, 'broadcast selected terkirim');
  r = await call('../api/notifications', { method: 'GET', headers: auth(tB) });
  ok(r.json.unread === 2, 'Budi punya 2 belum dibaca');
  r = await call('../api/notifications', { method: 'GET', headers: authD });
  ok(r.json.notifications.length === 1 && r.json.unread === 1, 'Dodi hanya terima broadcast all');
  // tandai dibaca
  r = await call('../api/notifications', { method: 'POST', headers: auth(tB), body: { action: 'readAll' } });
  assert.ok(r.json.ok, 'readAll Budi');
  r = await call('../api/notifications', { method: 'GET', headers: auth(tB) });
  ok(r.json.unread === 0, 'semua notifikasi Budi terbaca');
  // riwayat broadcast
  r = await call('../api/notifications', { method: 'GET', headers: auth(tA) });
  ok(r.json.ok && r.json.history.length === 2, 'riwayat broadcast 2 entri');

  console.log('== Tes e2e hapus akun mandiri ==');
  // Dodi masih punya pinjaman berjalan -> hapus ditolak
  r = await call('../api/account-delete', { method: 'POST', headers: authD, body: { password: 'dodi1234' } });
  ok(r.status === 400 && /tagihan berjalan/i.test(r.json.error), 'hapus akun terhalang tagihan berjalan');
  // admin tidak memakai endpoint ini
  r = await call('../api/account-delete', { method: 'POST', headers: auth(tA), body: { password: 'x' } });
  ok(r.status === 403, 'admin ditolak di hapus akun mandiri');
  // lunasi pinjaman Dodi dulu
  r = await call('../api/payments', { method: 'POST', headers: authD, body: { action: 'claim', loanId: loanD, schedIdx: 0, payMethod: 'dana', proof: PROOF } });
  const cD = r.json.claim.id;
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: cD, approve: true } });
  assert.ok(r.json.ok && r.json.loan.status === 'lunas', 'pinjaman Dodi lunas');
  // password salah -> 401
  r = await call('../api/account-delete', { method: 'POST', headers: authD, body: { password: 'salah' } });
  ok(r.status === 401, 'hapus akun password salah -> 401');
  // password benar -> terhapus, sesi hangus
  r = await call('../api/account-delete', { method: 'POST', headers: authD, body: { password: 'dodi1234' } });
  ok(r.json.ok, 'akun Dodi terhapus mandiri');
  r = await call('../api/me', { method: 'GET', headers: authD });
  ok(r.status === 401, 'sesi Dodi hangus setelah hapus akun');

  console.log('== Tes e2e bukti transfer wajib (v1.6) ==');
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Eko', phone: '081900000004', password: 'eko12345' } });
  assert.ok(r.json.ok, 'registrasi Eko');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000004', approve: true, limit: 500000 } });
  assert.ok(r.json.ok, 'Eko disetujui limit 500rb');
  const tE = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000004', password: 'eko12345' } })).json.token;
  const authE = auth(tE);
  r = await call('../api/profile', { method: 'POST', headers: authE, body: { action: 'pencairan', metode: 'dana', nomor: '081388887777', atasNama: 'Eko Prasetyo' } });
  assert.ok(r.json.ok, 'Eko isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: authE, body: { pokok: 200000 } });
  assert.ok(r.json.ok, 'pengajuan Eko');
  const loanE = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanE, approve: true } });
  assert.ok(r.json.ok, 'pinjaman Eko disetujui');
  // tanpa proof -> 400
  r = await call('../api/payments', { method: 'POST', headers: authE, body: { action: 'claim', loanId: loanE, schedIdx: 0, payMethod: 'dana' } });
  ok(r.status === 400 && /bukti/i.test(r.json.error), 'klaim tanpa bukti ditolak (400)');
  // proof bukan dataURL gambar -> 400
  r = await call('../api/payments', { method: 'POST', headers: authE, body: { action: 'claim', loanId: loanE, schedIdx: 0, payMethod: 'dana', proof: 'bukan-gambar' } });
  ok(r.status === 400, 'klaim bukti invalid ditolak');
  // proof valid -> ok & tersimpan
  r = await call('../api/payments', { method: 'POST', headers: authE, body: { action: 'claim', loanId: loanE, schedIdx: 0, payMethod: 'dana', proof: PROOF } });
  ok(r.json.ok && r.json.claim.proof === PROOF, 'klaim dengan bukti diterima & tersimpan');
  const claimE = r.json.claim.id;
  r = await call('../api/payments?status=menunggu', { method: 'GET', headers: auth(tA) });
  ok(r.json.claims.some((c) => c.id === claimE && c.proof === PROOF), 'admin melihat bukti di daftar klaim menunggu');
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: claimE, approve: true } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'klaim berbukti dikonfirmasi -> lunas');

  console.log('== Tes e2e pengingat jatuh tempo (v1.6) ==');
  // v2.3: mundurkan lunasAt agar lewat cooldown
  const lEb = await getJSON('loan:' + loanE);
  lEb.lunasAt = new Date(Date.now() - 4 * 864e5).toISOString();
  await setJSON('loan:' + loanE, lEb);
  r = await call('../api/loans', { method: 'POST', headers: authE, body: { pokok: 400000 } });
  assert.ok(r.json.ok, 'pengajuan Eko kedua');
  const loanE2 = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanE2, approve: true } });
  assert.ok(r.json.ok, 'pinjaman Eko kedua disetujui');
  // geser jatuh tempo 30 hari ke depan -> belum perlu diingatkan
  const lE2a = await getJSON('loan:' + loanE2);
  lE2a.schedule[0].dueDate = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  await setJSON('loan:' + loanE2, lE2a);
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { action: 'remind', loanId: loanE2, schedIdx: 0 } });
  ok(r.status === 400 && /belum perlu/i.test(r.json.error), 'remind item jauh hari ditolak');
  // peminjam tidak boleh remind
  r = await call('../api/notifications', { method: 'POST', headers: authE, body: { action: 'remind', loanId: loanE2, schedIdx: 0 } });
  ok(r.status === 403, 'peminjam ditolak remind (403)');
  // mundurkan dueDate item 0 -> telat 2 hari
  const lE2 = await getJSON('loan:' + loanE2);
  lE2.schedule[0].dueDate = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  await setJSON('loan:' + loanE2, lE2);
  const unreadBefore = (await call('../api/notifications', { method: 'GET', headers: authE })).json.unread;
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { action: 'remind', loanId: loanE2, schedIdx: 0 } });
  ok(r.json.ok && r.json.sent === 1 && /TELAT 2 hari/.test(r.json.message), 'remind tagihan telat terkirim');
  r = await call('../api/notifications', { method: 'GET', headers: authE });
  ok(r.json.unread === unreadBefore + 1, 'Eko terima notifikasi pengingat');
  ok(r.json.notifications.some((x) => /TELAT 2 hari/.test(x.message)), 'isi notifikasi pengingat menyebut telat 2 hari');
  // remind ganda dalam 24 jam -> tolak
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { action: 'remind', loanId: loanE2, schedIdx: 0 } });
  ok(r.status === 400 && /sudah diingatkan/i.test(r.json.error), 'remind ganda <24 jam ditolak');
  // remind item lunas -> tolak
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { action: 'remind', loanId: loanE, schedIdx: 0 } });
  ok(r.status === 400, 'remind pinjaman lunas ditolak');
  // admin-stats memuat schedIdx & remindedAt untuk tombol Ingatkan
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  const lateRow = r.json.late.find((x) => x.loanId === loanE2 && x.schedIdx === 0);
  ok(lateRow && lateRow.remindedAt, 'admin-stats: baris telat memuat schedIdx & remindedAt');

  // ============ v1.8: manfaat rank (bonus limit + unlock tenor) ============
  // Fajar: Platinum (8 pelunasan)
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Fajar', phone: '081900000005', password: 'fajar123' } });
  ok(r.json.ok, 'registrasi Fajar');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000005', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Fajar, limit 500rb');
  const tF = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000005', password: 'fajar123' } })).json.token;
  const uF = await getJSON('user:081900000005');
  uF.stats = { payments: 45, loansLunas: 8, totalPinjam: 2000000 };
  await setJSON('user:081900000005', uF);
  // me: bonus rank Platinum (unlock tenor sudah tidak berlaku di v2.5)
  r = await call('../api/me', { method: 'GET', headers: auth(tF) });
  ok(r.json.rankBonus === 10000, 'v2.6: 8 lunas -> Bronze, rankBonus 10000');
  ok(r.json.effectiveLimit === 510000, 'effectiveLimit = 500rb + 10rb bonus rank');
  ok(r.json.rank && r.json.rank.name === 'Bronze', 'rank Bronze terdeteksi (rombak retroaktif)');
  // v2.9: minimal pengajuan Rp10.000 (frontend input + backend)
  r = await call('../api/loans', { method: 'POST', headers: auth(tF), body: { action: 'simulate', pokok: 5000 } });
  ok(r.status === 400 && /10\.000/.test(r.json.error), 'simulate: pokok 5000 ditolak (min 10rb)');
  r = await call('../api/loans', { method: 'POST', headers: auth(tF), body: { action: 'simulate', pokok: 10000 } });
  ok(r.json.ok, 'simulate: pokok 10000 diterima (batas min)');
  r = await call('../api/loans', { method: 'POST', headers: auth(tF), body: { pokok: 5000 } });
  ok(r.status === 400 && /10\.000/.test(r.json.error), 'pengajuan 5000 ditolak (min 10rb)');
  // apply: pokok di atas limit+bonus rank ditolak
  r = await call('../api/loans', { method: 'POST', headers: auth(tF), body: { pokok: 511000 } });
  ok(r.status === 400 && /limit/i.test(r.json.error), 'pokok 511rb > 510rb ditolak');
  r = await call('../api/loans', { method: 'POST', headers: auth(tF), body: { pokok: 510000 } });
  ok(r.json.ok && r.json.loan.tutupBuku === true && r.json.loan.metode === 'lunas', 'pengajuan Fajar diterima (tutup buku)');
  const loanF = r.json.loan.id;
  // simulate tutup buku: total sesuai hari sampai tanggal 1
  const daysF = calc.daysToNextFirst(new Date());
  const totF = calc.calcLoan(510000, daysF, 'lunas').total;
  r = await call('../api/loans', { method: 'POST', headers: auth(tF), body: { action: 'simulate', pokok: 510000 } });
  ok(r.json.ok && r.json.days === daysF && r.json.total === totF && r.json.dueDate === calc.localDateStr(calc.nextFirstDate(new Date())), 'simulate tutup buku: total sesuai hari');
  // admin approve (butuh pencairan dulu)
  r = await call('../api/profile', { method: 'POST', headers: auth(tF), body: { action: 'pencairan', metode: 'dana', nomor: '081511112222', atasNama: 'Fajar Nugroho' } });
  assert.ok(r.json.ok, 'Fajar isi data pencairan');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanF, approve: true } });
  ok(r.json.ok && r.json.loan.tenorHari === daysF && r.json.loan.total === totF, 'admin approve tutup buku: total sesuai simulate');
  // Gita: Diamond (12 pelunasan)
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Gita', phone: '081900000006', password: 'gita1234' } });
  ok(r.json.ok, 'registrasi Gita');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000006', approve: true, limit: 300000 } });
  ok(r.json.ok, 'admin setujui Gita, limit 300rb');
  const tG = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000006', password: 'gita1234' } })).json.token;
  const uG = await getJSON('user:081900000006');
  uG.stats = { payments: 55, loansLunas: 12, totalPinjam: 3000000 };
  await setJSON('user:081900000006', uG);
  r = await call('../api/me', { method: 'GET', headers: auth(tG) });
  ok(r.json.rankBonus === 15000 && r.json.rank.name === 'Silver', 'v2.6: 12 lunas -> Silver, bonus 15rb');
  ok(r.json.effectiveLimit === 315000, 'effectiveLimit Gita = 300rb + 15rb');
  r = await call('../api/loans', { method: 'POST', headers: auth(tG), body: { pokok: 315000 } });
  ok(r.json.ok, 'pengajuan Gita diterima (tutup buku)');
  // profile memuat rankBonus
  r = await call('../api/profile', { method: 'GET', headers: auth(tF) });
  ok(r.json.rankBonus === 10000 && r.json.effectiveLimit === 510000, 'profile: rankBonus & effectiveLimit sinkron');

  // ============ v1.9: tandai lunas manual (tunai ke admin) ============
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Hadi', phone: '081900000007', password: 'hadi1234' } });
  ok(r.json.ok, 'registrasi Hadi');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000007', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Hadi, limit 500rb');
  const tH = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000007', password: 'hadi1234' } })).json.token;
  r = await call('../api/profile', { method: 'POST', headers: auth(tH), body: { action: 'pencairan', metode: 'dana', nomor: '081522223333', atasNama: 'Hadi Wijaya' } });
  assert.ok(r.json.ok, 'Hadi isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tH), body: { pokok: 300000 } });
  ok(r.json.ok, 'Hadi ajukan pinjaman');
  const loanH = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanH, approve: true } });
  ok(r.json.ok && r.json.loan.schedule.length === 1, 'admin setujui: 1 tagihan tutup buku');
  const amt0 = r.json.loan.schedule[0].amount;
  // peminjam tidak bisa pakai manual-pay
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tH), body: { action: 'manual-pay', loanId: loanH, schedIdx: 0 } });
  ok(r.status === 403, 'peminjam ditolak manual-pay (403)');
  // manual-pay di pinjaman yang masih diajukan (punya Gita) ditolak
  const gitaLoan = (await call('../api/loans', { method: 'GET', headers: auth(tA), body: {} })).json.loans.find((x) => x.borrowerPhone === '081900000006');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: gitaLoan.id, schedIdx: 0 } });
  ok(r.status === 400 && /tidak aktif/i.test(r.json.error), 'manual-pay di pinjaman diajukan ditolak');
  // paidDate masa depan ditolak
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanH, schedIdx: 0, paidDate: tomorrow } });
  ok(r.status === 400 && /melebihi hari ini/i.test(r.json.error), 'paidDate masa depan ditolak');
  // notifikasi sebelum
  const unreadBeforeH = (await call('../api/notifications', { method: 'GET', headers: auth(tH) })).json.unread;
  // cicilan pertama: tunai tepat waktu (hari ini)
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanH, schedIdx: 0, note: 'bayar tunai ke admin' } });
  ok(r.json.ok, 'manual-pay tagihan diterima');
  const it0 = r.json.loan.schedule[0];
  ok(it0.status === 'lunas' && it0.payMethod === 'tunai' && it0.lateFeePaid === 0, 'item #1 lunas via tunai tanpa denda');
  ok(it0.manualNote === 'bayar tunai ke admin', 'catatan tersimpan');
  // item yang sama tidak bisa ditandai lagi
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanH, schedIdx: 0 } });
  ok(r.status === 400 && /tidak aktif/i.test(r.json.error), 'pinjaman lunas tidak bisa ditandai lagi');
  // pinjaman kedua Hadi: buat telat 3 hari lalu bayar tunai hari ini
  const lh0 = await getJSON('loan:' + loanH);
  lh0.lunasAt = new Date(Date.now() - 4 * 864e5).toISOString();
  await setJSON('loan:' + loanH, lh0);
  r = await call('../api/loans', { method: 'POST', headers: auth(tH), body: { pokok: 300000 } });
  assert.ok(r.json.ok, 'pengajuan kedua Hadi');
  const loanH2 = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanH2, approve: true } });
  assert.ok(r.json.ok, 'pinjaman kedua Hadi disetujui');
  const lh = await getJSON('loan:' + loanH2);
  const duePast = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  lh.schedule[0].dueDate = duePast;
  await setJSON('loan:' + loanH2, lh);
  const todayD = new Date().toISOString().slice(0, 10);
  const expFee = calc.calcLateFee(lh.schedule[0].amount, duePast, todayD).lateFee;
  ok(expFee > 0, 'skenario telat 3 hari punya denda');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanH2, schedIdx: 0, paidDate: todayD } });
  ok(r.json.ok, 'manual-pay tagihan telat diterima');
  const it1 = r.json.loan.schedule[0];
  ok(it1.status === 'lunas' && it1.lateFeePaid === expFee, `denda tunai telat = ${expFee}`);
  ok(r.json.loan.status === 'lunas', 'pinjaman kedua lunas setelah ditandai');
  // statistik & notifikasi
  const uH = await getJSON('user:081900000007');
  ok(uH.stats.payments === 2 && uH.stats.loansLunas === 2, 'stats.payments=2, loansLunas=2');
  const notifAfter = await call('../api/notifications', { method: 'GET', headers: auth(tH) });
  ok(notifAfter.json.unread === unreadBeforeH + 2, 'peminjam terima 2 notifikasi manual-pay');
  ok(notifAfter.json.notifications.some((x) => /tunai ke admin/i.test(x.message)), 'isi notifikasi menyebut tunai ke admin');

  // ============ v2.0: keamanan ============
  // password minimal 8 karakter
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Ira', phone: '081900000008', password: 'pendek7' } });
  ok(r.status === 400 && /8 karakter/i.test(r.json.error), 'register password 7 karakter ditolak');
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Ira', phone: '081900000008', password: 'ira12345' } });
  ok(r.json.ok, 'registrasi Ira (8 karakter)');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000008', approve: true, limit: 400000 } });
  ok(r.json.ok, 'admin setujui Ira');
  // rate limit login: 3x gagal -> kunci sampai besok
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'salah1' } });
  ok(r.status === 401 && /Sisa 2 percobaan/.test(r.json.error), 'gagal ke-1: sisa 2');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'salah2' } });
  ok(r.status === 401 && /Sisa 1 percobaan/.test(r.json.error), 'gagal ke-2: sisa 1');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'salah3' } });
  ok(r.status === 401 && /besok/i.test(r.json.error), 'gagal ke-3: kunci sampai besok');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'ira12345' } });
  ok(r.status === 429 && /besok/i.test(r.json.error), 'password benar pun ditolak saat terkunci');
  // simulasi hari berganti: kunci ter-reset
  await setJSON('rl:login:081900000008', { fails: 3, date: '2000-01-01' });
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'ira12345' } });
  ok(r.json.ok && r.json.role === 'borrower', 'login berhasil setelah hari berganti');
  const tI = r.json.token;
  // ganti password
  r = await call('../api/auth', { method: 'POST', headers: auth(tI), body: { action: 'change-password', oldPassword: 'keliru', newPassword: 'irabaru12' } });
  ok(r.status === 400 && /lama salah/i.test(r.json.error), 'ganti password: password lama salah ditolak');
  r = await call('../api/auth', { method: 'POST', headers: auth(tI), body: { action: 'change-password', oldPassword: 'ira12345', newPassword: 'pendek' } });
  ok(r.status === 400 && /8 karakter/i.test(r.json.error), 'ganti password: baru <8 ditolak');
  r = await call('../api/auth', { method: 'POST', headers: auth(tI), body: { action: 'change-password', oldPassword: 'ira12345', newPassword: 'irabaru12' } });
  ok(r.json.ok, 'ganti password berhasil');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'ira12345' } });
  ok(r.status === 401, 'password lama tidak bisa dipakai lagi');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000008', password: 'irabaru12' } });
  ok(r.json.ok, 'login dengan password baru berhasil');
  const tI2 = r.json.token;
  // rate limit register: 3x/jam per IP
  const iph = { 'x-forwarded-for': '9.9.9.9' };
  for (let k = 1; k <= 3; k++) {
    r = await call('../api/auth', { method: 'POST', headers: iph, body: { action: 'register', name: 'Spam' + k, phone: '08190000010' + k, password: 'spam1234' } });
    ok(r.json.ok, `register ke-${k} dari IP sama diterima`);
  }
  r = await call('../api/auth', { method: 'POST', headers: iph, body: { action: 'register', name: 'Spam4', phone: '081900000104', password: 'spam1234' } });
  ok(r.status === 429, 'register ke-4 dalam sejam dari IP sama ditolak');
  // audit log mencatat aksi admin
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA), url: '/api/admin-stats?view=audit' });
  ok(r.json.ok && r.json.audit.some((a) => a.action === 'setujui-pendaftaran' && /081900000008/.test(a.detail)), 'audit: persetujuan Ira tercatat');
  ok(r.json.audit.some((a) => a.action === 'ganti-password'), 'audit: ganti password tercatat');
  // logout semua perangkat: minta -> setujui admin
  r = await call('../api/profile', { method: 'POST', headers: auth(tI2), body: { action: 'request-logout-all' } });
  ok(r.json.ok, 'Ira minta logout semua perangkat');
  r = await call('../api/profile', { method: 'POST', headers: auth(tI2), body: { action: 'request-logout-all' } });
  ok(r.status === 400 && /menunggu/i.test(r.json.error), 'permintaan ganda ditolak');
  r = await call('../api/borrowers', { method: 'GET', headers: auth(tA), url: '/api/borrowers?view=logout-requests' });
  ok(r.json.requests.some((x) => x.phone === '081900000008'), 'admin melihat permintaan logout Ira');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'logout-approve', phone: '081900000008' } });
  ok(r.json.ok && r.json.sessions >= 1, 'admin setujui: sesi dihanguskan');
  r = await call('../api/me', { method: 'GET', headers: auth(tI2) });
  ok(r.status === 401, 'token lama Ira hangus setelah logout semua');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'logout-approve', phone: '081900000008' } });
  ok(r.status === 400, 'approve permintaan yang sama dua kali ditolak');

  // ============ v2.2: alasan penolakan terlihat peminjam (tunai) ============
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Joko', phone: '081900000009', password: 'joko1234' } });
  ok(r.json.ok, 'registrasi Joko');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000009', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Joko');
  const tJ = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000009', password: 'joko1234' } })).json.token;
  r = await call('../api/profile', { method: 'POST', headers: auth(tJ), body: { action: 'pencairan', metode: 'dana', nomor: '081533334444', atasNama: 'Joko Prasetyo' } });
  assert.ok(r.json.ok, 'Joko isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tJ), body: { pokok: 300000 } });
  ok(r.json.ok, 'pengajuan Joko diterima');
  const loanJ1 = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanJ1, approve: false, alasan: 'Limit belum cukup, coba lagi bulan depan' } });
  ok(r.json.ok && r.json.loan.status === 'ditolak', 'pengajuan ditolak');
  ok(r.json.loan.alasanTolak === 'Limit belum cukup, coba lagi bulan depan', 'alasan tolak tersimpan');
  const loansJ = await call('../api/loans', { method: 'GET', headers: auth(tJ) });
  const tolakJ = loansJ.json.loans.find((l) => l.id === loanJ1);
  ok(tolakJ && tolakJ.alasanTolak === 'Limit belum cukup, coba lagi bulan depan', 'alasan tolak terlihat oleh peminjam');

  // ============ v2.4: rank dari pelunasan penuh + gadai dihapus ============
  // aksi gadai sudah tidak ada
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'terima-barang', loanId: loanJ1, foto: PROOF } });
  ok(r.status === 400 && /tidak dikenal/i.test(r.json.error), 'aksi terima-barang sudah tidak ada');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'serahkan-barang', loanId: loanJ1, foto: PROOF } });
  ok(r.status === 400 && /tidak dikenal/i.test(r.json.error), 'aksi serahkan-barang sudah tidak ada');
  // rank v2.6: 0/1/3 pelunasan -> belum ada rank (Bronze butuh 5)
  const uJ = await getJSON('user:081900000009');
  uJ.stats = { payments: 5, loansLunas: 0, totalPinjam: 0 };
  await setJSON('user:081900000009', uJ);
  r = await call('../api/me', { method: 'GET', headers: auth(tJ) });
  ok(r.json.rank === null && r.json.nextRank.name === 'Bronze', '5 pembayaran tanpa pelunasan -> belum ada rank');
  uJ.stats = { payments: 5, loansLunas: 1, totalPinjam: 300000 };
  await setJSON('user:081900000009', uJ);
  r = await call('../api/me', { method: 'GET', headers: auth(tJ) });
  ok(r.json.rank === null && r.json.nextRank.name === 'Bronze', '1 pelunasan -> belum ada rank (v2.6)');
  uJ.stats = { payments: 30, loansLunas: 3, totalPinjam: 900000 };
  await setJSON('user:081900000009', uJ);
  r = await call('../api/me', { method: 'GET', headers: auth(tJ) });
  ok(r.json.rank === null && r.json.nextRank.name === 'Bronze', '3 pelunasan -> belum ada rank (v2.6)');

  // ============ v2.3: jeda 3 hari setelah pelunasan ============
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Rudi', phone: '081900000010', password: 'rudi1234' } });
  ok(r.json.ok, 'registrasi Rudi');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000010', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Rudi');
  const tR = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000010', password: 'rudi1234' } })).json.token;
  r = await call('../api/profile', { method: 'POST', headers: auth(tR), body: { action: 'pencairan', metode: 'dana', nomor: '081544445555', atasNama: 'Rudi Santoso' } });
  assert.ok(r.json.ok, 'Rudi isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tR), body: { pokok: 200000 } });
  ok(r.json.ok, 'Rudi ajukan tunai');
  const loanR1 = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanR1, approve: true } });
  ok(r.json.ok, 'tunai Rudi disetujui');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanR1, schedIdx: 0 } });
  ok(r.json.ok && r.json.loan.status === 'lunas' && r.json.loan.lunasAt, 'tunai Rudi lunas, lunasAt tercatat');
  // langsung ajukan lagi -> 400 cooldown
  r = await call('../api/loans', { method: 'POST', headers: auth(tR), body: { pokok: 200000 } });
  ok(r.status === 400 && /jeda 3 hari/i.test(r.json.error), 'pengajuan langsung setelah lunas ditolak (cooldown)');
  // simulasikan 4 hari berlalu -> boleh mengajukan lagi
  const lr = await getJSON('loan:' + loanR1);
  lr.lunasAt = new Date(Date.now() - 4 * 864e5).toISOString();
  await setJSON('loan:' + loanR1, lr);
  r = await call('../api/loans', { method: 'POST', headers: auth(tR), body: { pokok: 200000 } });
  ok(r.json.ok, 'pengajuan setelah 3 hari diterima lagi');
  // helper cooldownRemaining
  ok(calc.cooldownRemaining([{ status: 'lunas', lunasAt: new Date().toISOString() }]) > 0, 'cooldownRemaining > 0 saat baru lunas');
  ok(calc.cooldownRemaining([{ status: 'lunas', lunasAt: new Date(Date.now() - 4 * 864e5).toISOString() }]) === 0, 'cooldownRemaining = 0 setelah 3 hari');
  ok(calc.cooldownRemaining([{ status: 'lunas' }]) === 0, 'tanpa lunasAt tidak kena cooldown');

  // ============ v2.5: tutup buku tanggal 1 ============
  // helper tanggal: 18 Okt -> 14 hari ke 1 Nov; 1 Okt -> 31 hari ke 1 Nov;
  // 1 Nov -> 30 hari ke 1 Des; 15 Feb 2026 -> 14 hari ke 1 Mar
  ok(calc.daysToNextFirst(new Date('2026-10-18')) === 14, 'tutup buku: 18 Okt -> 14 hari');
  ok(calc.daysToNextFirst(new Date('2026-10-01')) === 31, 'tutup buku: 1 Okt -> 31 hari (sebulan penuh)');
  ok(calc.daysToNextFirst(new Date('2026-11-01')) === 30, 'tutup buku: 1 Nov -> 30 hari');
  ok(calc.daysToNextFirst(new Date('2026-02-15')) === 14, 'tutup buku: 15 Feb -> 14 hari');
  ok(calc.localDateStr(calc.nextFirstDate(new Date('2026-10-18'))) === '2026-11-01', 'tutup buku: tanggal 1 bulan depan');
  ok(calc.localDateStr(calc.nextFirstDate(new Date('2026-10-31T00:30:00+07:00'))) === '2026-11-01', 'tutup buku: tanpa geser UTC di WIB');
  // pengajuan baru: tanpa tenor/metode, flag tutupBuku
  r = await call('../api/loans', { method: 'POST', headers: auth(tJ), body: { pokok: 200000 } });
  ok(r.json.ok && r.json.loan.tutupBuku === true && r.json.loan.metode === 'lunas', 'pengajuan baru bertanda tutup buku');
  ok(r.json.loan.tenorProposal === calc.daysToNextFirst(new Date()), 'tenorProposal = hari sampai tanggal 1');
  const loanTB = r.json.loan.id;
  // approve: jatuh tempo persis tanggal 1, 1 tagihan
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanTB, approve: true } });
  ok(r.json.ok && r.json.loan.schedule.length === 1, 'approve tutup buku: 1 tagihan');
  ok(r.json.loan.schedule[0].dueDate === calc.localDateStr(calc.nextFirstDate(new Date())), 'approve tutup buku: jatuh tempo tanggal 1');
  ok(r.json.loan.total === calc.calcLoan(200000, calc.daysToNextFirst(new Date()), 'lunas').total, 'approve tutup buku: total sesuai hari');
  // simulate: pokok saja, konsisten dengan approve
  r = await call('../api/loans', { method: 'POST', headers: auth(tJ), body: { action: 'simulate', pokok: 200000 } });
  ok(r.json.ok && r.json.days === calc.daysToNextFirst(new Date()) && r.json.dueDate === calc.localDateStr(calc.nextFirstDate(new Date())), 'simulate tutup buku konsisten');

  // ============ v2.7: biaya pencairan Rp2.500 ============
  r = await call('../api/loans', { method: 'POST', headers: auth(tJ), body: { action: 'simulate', pokok: 200000 } });
  ok(r.json.biayaPencairan === 2500, 'simulate: biaya pencairan 2500');
  ok(r.json.total === 200000 + r.json.bunga + 2000 + 2500, 'simulate: total termasuk biaya pencairan');
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Dewi', phone: '081900000011', password: 'dewi1234' } });
  ok(r.json.ok, 'registrasi Dewi');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000011', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Dewi');
  const tDewi = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000011', password: 'dewi1234' } })).json.token;
  r = await call('../api/profile', { method: 'POST', headers: auth(tDewi), body: { action: 'pencairan', metode: 'dana', nomor: '081900000011', atasNama: 'Dewi' } });
  assert.ok(r.json.ok, 'Dewi isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tDewi), body: { pokok: 200000 } });
  const loanFee = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanFee, approve: true } });
  ok(r.json.loan.biayaPencairan === 2500, 'approve: biaya pencairan tersimpan di pinjaman');
  ok(r.json.loan.total === r.json.loan.pokok + r.json.loan.bunga + r.json.loan.biayaLayanan + 2500, 'approve: total termasuk biaya pencairan');

  // ============ v2.6: lupa password + detail user admin ============
  r = await call('../api/auth', { method: 'POST', body: { action: 'forgot-request', phone: '081900000009' } });
  ok(r.json.ok, 'forgot-request diterima (tanpa login)');
  let rq = await getJSON('resetreq:081900000009');
  ok(rq && rq.status === 'menunggu', 'permintaan reset tersimpan');
  r = await call('../api/auth', { method: 'POST', body: { action: 'forgot-request', phone: '081900000009' } });
  ok(r.json.ok, 'forgot-request kedua tetap ok (tidak ganda)');
  r = await call('../api/auth', { method: 'POST', body: { action: 'forgot-request', phone: '089999999999' } });
  ok(r.json.ok && !(await getJSON('resetreq:089999999999')), 'nomor tak dikenal tetap ok tanpa jejak');
  r = await call('../api/borrowers', { method: 'GET', headers: auth(tA), url: '/api/borrowers?view=reset-requests' });
  ok(r.json.requests.length === 1 && r.json.requests[0].phone === '081900000009', 'admin melihat permintaan reset');
  r = await call('../api/borrowers', { method: 'GET', headers: auth(tJ), url: '/api/borrowers?view=reset-requests' });
  ok(r.status === 403, 'peminjam ditolak melihat reset-requests');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'reset-password', phone: '081900000009', newPassword: 'pendek' } });
  ok(r.status === 400, 'password baru < 8 karakter ditolak');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'reset-password', phone: '081900000009', newPassword: 'jokobaru123' } });
  ok(r.json.ok, 'admin reset password berhasil');
  rq = await getJSON('resetreq:081900000009');
  ok(rq.status === 'disetujui', 'permintaan reset ditandai selesai');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000009', password: 'joko1234' } });
  ok(!r.json.ok, 'password lama tidak bisa login lagi');
  r = await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000009', password: 'jokobaru123' } });
  ok(r.json.ok && r.json.token, 'login dengan password baru berhasil');
  r = await call('../api/borrowers', { method: 'GET', headers: auth(tA) });
  const bj = r.json.borrowers.find((b) => b.phone === '081900000009');
  ok(bj && 'profile' in bj && bj.pencairan && bj.pencairan.metode === 'dana', 'daftar admin menyertakan profile + pencairan user');

  // ============ v2.8: bayar sebagian tunai admin (denda dulu, baru pokok) ============
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Eko', phone: '081900000012', password: 'eko12345' } });
  ok(r.json.ok, 'registrasi Eko');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000012', approve: true, limit: 1000000 } });
  ok(r.json.ok, 'admin setujui Eko');
  const tEko = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000012', password: 'eko12345' } })).json.token;
  r = await call('../api/profile', { method: 'POST', headers: auth(tEko), body: { action: 'pencairan', metode: 'dana', nomor: '081900000012', atasNama: 'Eko' } });
  assert.ok(r.json.ok, 'Eko isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tEko), body: { pokok: 950000 } });
  const loanEko = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanEko, approve: true } });
  const expTotalEko = calc.calcLoan(950000, calc.daysToNextFirst(new Date()), 'lunas').total;
  ok(r.json.loan.total === expTotalEko, 'approve Eko: total sesuai rumus');
  // bayar sebagian 50rb sebelum jatuh tempo
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 50000 } });
  ok(r.json.ok && r.json.settled === false, 'bayar sebagian 50rb diterima (belum lunas)');
  const sisa1 = expTotalEko - 50000;
  ok(r.json.loan.schedule[0].sisaPokok === sisa1 && r.json.loan.schedule[0].dendaBalance === 0, 'sisa pokok terkunci = total - 50rb');
  ok(r.json.loan.status === 'berjalan', 'pinjaman tetap berjalan setelah bayar sebagian');
  // peminjam klaim sisa via transfer (sebelum jatuh tempo, tanpa denda) lalu admin tolak
  r = await call('../api/payments', { method: 'POST', headers: auth(tEko), body: { action: 'claim', loanId: loanEko, schedIdx: 0, payMethod: 'dana', proof: PROOF } });
  ok(r.json.ok && r.json.claim.amount === sisa1 && r.json.claim.baseAmount === sisa1, 'klaim sisa pokok (tanpa denda)');
  const claimEko = r.json.claim.id;
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: claimEko, approve: false } });
  ok(r.json.ok && r.json.loan.schedule[0].status === 'belum', 'klaim ditolak, tagihan kembali belum');
  // simulasikan telat 4 hari: mundurkan dueDate & lastSettleDate
  const dAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  let loanEkoObj = await getJSON('loan:' + loanEko);
  loanEkoObj.schedule[0].dueDate = dAgo(4);
  loanEkoObj.schedule[0].lastSettleDate = dAgo(5);
  await setJSON('loan:' + loanEko, loanEkoObj);
  r = await call('../api/loans', { method: 'GET', headers: auth(tA) });
  const itemEko = r.json.loans.find((l) => l.id === loanEko).schedule[0];
  const denda4 = Math.round(sisa1 * 0.01 * 4);
  ok(itemEko.daysLate === 4 && itemEko.lateFee === denda4 && itemEko.totalDue === sisa1 + denda4, 'denda berjalan dari sisa pokok (bukan total awal)');
  // v2.9.1: admin-stats & pengingat pakai sisa pokok (bukan total awal)
  r = await call('../api/admin-stats', { method: 'GET', headers: auth(tA) });
  const lateEko = r.json.late.find((x) => x.loanId === loanEko);
  ok(lateEko && lateEko.totalDue === sisa1 + denda4 && lateEko.lateFee === denda4 && lateEko.amount === sisa1, 'admin-stats: telat/outstanding pakai sisa pokok');
  r = await call('../api/notifications', { method: 'POST', headers: auth(tA), body: { action: 'remind', loanId: loanEko, schedIdx: 0 } });
  ok(r.json.ok && r.json.message.includes(calc.formatRp(sisa1 + denda4)) && !r.json.message.includes(calc.formatRp(expTotalEko)), 'pengingat: nominal sisa + denda, bukan total awal');
  // bayar sebagian 100rb saat telat: denda dulu, baru pokok
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 100000 } });
  const sisa2 = sisa1 - (100000 - denda4);
  ok(r.json.ok && r.json.loan.schedule[0].sisaPokok === sisa2 && r.json.loan.schedule[0].dendaBalance === 0, 'alokasi denda dulu: sisa pokok berkurang 100rb - denda');
  ok(r.json.loan.schedule[0].lateFeePaid === denda4, 'denda 4 hari tercatat terbayar');
  // bayar 10rb (lebih kecil dari denda berjalan 2 hari): pokok tidak berkurang
  loanEkoObj = await getJSON('loan:' + loanEko);
  loanEkoObj.schedule[0].lastSettleDate = dAgo(2);
  await setJSON('loan:' + loanEko, loanEkoObj);
  const denda2 = Math.round(sisa2 * 0.01 * 2);
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 10000 } });
  ok(r.json.ok && r.json.loan.schedule[0].sisaPokok === sisa2, 'bayar < denda: pokok tidak berkurang');
  ok(r.json.loan.schedule[0].dendaBalance === denda2 - 10000, 'tunggakan denda = denda 2 hari - 10rb');
  // validasi
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 99999999 } });
  ok(r.status === 400, 'jumlah melebihi total ditolak');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 0 } });
  ok(r.status === 400, 'jumlah 0 ditolak');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tEko), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 10000 } });
  ok(r.status === 403, 'peminjam ditolak partial-pay (403)');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'partial-pay', loanId: loanEko, schedIdx: 0, amount: 10000, paidDate: dAgo(-1) } });
  ok(r.status === 400, 'tanggal bayar masa depan ditolak');
  // lunasi sisa via tandai lunas (sadar sisa + tunggakan)
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanEko, schedIdx: 0 } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'tandai lunas setelah bayar sebagian: pinjaman lunas');
  const statsEko = (await getJSON('user:081900000012')).stats;
  ok(statsEko.payments === 4 && statsEko.loansLunas === 1, 'statistik: 4 pembayaran (3 sebagian + 1 lunas), 1 pelunasan penuh');

  // v2.9.2: pembatasan akun oleh admin
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Hadi', phone: '081900000013', password: 'hadi1234' } });
  ok(r.json.ok, 'registrasi Hadi');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000013', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Hadi, limit 500rb');
  const tHadi = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000013', password: 'hadi1234' } })).json.token;
  // peminjam tidak bisa batasi akun sendiri (endpoint admin-only)
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tHadi), body: { action: 'restrict', phone: '081900000013', restricted: true } });
  ok(r.status === 403, 'peminjam ditolak batasi akun (403)');
  // admin batasi -> pengajuan ditolak, flag terlihat di /api/me & daftar peminjam
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'restrict', phone: '081900000013', restricted: true } });
  ok(r.json.ok && r.json.restricted === true, 'admin batasi akun Hadi');
  r = await call('../api/me', { method: 'GET', headers: auth(tHadi) });
  ok(r.json.restricted === true, '/api/me: flag restricted true');
  r = await call('../api/borrowers', { method: 'GET', headers: auth(tA) });
  ok(r.json.borrowers.find((b) => b.phone === '081900000013').restricted === true, 'daftar peminjam: Hadi ditandai dibatasi');
  r = await call('../api/loans', { method: 'POST', headers: auth(tHadi), body: { pokok: 100000 } });
  ok(r.status === 400 && /dibatasi/i.test(r.json.error), 'pengajuan saat dibatasi ditolak');
  // admin lepas pembatasan -> pengajuan bisa lagi
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'restrict', phone: '081900000013', restricted: false } });
  ok(r.json.ok && r.json.restricted === false, 'admin lepas pembatasan Hadi');
  r = await call('../api/me', { method: 'GET', headers: auth(tHadi) });
  ok(r.json.restricted === false, '/api/me: flag restricted false');
  r = await call('../api/loans', { method: 'POST', headers: auth(tHadi), body: { pokok: 100000 } });
  ok(r.json.ok && r.json.loan.status === 'diajukan', 'pengajuan setelah dilepas diterima');

  // v2.9.3: langganan Lite/PRO
  // --- unit: cooldown & bonus per paket ---
  const lunas25h = { status: 'lunas', lunasAt: new Date(Date.now() - 25 * 3600e3).toISOString() };
  const lunas50h = { status: 'lunas', lunasAt: new Date(Date.now() - 50 * 3600e3).toISOString() };
  const uNoSub = {};
  const uLite = { subPlan: 'lite', subExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString() };
  const uPro = { subPlan: 'pro', subExpiresAt: new Date(Date.now() + 30 * 864e5).toISOString() };
  const uProKadaluarsa = { subPlan: 'pro', subExpiresAt: new Date(Date.now() - 1000).toISOString() };
  ok(calc.cooldownRemaining([lunas25h], uNoSub) > 0, 'cooldown 72 jam: 25 jam lalu masih jeda');
  ok(calc.cooldownRemaining([lunas25h], uPro) === 0, 'cooldown PRO 24 jam: 25 jam lalu sudah bebas');
  ok(calc.cooldownRemaining([lunas25h], uLite) > 0 && calc.cooldownRemaining([lunas50h], uLite) === 0, 'cooldown Lite 48 jam: 25 jam jeda, 50 jam bebas');
  ok(calc.cooldownRemaining([lunas25h], uProKadaluarsa) > 0, 'paket kedaluwarsa: kembali ke 72 jam');
  ok(calc.activeSubPlan(uPro) === 'pro' && calc.activeSubPlan(uProKadaluarsa) === null, 'activeSubPlan: aktif vs kedaluwarsa');
  ok(calc.subBonusFor(uPro) === 10000 && calc.subBonusFor(uLite) === 5000 && calc.subBonusFor(uNoSub) === 0, 'bonus langganan: PRO 10rb, Lite 5rb');
  // --- alur: Irfan PRO ---
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Irfan', phone: '081900000014', password: 'irfan1234' } });
  ok(r.json.ok, 'registrasi Irfan');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000014', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Irfan, limit 500rb');
  const tIrfan = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000014', password: 'irfan1234' } })).json.token;
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tIrfan), body: { action: 'set-sub', phone: '081900000014', plan: 'pro' } });
  ok(r.status === 403, 'peminjam ditolak atur langganan (403)');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'set-sub', phone: '081900000014', plan: 'gold' } });
  ok(r.status === 400, 'paket tidak dikenal ditolak');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'set-sub', phone: '081900000014', plan: 'pro' } });
  ok(r.json.ok && r.json.plan === 'pro' && r.json.expiresAt > new Date().toISOString(), 'admin aktifkan PRO Irfan');
  r = await call('../api/me', { method: 'GET', headers: auth(tIrfan) });
  ok(r.json.subPlan === 'pro' && r.json.subCooldownHours === 24 && r.json.subBonus === 0, '/api/me: PRO aktif, jeda 24 jam');
  r = await call('../api/profile', { method: 'POST', headers: auth(tIrfan), body: { action: 'pencairan', metode: 'dana', nomor: '081900000014', atasNama: 'Irfan' } });
  assert.ok(r.json.ok, 'Irfan isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tIrfan), body: { pokok: 100000 } });
  const loanIrfan = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanIrfan, approve: true } });
  ok(r.json.ok, 'pinjaman Irfan disetujui');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanIrfan, schedIdx: 0 } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'Irfan lunas (manual-pay)');
  ok((await getJSON('user:081900000014')).subBonus === 10000, 'bonus PRO 10rb masuk saat lunas');
  r = await call('../api/me', { method: 'GET', headers: auth(tIrfan) });
  ok(r.json.effectiveLimit === 510000, 'limit efektif naik jadi 510rb');
  let loanIrfanObj = await getJSON('loan:' + loanIrfan);
  loanIrfanObj.lunasAt = new Date(Date.now() - 25 * 3600e3).toISOString();
  await setJSON('loan:' + loanIrfan, loanIrfanObj);
  r = await call('../api/loans', { method: 'POST', headers: auth(tIrfan), body: { pokok: 100000 } });
  ok(r.json.ok && r.json.loan.status === 'diajukan', 'PRO: ajukan lagi setelah 25 jam (jeda 24 jam)');
  // --- alur: Joko tanpa langganan, lalu Lite ---
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Joko', phone: '081900000015', password: 'joko1234' } });
  ok(r.json.ok, 'registrasi Joko');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000015', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Joko, limit 500rb');
  const tJoko = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000015', password: 'joko1234' } })).json.token;
  r = await call('../api/profile', { method: 'POST', headers: auth(tJoko), body: { action: 'pencairan', metode: 'dana', nomor: '081900000015', atasNama: 'Joko' } });
  assert.ok(r.json.ok, 'Joko isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: auth(tJoko), body: { pokok: 100000 } });
  const loanJoko = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanJoko, approve: true } });
  ok(r.json.ok, 'pinjaman Joko disetujui');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanJoko, schedIdx: 0 } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'Joko lunas tanpa langganan');
  ok(((await getJSON('user:081900000015')).subBonus || 0) === 0, 'tanpa langganan: tidak ada bonus');
  let loanJokoObj = await getJSON('loan:' + loanJoko);
  loanJokoObj.lunasAt = new Date(Date.now() - 25 * 3600e3).toISOString();
  await setJSON('loan:' + loanJoko, loanJokoObj);
  r = await call('../api/loans', { method: 'POST', headers: auth(tJoko), body: { pokok: 100000 } });
  ok(r.status === 400 && /jeda/i.test(r.json.error), 'tanpa langganan: ajukan setelah 25 jam ditolak (jeda 72 jam)');
  loanJokoObj = await getJSON('loan:' + loanJoko);
  loanJokoObj.lunasAt = new Date(Date.now() - 73 * 3600e3).toISOString();
  await setJSON('loan:' + loanJoko, loanJokoObj);
  r = await call('../api/loans', { method: 'POST', headers: auth(tJoko), body: { pokok: 100000 } });
  ok(r.json.ok && r.json.loan.status === 'diajukan', 'tanpa langganan: ajukan setelah 73 jam diterima');
  const loanJoko2 = r.json.loan.id;
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'set-sub', phone: '081900000015', plan: 'lite' } });
  ok(r.json.ok && r.json.plan === 'lite', 'admin aktifkan Lite Joko');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanJoko2, approve: true } });
  ok(r.json.ok, 'pinjaman kedua Joko disetujui');
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'manual-pay', loanId: loanJoko2, schedIdx: 0 } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'Joko lunas kedua (Lite)');
  ok((await getJSON('user:081900000015')).subBonus === 5000, 'bonus Lite 5rb masuk saat lunas');
  const jokoUser = await getJSON('user:081900000015');
  jokoUser.subExpiresAt = new Date(Date.now() - 1000).toISOString();
  await setJSON('user:081900000015', jokoUser);
  r = await call('../api/me', { method: 'GET', headers: auth(tJoko) });
  ok(r.json.subPlan === null && r.json.subCooldownHours === 72, '/api/me: paket kedaluwarsa -> nonaktif');
  loanJokoObj = await getJSON('loan:' + loanJoko2);
  loanJokoObj.lunasAt = new Date(Date.now() - 25 * 3600e3).toISOString();
  await setJSON('loan:' + loanJoko2, loanJokoObj);
  r = await call('../api/loans', { method: 'POST', headers: auth(tJoko), body: { pokok: 100000 } });
  ok(r.status === 400 && /jeda/i.test(r.json.error), 'paket kedaluwarsa: jeda kembali 72 jam');


  // v2.9.5: Pet + kristal/koin, hapus ShopeePay
  console.log('== Tes v2.9.5 Pet & koin ==');
  // unit: produksi & harga pet
  ok(calc.petProductionRate(1) === 0.5, 'pet L1: 0,5 kristal/detik');
  ok(calc.petProductionRate(2) === 2 && calc.petProductionRate(3) === 4, 'pet L2: 2/detik, L3: 4/detik');
  ok(calc.petProductionRate(20) === 524288, 'pet L20: 524.288 kristal/detik');
  ok(calc.petBasePrice(1) === 500 && calc.petBasePrice(2) === 1000 && calc.petBasePrice(3) === 2000, 'harga dasar pet: L1 500, L2 1.000, L3 2.000 kristal');
  ok(calc.petPrice(1, 0) === 500 && calc.petPrice(1, 1) === 1000 && calc.petPrice(1, 2) === 2000, 'harga beli naik x2 tiap sudah beli level sama');
  ok(calc.KRISTAL_PER_KOIN === 10000 && calc.KOIN_RP === 1, 'konversi: 10.000 kristal = 1 koin = Rp1');
  const uPet0 = calc.ensurePetData({});
  ok(uPet0.kristal === 0 && uPet0.koin === 0 && Array.isArray(uPet0.pets) && uPet0.petFreeClaimed === false, 'ensurePetData: default user lama');
  assert.throws(() => calc.amountWithMethod(100000, 'shopeepay'), /Metode bayar/, 'ShopeePay ditolak di amountWithMethod');
  // simulasi tanpa shopeepay
  r = await call('../api/loans', { method: 'POST', headers: auth(tJoko), body: { action: 'simulate', pokok: 100000 } });
  ok(r.json.ok && r.json.totalBayar.dana && r.json.totalBayar.qris && !('shopeepay' in r.json.totalBayar), 'simulasi: hanya Dana + QRIS, tanpa ShopeePay');
  // pencairan shopeepay ditolak
  r = await call('../api/profile', { method: 'POST', headers: auth(tJoko), body: { action: 'pencairan', metode: 'shopeepay', nomor: '081900000015', atasNama: 'Joko' } });
  ok(r.status === 400, 'pencairan ShopeePay ditolak');
  // e2e pet: Kiki
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Kiki', phone: '081900000016', password: 'kiki1234' } });
  ok(r.json.ok, 'registrasi Kiki');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000016', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Kiki, limit 500rb');
  const tKiki = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000016', password: 'kiki1234' } })).json.token;
  const authK = auth(tKiki);
  // v2.9.6: Kiki harus berlangganan dulu sebelum bisa buka Pet
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'set-sub', phone: '081900000016', plan: 'lite' } });
  ok(r.json.ok && r.json.plan === 'lite', 'admin aktifkan Lite Kiki (syarat buka Pet v2.9.6)');
  r = await call('../api/pets', { method: 'GET', headers: authK });
  ok(r.json.ok && r.json.pets.length === 1 && r.json.pets[0].level === 1 && r.json.kristal === 0 && r.json.koin === 0, 'pet pertama gratis 1 ekor L1');
  r = await call('../api/pets', { method: 'GET', headers: auth(tA) });
  ok(r.status === 403, 'admin ditolak buka Pet (403)');
  // farming offline 1 jam: L1 0,5/dtk x 3600 = 1.800 kristal
  let kiki = await getJSON('user:081900000016');
  kiki.petLastClaimAt = Date.now() - 3600e3;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'claim' } });
  ok(r.json.ok && r.json.earned === 1800 && r.json.kristal === 1800, 'klaim offline 1 jam: 1.800 kristal');
  // offline 10 jam tetap maks 1 jam
  kiki = await getJSON('user:081900000016');
  kiki.petLastClaimAt = Date.now() - 10 * 3600e3;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'claim' } });
  ok(r.json.ok && r.json.earned === 1800 && r.json.kristal === 3600, 'klaim offline 10 jam tetap maks 1.800 kristal');
  // beli pet: kristal tidak cukup, lalu cukup
  kiki = await getJSON('user:081900000016');
  kiki.kristal = 400;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'buy', level: 1 } });
  ok(r.status === 400, 'beli pet kristal tidak cukup ditolak');
  kiki = await getJSON('user:081900000016');
  kiki.kristal = 500;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'buy', level: 1 } });
  ok(r.json.ok && r.json.bought.price === 500 && r.json.pets.length === 2 && r.json.kristal === 0, 'beli pet L1 pertama: 500 kristal');
  kiki = await getJSON('user:081900000016');
  kiki.kristal = 999;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'buy', level: 1 } });
  ok(r.status === 400, 'beli pet L1 kedua (1.000 kristal) dengan 999 ditolak');
  kiki = await getJSON('user:081900000016');
  kiki.kristal = 1000;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'buy', level: 1 } });
  ok(r.json.ok && r.json.bought.price === 1000 && r.json.pets.length === 3, 'beli pet L1 kedua: 1.000 kristal');
  // merge: level beda ditolak, level sama berhasil
  const petL1 = r.json.pets.filter((x) => x.level === 1);
  const [pA, pB] = [petL1[0], petL1[1]];
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'merge', petIdA: pA.id, petIdB: 'tidak-ada' } });
  ok(r.status === 400, 'merge dengan pet tidak ada ditolak');
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'merge', petIdA: pA.id, petIdB: pB.id } });
  ok(r.json.ok && r.json.merged.level === 2 && r.json.pets.length === 2, 'merge 2 pet L1 jadi 1 pet L2');
  const petL2 = r.json.pets.find((x) => x.level === 2);
  const petL1sisa = r.json.pets.find((x) => x.level === 1);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'merge', petIdA: petL2.id, petIdB: petL1sisa.id } });
  ok(r.status === 400, 'merge level beda (L2 + L1) ditolak');
  // konversi kristal -> koin
  kiki = await getJSON('user:081900000016');
  kiki.kristal = 25000;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'convert', kristal: 15000 } });
  ok(r.status === 400, 'tukar bukan kelipatan 10.000 ditolak');
  r = await call('../api/pets', { method: 'POST', headers: authK, body: { action: 'convert' } });
  ok(r.json.ok && r.json.converted.koin === 2 && r.json.kristal === 5000 && r.json.koin === 2, 'tukar 20.000 kristal jadi 2 koin, sisa 5.000 kristal');
  // koin dipakai mengurangi pembayaran
  r = await call('../api/profile', { method: 'POST', headers: authK, body: { action: 'pencairan', metode: 'dana', nomor: '081900000016', atasNama: 'Kiki' } });
  assert.ok(r.json.ok, 'Kiki isi data pencairan');
  r = await call('../api/loans', { method: 'POST', headers: authK, body: { action: 'simulate', pokok: 100000 } });
  const totalKiki = r.json.total;
  r = await call('../api/loans', { method: 'POST', headers: authK, body: { pokok: 100000 } });
  const loanKiki = r.json.loan.id;
  r = await call('../api/loan-action', { method: 'POST', headers: auth(tA), body: { action: 'decide', loanId: loanKiki, approve: true } });
  ok(r.json.ok, 'pinjaman Kiki disetujui');
  r = await call('../api/payments', { method: 'POST', headers: authK, body: { action: 'claim', loanId: loanKiki, schedIdx: 0, payMethod: 'shopeepay', proof: PROOF } });
  ok(r.status === 400, 'klaim bayar via ShopeePay ditolak');
  kiki = await getJSON('user:081900000016');
  kiki.koin = 5000;
  await setJSON('user:081900000016', kiki);
  r = await call('../api/payments', { method: 'POST', headers: authK, body: { action: 'claim', loanId: loanKiki, schedIdx: 0, payMethod: 'dana', proof: PROOF, koinUsed: 5000 } });
  ok(r.json.ok && r.json.claim.amount === totalKiki - 5000 && r.json.claim.koinUsed === 5000, 'klaim pakai 5.000 koin: tagihan berkurang Rp5.000');
  const claimKiki = r.json.claim.id;
  ok((await getJSON('user:081900000016')).koin === 0, 'koin terpotong saat klaim');
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: claimKiki, approve: false } });
  ok(r.json.ok, 'klaim Kiki ditolak admin');
  ok((await getJSON('user:081900000016')).koin === 5000, 'koin dikembalikan saat klaim ditolak');
  r = await call('../api/payments', { method: 'POST', headers: authK, body: { action: 'claim', loanId: loanKiki, schedIdx: 0, payMethod: 'dana', proof: PROOF, koinUsed: 5000 } });
  const claimKiki2 = r.json.claim.id;
  r = await call('../api/payments', { method: 'POST', headers: auth(tA), body: { action: 'confirm', claimId: claimKiki2, approve: true } });
  ok(r.json.ok && r.json.loan.status === 'lunas', 'klaim dengan koin disetujui: pinjaman lunas');
  ok((await getJSON('user:081900000016')).koin === 0, 'koin tetap terpotong setelah klaim disetujui');
  r = await call('../api/me', { method: 'GET', headers: authK });
  ok(r.json.kristal === 5000 && r.json.koin === 0 && r.json.petCount === 2, '/api/me: kristal/koin/pet tampil');
  // UI v2.9.5
  const appJs295 = require('fs').readFileSync(require('path').join(__dirname, '../public/app.js'), 'utf8');
  const css295 = require('fs').readFileSync(require('path').join(__dirname, '../public/styles.css'), 'utf8');
  ok(appJs295.includes('vPet') && appJs295.includes("'/api/pets'") && appJs295.includes('koinUsed'), 'UI: menu Pet + pemakaian koin di lapor bayar');
  ok(!appJs295.includes('shopeepay') && !css295.includes('shopeepay'), 'UI: tidak ada lagi ShopeePay');
  ok(require('fs').readdirSync(require('path').join(__dirname, '../api')).filter((f) => f.endsWith('.js')).length <= 12, 'Vercel Hobby: maks 12 Serverless Function');


  // v2.9.6: Pet hanya untuk Lite/PRO, Free dikunci
  console.log('== Tes v2.9.6 Pet terkunci ==');
  r = await call('../api/auth', { method: 'POST', body: { action: 'register', name: 'Lina', phone: '081900000017', password: 'lina1234' } });
  ok(r.json.ok, 'registrasi Lina (Free)');
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { phone: '081900000017', approve: true, limit: 500000 } });
  ok(r.json.ok, 'admin setujui Lina, limit 500rb');
  const tLina = (await call('../api/auth', { method: 'POST', body: { action: 'login', phone: '081900000017', password: 'lina1234' } })).json.token;
  const authL = auth(tLina);
  r = await call('../api/me', { method: 'GET', headers: authL });
  ok(r.json.subPlan === null, '/api/me Lina: tanpa langganan');
  r = await call('../api/pets', { method: 'GET', headers: authL });
  ok(r.status === 403 && /Lite\/PRO/.test(r.json.error), 'Free: buka Pet ditolak 403');
  r = await call('../api/pets', { method: 'POST', headers: authL, body: { action: 'claim' } });
  ok(r.status === 403, 'Free: klaim Pet ditolak 403');
  ok((await getJSON('user:081900000017')).petFreeClaimed !== true, 'Free: pet gratis tidak diberikan');
  // berlangganan Lite -> Pet terbuka
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'set-sub', phone: '081900000017', plan: 'lite' } });
  ok(r.json.ok && r.json.plan === 'lite', 'admin aktifkan Lite Lina');
  r = await call('../api/pets', { method: 'GET', headers: authL });
  ok(r.json.ok && r.json.pets.length === 1 && r.json.pets[0].level === 1, 'Lite: buka Pet berhasil, pet gratis L1 didapat');
  // langganan kedaluwarsa -> Pet terkunci lagi
  const linaUser = await getJSON('user:081900000017');
  linaUser.subExpiresAt = new Date(Date.now() - 1000).toISOString();
  await setJSON('user:081900000017', linaUser);
  r = await call('../api/pets', { method: 'GET', headers: authL });
  ok(r.status === 403, 'langganan kedaluwarsa: Pet terkunci lagi');
  // PRO juga bisa
  r = await call('../api/borrowers', { method: 'POST', headers: auth(tA), body: { action: 'set-sub', phone: '081900000017', plan: 'pro' } });
  ok(r.json.ok && r.json.plan === 'pro', 'admin aktifkan PRO Lina');
  r = await call('../api/pets', { method: 'GET', headers: authL });
  ok(r.json.ok && r.json.pets.length === 1, 'PRO: buka Pet berhasil, pet lama tetap ada');
  // UI v2.9.6
  ok(appJs295.includes('Pet Terkunci') && appJs295.includes('Lihat Langganan'), 'UI: menu Pet terkunci untuk Free');
  ok(appJs295.includes('Akses Pet'), 'UI: keterangan Pet di menu Langganan');

  // v2.9.4: UI — background kotak, langganan compact, slider info
  const fs = require('fs');
  const path = require('path');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
  const idxHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok(css.includes('dropSq') && css.includes('pulseSq') && css.includes('repeating-linear-gradient(90deg'), 'background gaming: grid neon + kotak jatuh + denyut');
  ok((idxHtml.match(/class="sq"/g) || []).length >= 4, 'background: kotak melayang di index.html');
  ok(appJs.includes('subPayPlan') && appJs.includes('data-subhead') && appJs.includes('sub-back'), 'langganan: accordion + tombol ke tampilan QRIS');
  ok(appJs.includes('infoSlider') && appJs.includes('INFO_SLIDES') && appJs.includes('10000'), 'dashboard: slider 3 info, 10 detik');
  ok(css.includes('.info-slide') && css.includes('translateX(-60px)'), 'slider: fade kanan ke kiri');

  console.log(`\nSEMUA TES LOLOS (${n} asersi)`);
})().catch((e) => {
  console.error('\nTES GAGAL:', e.message);
  process.exit(1);
});
