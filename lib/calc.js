'use strict';

/**
 * Rumus pinjaman (disepakati):
 *   Total tagihan = Pokok + (Pokok x 0,2% x tenorHari) + Rp 2.000 (biaya layanan)
 *     + Rp 2.500 (biaya pencairan, v2.7)
 * Pembayaran via QRIS kena tambahan 1% MDR per transaksi (dari total tagihan).
 */

const DAILY_RATE = 0.002;   // 0,2% per hari (flat)
const SERVICE_FEE = 2000;    // biaya layanan flat per pinjaman
const DISBURSE_FEE = 2500;   // v2.7: biaya pencairan flat per pinjaman
const MDR_QRIS = 0.01;       // 1% per transaksi QRIS
const LATE_FEE_RATE = 0.01;  // denda telat 1% per hari (flat, dari nominal tagihan)
const MIN_TENOR = 15;
const MIN_POKOK = 10000; // v2.9: minimal pengajuan Rp10.000
/** v2.5: tutup buku — tanggal 1 bulan depan dari tanggal acuan. */
function nextFirstDate(ref) {
  const d = ref ? new Date(ref) : new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** v2.5: jumlah hari dari tanggal acuan sampai tanggal 1 bulan depan. */
function daysToNextFirst(ref) {
  const d = ref ? new Date(ref) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const first = nextFirstDate(d);
  return Math.round((first - start) / 864e5);
}

/** Format tanggal lokal YYYY-MM-DD (tanpa geseran UTC seperti toISOString). */
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/** v2.3: jeda wajib setelah pelunasan sebelum boleh mengajukan lagi. */
const COOLDOWN_MS = 3 * 864e5;

/** v2.9.3: paket langganan. */
const SUB_PLANS = {
  lite: { name: 'Lite', price: 10000, bonus: 5000, cooldownHours: 48 },
  pro: { name: 'PRO', price: 25000, bonus: 10000, cooldownHours: 24 },
};
const SUB_DURATION_MS = 30 * 864e5; // langganan berlaku 30 hari sejak diaktifkan
const SUB_DEFAULT_COOLDOWN_HOURS = 72; // tanpa langganan: jeda 3 hari

/** Paket langganan yang sedang aktif (null bila tidak ada / sudah kedaluwarsa). */
function activeSubPlan(user, nowMs) {
  if (!user || !user.subPlan || !SUB_PLANS[user.subPlan]) return null;
  if (!user.subExpiresAt) return null;
  if (new Date(user.subExpiresAt).getTime() <= (nowMs || Date.now())) return null;
  return user.subPlan;
}

/** Bonus kenaikan limit saat pelunasan penuh (0 bila tidak berlangganan). */
function subBonusFor(user) {
  const plan = activeSubPlan(user);
  return plan ? SUB_PLANS[plan].bonus : 0;
}

/** Durasi cooldown (ms) untuk pengajuan baru, tergantung paket aktif. */
function cooldownMsFor(user) {
  const plan = activeSubPlan(user);
  if (!plan) return COOLDOWN_MS;
  return SUB_PLANS[plan].cooldownHours * 3600e3;
}

/** Jam cooldown yang berlaku untuk user (untuk ditampilkan di frontend). */
function cooldownHoursFor(user) {
  const plan = activeSubPlan(user);
  return plan ? SUB_PLANS[plan].cooldownHours : SUB_DEFAULT_COOLDOWN_HOURS;
}

/**
 * Sisa waktu cooldown (ms) untuk pengajuan baru.
 * Mengembalikan 0 bila tidak ada cooldown.
 */
function cooldownRemaining(loans, user) {
  const done = loans
    .filter((l) => l.status === 'lunas' && l.lunasAt)
    .sort((a, b) => new Date(b.lunasAt) - new Date(a.lunasAt))[0];
  if (!done) return 0;
  return Math.max(0, new Date(done.lunasAt).getTime() + cooldownMsFor(user) - Date.now());
}
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
 * @param {number} tenorHari  (v2.5: hari sistem, 1-31 untuk tutup buku)
 * @param {'lunas'|'cicilan'} metode
 * @returns {{pokok,tenorHari,metode,bunga,biayaLayanan,biayaPencairan,total,nCicilan,schedule}}
 *   schedule: [{ n, dueInDays, amount }]
 */
function calcLoan(pokok, tenorHari, metode, maxTenor = MAX_TENOR_ABS) {
  if (!Number.isInteger(pokok) || pokok <= 0) throw new Error('Pokok harus bilangan bulat positif.');
  if (!Number.isInteger(tenorHari) || tenorHari < 1 || tenorHari > maxTenor) {
    throw new Error(`Tenor harus 1-${maxTenor} hari.`);
  }
  if (metode !== 'lunas' && metode !== 'cicilan') throw new Error("Metode harus 'lunas' atau 'cicilan'.");

  const bunga = roundRp(pokok * DAILY_RATE * tenorHari);
  const biayaLayanan = SERVICE_FEE;
  const biayaPencairan = DISBURSE_FEE;
  const total = pokok + bunga + biayaLayanan + biayaPencairan;
  const n = metode === 'lunas' ? 1 : nCicilanOtomatis(tenorHari);
  const amounts = splitAmount(total, n);
  const dueDays = splitDueDays(tenorHari, n);

  const schedule = amounts.map((amount, i) => ({
    n: i + 1,
    dueInDays: dueDays[i],
    amount,
  }));

  return { pokok, tenorHari, metode, bunga, biayaLayanan, biayaPencairan, total, nCicilan: n, schedule };
}

/** Total yang harus dibayar untuk satu tagihan menurut metode pembayaran. */
function amountWithMethod(amount, payMethod) {
  if (payMethod === 'qris') return roundRp(amount * (1 + MDR_QRIS));
  if (payMethod === 'dana') return amount;
  throw new Error("Metode bayar harus 'dana' atau 'qris'.");
}

/* ============ BAYAR SEBAGIAN (v2.8) ===========
 * Tiap tagihan menyimpan sisa pokok & tunggakan denda agar bayar sebagian
 * bisa dicatat tanpa mengubah total awal. Tagihan lama (tanpa field ini)
 * dianggap belum pernah dibayar sebagian: sisa = amount, tunggakan = 0.
 * Aturan alokasi: pembayaran melunasi denda dulu, sisanya baru pokok.
 */
function sisaPokokOf(item) {
  return item.sisaPokok === undefined || item.sisaPokok === null ? item.amount : item.sisaPokok;
}
function dendaBalanceOf(item) { return item.dendaBalance || 0; }
/** Denda yang berjalan sejak tanggal acuan terakhir (jatuh tempo / bayar terakhir). */
function accruedDenda(item, refDateStr) {
  const last = item.lastSettleDate || item.dueDate;
  const from = last > item.dueDate ? last : item.dueDate;
  return calcLateFee(sisaPokokOf(item), from, refDateStr);
}
/** Total yang harus dibayar sekarang + rincian denda. */
function totalDueOf(item, refDateStr) {
  const { daysLate } = calcLateFee(sisaPokokOf(item), item.dueDate, refDateStr);
  const { lateFee } = accruedDenda(item, refDateStr);
  const denda = dendaBalanceOf(item) + lateFee;
  return { daysLate, lateFee: denda, totalDue: sisaPokokOf(item) + denda };
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

/* ============ SISTEM RANK (v2.4) ============
 * Naik rank berdasarkan jumlah pelunasan PENUH per pengajuan (1 pinjaman
 * lunas = 1 hitungan), bukan jumlah item pembayaran/cicilan.
 * Bronze 1x, Silver 3x, Gold 5x, Platinum 8x, Diamond 12x.
 * Setiap rank memberi bonus limit permanen; Platinum membuka tenor 45 hari,
 * Diamond membuka tenor 60 hari.
 */
const RANKS = [
  { name: 'Bronze',   min: 5,  bonus: 10000,  maxTenor: 30, color: '#cd7f32', icon: 'bi-award-fill' },
  { name: 'Silver',   min: 10, bonus: 15000,  maxTenor: 30, color: '#c0c0c0', icon: 'bi-award-fill' },
  { name: 'Gold',     min: 15, bonus: 20000,  maxTenor: 30, color: '#e8c26a', icon: 'bi-award-fill' },
  { name: 'Platinum', min: 20, bonus: 25000,  maxTenor: 45, color: '#e5e4e2', icon: 'bi-trophy-fill' },
  { name: 'Diamond',  min: 25, bonus: 50000,  maxTenor: 60, color: '#7dd3fc', icon: 'bi-gem' },
  { name: 'KING',     min: 30, bonus: 100000, maxTenor: 60, color: '#f59e0b', icon: 'bi-crown-fill' },
];

/** Batas tenor absolut (Diamond) — dipakai preview admin. */
const MAX_TENOR_ABS = 60;

function rankFor(loansLunas) {
  let current = null, next = null;
  for (const r of RANKS) {
    if (loansLunas >= r.min) current = r;
    else { next = r; break; }
  }
  return { current, next };
}

/** Bonus limit permanen dari rank (hanya rank tertinggi yang berlaku). */
function rankBonusFor(loansLunas) {
  const { current } = rankFor(loansLunas);
  return current ? current.bonus : 0;
}

/** Tenor maksimum yang dibuka rank peminjam. */
function maxTenorFor(loansLunas) {
  const { current } = rankFor(loansLunas);
  return current ? current.maxTenor : MAX_TENOR;
}


/* ============ SISTEM PET (v2.9.5) ============
 * Level 1-20, merge 2 pet level sama -> level+1.
 * Produksi kristal/detik: L1 = 0,5, L2 = 2, L3 = 4, L4 = 8, dst
 * (Ln = 2^(n-1) kristal/detik untuk n>=2).
 * Harga beli pakai kristal: dasar L1 500, L2 1.000, dst (500 x 2^(n-1)),
 * tiap sudah beli level yang sama harganya dikali 2.
 * 10.000 kristal = 1 koin, 1 koin = Rp1 potongan bayar.
 */
const PET_MAX_LEVEL = 20;
const PET_MAX_COUNT = 20;
const PET_OFFLINE_MS = 3600e3; // farming offline maks 1 jam per klaim
const KRISTAL_PER_KOIN = 10000;
const KOIN_RP = 1;

function petProductionRate(level) {
  if (!Number.isInteger(level) || level < 1 || level > PET_MAX_LEVEL) return 0;
  if (level === 1) return 0.5;
  return 2 ** (level - 1);
}
function petProductionPerSec(pets) {
  return (pets || []).reduce((s, pet) => s + petProductionRate(pet.level), 0);
}
function petBasePrice(level) {
  if (!Number.isInteger(level) || level < 1 || level > PET_MAX_LEVEL) return 0;
  return 500 * 2 ** (level - 1);
}
function petPrice(level, boughtCount) {
  return petBasePrice(level) * 2 ** Math.max(0, boughtCount || 0);
}
/** Pastikan field pet ada (migrasi aman untuk user lama). */
function ensurePetData(user) {
  if (!user) return user;
  if (user.kristal === undefined || user.kristal === null) user.kristal = 0;
  if (user.koin === undefined || user.koin === null) user.koin = 0;
  if (!Array.isArray(user.pets)) user.pets = [];
  if (!user.petBought) user.petBought = {};
  if (user.petFreeClaimed === undefined) user.petFreeClaimed = false;
  if (!user.petLastClaimAt) user.petLastClaimAt = Date.now();
  return user;
}

module.exports = {
  DAILY_RATE,
  SERVICE_FEE,
  DISBURSE_FEE,
  MDR_QRIS,
  LATE_FEE_RATE,
  MIN_TENOR,
  MIN_POKOK,
  COOLDOWN_MS,
  cooldownRemaining,
  SUB_PLANS,
  SUB_DURATION_MS,
  SUB_DEFAULT_COOLDOWN_HOURS,
  activeSubPlan,
  subBonusFor,
  cooldownMsFor,
  cooldownHoursFor,
  nextFirstDate,
  daysToNextFirst,
  localDateStr,
  MAX_TENOR,
  MAX_TENOR_ABS,
  RANKS,
  nCicilanOtomatis,
  splitAmount,
  splitDueDays,
  calcLoan,
  amountWithMethod,
  calcLateFee,
  sisaPokokOf,
  dendaBalanceOf,
  totalDueOf,
  daysBetween,
  todayStr,
  rankFor,
  rankBonusFor,
  maxTenorFor,
  formatRp,
  PET_MAX_LEVEL,
  PET_MAX_COUNT,
  PET_OFFLINE_MS,
  KRISTAL_PER_KOIN,
  KOIN_RP,
  petProductionRate,
  petProductionPerSec,
  petBasePrice,
  petPrice,
  ensurePetData,
};
