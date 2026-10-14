// lib/profile.js — data diri peminjam (KYC-lite) & bonus limit.
// Setiap field yang DISETUJUI admin menambah limit sebesar bonusnya.
// Limit efektif = limit dasar (diatur admin) + total bonus disetujui + bonus rank.

const { rankBonusFor } = require('./calc');

const PROFILE_FIELDS = [
  { key: 'namaLengkap',  label: 'Nama lengkap',  type: 'text',     bonus: 2500 },
  { key: 'usia',         label: 'Usia',          type: 'number',   bonus: 2500 },
  { key: 'jenisKelamin', label: 'Jenis kelamin', type: 'select',   bonus: 2500, options: ['Laki-laki', 'Perempuan'] },
  { key: 'tanggalLahir', label: 'Tanggal lahir', type: 'date',     bonus: 2500 },
  { key: 'noKK',         label: 'Nomor KK',      type: 'text',     bonus: 5000, digits: 16 },
  { key: 'noNIK',        label: 'Nomor NIK',     type: 'text',     bonus: 5000, digits: 16 },
  { key: 'alamat',       label: 'Alamat',        type: 'textarea', bonus: 2500 },
  { key: 'pekerjaan',    label: 'Pekerjaan',     type: 'text',     bonus: 2500 },
  { key: 'fotoKTP',      label: 'Foto KTP',      type: 'photo',    bonus: 10000 },
  { key: 'fotoKK',       label: 'Foto KK',       type: 'photo',    bonus: 10000 },
];

const FIELD_MAP = Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, f]));
const MAX_PHOTO_CHARS = 550 * 1024; // ~400KB biner setelah base64

function emptyProfile() {
  const p = {};
  for (const f of PROFILE_FIELDS) p[f.key] = { value: '', status: 'belum', updatedAt: null };
  return p;
}

function ensureProfile(user) {
  if (!user.profile) user.profile = emptyProfile();
  // migrasi: field baru ditambahkan aman
  for (const f of PROFILE_FIELDS) {
    if (!user.profile[f.key]) user.profile[f.key] = { value: '', status: 'belum', updatedAt: null };
  }
  return user.profile;
}

/** Validasi nilai per field. Return { ok, error?, value? } (value ternormalisasi). */
function validateField(key, raw) {
  const def = FIELD_MAP[key];
  if (!def) return { ok: false, error: 'Field tidak dikenal.' };
  const v = typeof raw === 'string' ? raw.trim() : raw;

  if (def.type === 'photo') {
    if (typeof v !== 'string' || !v.startsWith('data:image/')) {
      return { ok: false, error: 'Foto tidak valid.' };
    }
    if (v.length > MAX_PHOTO_CHARS) {
      return { ok: false, error: 'Ukuran foto terlalu besar (maks ~400KB). Coba foto ulang.' };
    }
    return { ok: true, value: v };
  }
  if (!v && v !== 0) return { ok: false, error: 'Nilai tidak boleh kosong.' };

  if (def.type === 'number') {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 17 || n > 100) {
      return { ok: false, error: 'Usia harus angka 17–100.' };
    }
    return { ok: true, value: n };
  }
  if (def.type === 'select') {
    if (!def.options.includes(v)) return { ok: false, error: 'Pilihan tidak valid.' };
    return { ok: true, value: v };
  }
  if (def.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'Format tanggal tidak valid.' };
    const d = new Date(v + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'Tanggal tidak valid.' };
    if (v > new Date().toISOString().slice(0, 10)) {
      return { ok: false, error: 'Tanggal lahir tidak boleh di masa depan.' };
    }
    return { ok: true, value: v };
  }
  // text / textarea
  const s = String(v);
  if (s.length > 500) return { ok: false, error: 'Terlalu panjang (maks 500 karakter).' };
  if (def.digits && !new RegExp(`^\\d{${def.digits}}$`).test(s)) {
    return { ok: false, error: `${def.label} harus ${def.digits} digit angka.` };
  }
  return { ok: true, value: s };
}

/** Total bonus dari field berstatus 'disetujui'. */
function limitBonus(profile) {
  let sum = 0;
  for (const f of PROFILE_FIELDS) {
    if (profile && profile[f.key] && profile[f.key].status === 'disetujui') sum += f.bonus;
  }
  return sum;
}

function maxBonus() {
  return PROFILE_FIELDS.reduce((a, f) => a + f.bonus, 0);
}

/** Limit yang berlaku untuk pengajuan: dasar + bonus data diri + bonus rank. */
function effectiveLimit(user) {
  const payments = (user && user.stats && user.stats.payments) || 0;
  return (user.limit || 0) + limitBonus(user.profile) + rankBonusFor(payments);
}

/** Jumlah field berstatus 'menunggu' di semua user (untuk badge admin). */
function countPending(profile) {
  let n = 0;
  for (const f of PROFILE_FIELDS) {
    if (profile && profile[f.key] && profile[f.key].status === 'menunggu') n++;
  }
  return n;
}

/* ============ DATA PENCAIRAN ============
 * Wajib diisi peminjam sebelum pinjaman bisa dicairkan (disetujui admin).
 * { metode:'dana'|'shopeepay'|'bank', nomor, atasNama, namaBank? }
 */
const PENCAIRAN_METODE = ['dana', 'shopeepay', 'bank'];

function validatePencairan(body) {
  const metode = String((body && body.metode) || '').toLowerCase();
  const nomor = String((body && body.nomor) || '').replace(/[\s-]/g, '');
  const atasNama = String((body && body.atasNama) || '').trim();
  const namaBank = String((body && body.namaBank) || '').trim();
  if (!PENCAIRAN_METODE.includes(metode)) {
    return { ok: false, error: 'Metode pencairan harus Dana, ShopeePay, atau Bank (ATM).' };
  }
  if (!/^\d{8,20}$/.test(nomor)) {
    return { ok: false, error: 'Nomor tujuan harus 8–20 digit angka.' };
  }
  if (atasNama.length < 3) return { ok: false, error: 'Nama pemilik akun wajib diisi.' };
  if (metode === 'bank' && namaBank.length < 2) {
    return { ok: false, error: 'Nama bank wajib diisi untuk transfer ATM.' };
  }
  return {
    ok: true,
    value: { metode, nomor, atasNama, namaBank: metode === 'bank' ? namaBank : '', updatedAt: new Date().toISOString() },
  };
}

function isPencairanComplete(user) {
  const p = user && user.pencairan;
  return !!(p && PENCAIRAN_METODE.includes(p.metode) && p.nomor && p.atasNama);
}

module.exports = {
  PROFILE_FIELDS,
  FIELD_MAP,
  MAX_PHOTO_CHARS,
  emptyProfile,
  ensureProfile,
  validateField,
  limitBonus,
  maxBonus,
  effectiveLimit,
  countPending,
  PENCAIRAN_METODE,
  validatePencairan,
  isPencairanComplete,
};
