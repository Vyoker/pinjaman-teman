'use strict';

/**
 * Rumus pinjaman (disepakati):
 *   Total tagihan = Pokok + (Pokok x 0,2% x tenorHari) + Rp 2.000 (biaya layanan)
 * Pembayaran via QRIS kena tambahan 1% MDR per transaksi (dari total tagihan).
 */

const DAILY_RATE = 0.002;   // 0,2% per hari (flat)
const SERVICE_FEE = 2000;    // biaya layanan flat per pinjaman
const MDR_QRIS = 0.01;       // 1% per transaksi QRIS
const LATE_FEE_RATE = 0.01;  // denda telat 1% per hari (flat, dari nominal tagihan)
const MIN_TENOR = 15;
const MAX_TENOR = 30;

function roundRp(n) {
  return Math.round(n);
}

/** Jumlah cicilan otomatis dari tenor: mingguan, minimal 2x. */
function nCicilanOtomatis(tenorHari) {
  return Math.max(2, Math.round(tenorHari / 7));
}

/** Bagi total menjadi n angsuran; sisa pembulatan masuk angsuran terakhir. */
function splitAmount(total, n) {
  const base = Math.floor(total / n);
  const out = new Array(n).fill(base);
  out[n - 1] += total - base * n;
  return out;
}

/** Tanggal jatuh tempo kumulatif (hari ke-) untuk n periode sama panjang. */
function splitDueDays(tenorHari, n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(Math.round((tenorHari * i) / n));
  return out;
}

/**
 * Hitung simulasi / struktur pinjaman.
 * @param {number} pokok
 * @param {number} tenorHari  (15-30)
 * @param {'lunas'|'cicilan'} metode
 * @returns {{pokok,tenorHari,metode,bunga,biayaLayanan,total,nCicilan,schedule}}
 *   schedule: [{ n, dueInDays, amount }]
 */
function calcLoan(pokok, tenorHari, metode) {
  if (!Number.isInteger(pokok) || pokok <= 0) throw new Error('Pokok harus bilangan bulat positif.');
  if (!Number.isInteger(tenorHari) || tenorHari < MIN_TENOR || tenorHari > MAX_TENOR) {
    throw new Error(`Tenor harus ${MIN_TENOR}-${MAX_TENOR} hari.`);
  }
  if (metode !== 'lunas' && metode !== 'cicilan') throw new Error("Metode harus 'lunas' atau 'cicilan'.");

  const bunga = roundRp(pokok * DAILY_RATE * tenorHari);
  const biayaLayanan = SERVICE_FEE;
  const total = pokok + bunga + biayaLayanan;
  const n = metode === 'lunas' ? 1 : nCicilanOtomatis(tenorHari);
  const amounts = splitAmount(total, n);
  const dueDays = splitDueDays(tenorHari, n);

  const schedule = amounts.map((amount, i) => ({
    n: i + 1,
    dueInDays: dueDays[i],
    amount,
  }));

  return { pokok, tenorHari, metode, bunga, biayaLayanan, total, nCicilan: n, schedule };
}

/** Total yang harus dibayar untuk satu tagihan menurut metode pembayaran. */
function amountWithMethod(amount, payMethod) {
  if (payMethod === 'qris') return roundRp(amount * (1 + MDR_QRIS));
  if (payMethod === 'dana' || payMethod === 'shopeepay') return amount;
  throw new Error("Metode bayar harus 'dana', 'shopeepay', atau 'qris'.");
}

function formatRp(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Selisih hari kalender: bStr - aStr (bisa negatif). */
function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00Z').getTime();
  const b = new Date(bStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 864e5);
}

/**
 * Denda keterlambatan: 1%/hari (flat) dari nominal tagihan.
 * Dihitung sejak lewat jatuh tempo; berhenti saat dibayar.
 */
function calcLateFee(amount, dueDateStr, refDateStr) {
  const ref = refDateStr || todayStr();
  const daysLate = Math.max(0, daysBetween(dueDateStr, ref));
  return { daysLate, lateFee: roundRp(amount * LATE_FEE_RATE * daysLate) };
}

/* ============ SISTEM RANK ============
 * Naik rank berdasarkan jumlah pembayaran berhasil (per item tagihan lunas).
 * Bronze 10x, Silver 20x, Gold 30x, Platinum 40x, Diamond 50x.
 */
const RANKS = [
  { name: 'Bronze',   min: 10, color: '#cd7f32', icon: 'bi-award-fill' },
  { name: 'Silver',   min: 20, color: '#c0c0c0', icon: 'bi-award-fill' },
  { name: 'Gold',     min: 30, color: '#e8c26a', icon: 'bi-award-fill' },
  { name: 'Platinum', min: 40, color: '#e5e4e2', icon: 'bi-trophy-fill' },
  { name: 'Diamond',  min: 50, color: '#7dd3fc', icon: 'bi-gem' },
];

function rankFor(payments) {
  let current = null, next = null;
  for (const r of RANKS) {
    if (payments >= r.min) current = r;
    else { next = r; break; }
  }
  return { current, next };
}

module.exports = {
  DAILY_RATE,
  SERVICE_FEE,
  MDR_QRIS,
  LATE_FEE_RATE,
  MIN_TENOR,
  MAX_TENOR,
  RANKS,
  nCicilanOtomatis,
  splitAmount,
  splitDueDays,
  calcLoan,
  amountWithMethod,
  calcLateFee,
  daysBetween,
  todayStr,
  rankFor,
  formatRp,
};
