'use strict';
// /api/pets (v2.9.5) — minigame Pet merge + 2 mata uang.
//   GET  -> status pet, kristal, koin, produksi/detik (peminjam)
//   POST { action:'claim' } -> klaim produksi pet (offline maks 1 jam)
//   POST { action:'buy', level } -> beli pet pakai kristal
//   POST { action:'merge', petIdA, petIdB } -> gabung 2 pet level sama
//   POST { action:'convert', kristal? } -> tukar kristal jadi koin
// Aturan keamanan: semua hitungan di server, frontend hanya kirim aksi.
//   10.000 kristal = 1 koin, 1 koin = Rp1 potongan bayar.
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const {
  ensurePetData, petProductionRate, petBasePrice, petPrice,
  petProductionPerSec, KRISTAL_PER_KOIN, PET_MAX_LEVEL, PET_MAX_COUNT,
  PET_OFFLINE_MS,
} = require('../lib/calc');
const { audit } = require('../lib/audit');

function accrue(user, nowMs) {
  ensurePetData(user);
  if (!user.pets || user.pets.length === 0) {
    user.petLastClaimAt = nowMs;
    return 0;
  }
  if (!user.petLastClaimAt) { user.petLastClaimAt = nowMs; return 0; }
  let elapsedSec = Math.floor((nowMs - user.petLastClaimAt) / 1000);
  if (elapsedSec <= 0) return 0;
  // Farming offline maks 1 jam per klaim; standby (aplikasi dibuka dan
  // klaim berkala) tidak kena batas karena tiap klaim < 1 jam.
  elapsedSec = Math.min(elapsedSec, Math.floor(PET_OFFLINE_MS / 1000));
  const earned = Math.floor(petProductionPerSec(user.pets) * elapsedSec);
  if (earned > 0) user.kristal = (user.kristal || 0) + earned;
  user.petLastClaimAt = nowMs;
  return earned;
}

async function loadUser(phone, nowMs) {
  const user = await getJSON('user:' + phone);
  if (!user) return null;
  ensurePetData(user);
  // Pet pertama gratis 1 ekor L1 saat pertama kali membuka menu Pet.
  if (!user.petFreeClaimed) {
    const id = await nextId('pet');
    user.pets.push({ id, level: 1, createdAt: new Date(nowMs).toISOString() });
    user.petFreeClaimed = true;
    user.petLastClaimAt = nowMs;
    await setJSON('user:' + phone, user);
  }
  return user;
}

function petStatus(user, nowMs) {
  const pending = (() => {
    if (!user.pets || user.pets.length === 0 || !user.petLastClaimAt) return 0;
    let elapsedSec = Math.floor((nowMs - user.petLastClaimAt) / 1000);
    if (elapsedSec <= 0) return 0;
    elapsedSec = Math.min(elapsedSec, Math.floor(PET_OFFLINE_MS / 1000));
    return Math.floor(petProductionPerSec(user.pets) * elapsedSec);
  })();
  return {
    ok: true,
    kristal: user.kristal || 0,
    koin: user.koin || 0,
    pets: user.pets || [],
    productionPerSec: petProductionPerSec(user.pets || []),
    pendingKristal: pending,
    kristalPerKoin: KRISTAL_PER_KOIN,
    petBought: user.petBought || {},
    maxLevel: PET_MAX_LEVEL,
    maxPets: PET_MAX_COUNT,
  };
}

module.exports = requireAuth(async (req, res) => {
  if (req.session.role !== 'borrower') {
    return send(res, 403, { ok: false, error: 'Fitur Pet hanya untuk peminjam.' });
  }
  const nowMs = Date.now();
  try {
    if (req.method === 'GET') {
      const user = await loadUser(req.session.phone, nowMs);
      if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });
      return send(res, 200, petStatus(user, nowMs));
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
    const body = await readBody(req);
    const user = await loadUser(req.session.phone, nowMs);
    if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });

    if (body.action === 'claim') {
      const earned = accrue(user, nowMs);
      await setJSON('user:' + req.session.phone, user);
      return send(res, 200, { ...petStatus(user, nowMs), earned });
    }

    if (body.action === 'buy') {
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 1 || level > PET_MAX_LEVEL) {
        return send(res, 400, { ok: false, error: 'Level pet harus 1-20.' });
      }
      accrue(user, nowMs);
      if ((user.pets || []).length >= PET_MAX_COUNT) {
        return send(res, 400, { ok: false, error: 'Kandang penuh (maks 20 pet). Merge dulu untuk mengosongkan slot.' });
      }
      const price = petPrice(level, (user.petBought || {})[level] || 0);
      if ((user.kristal || 0) < price) {
        return send(res, 400, { ok: false, error: `Kristal tidak cukup. Pet L${level} harganya ${price.toLocaleString('id-ID')} kristal.` });
      }
      user.kristal -= price;
      user.petBought = user.petBought || {};
      user.petBought[level] = ((user.petBought[level] || 0) + 1);
      const id = await nextId('pet');
      user.pets.push({ id, level, createdAt: new Date(nowMs).toISOString() });
      await setJSON('user:' + req.session.phone, user);
      await audit('beli-pet', req.session.phone, `Beli pet L${level} (${id}) seharga ${price} kristal.`);
      return send(res, 200, { ...petStatus(user, nowMs), bought: { id, level, price } });
    }

    if (body.action === 'merge') {
      const a = (user.pets || []).find((p) => p.id === String(body.petIdA || ''));
      const b = (user.pets || []).find((p) => p.id === String(body.petIdB || ''));
      if (!a || !b || a.id === b.id) {
        return send(res, 400, { ok: false, error: 'Pilih 2 pet yang berbeda.' });
      }
      if (a.level !== b.level) {
        return send(res, 400, { ok: false, error: 'Merge hanya boleh pet dengan level yang sama.' });
      }
      if (a.level >= PET_MAX_LEVEL) {
        return send(res, 400, { ok: false, error: 'Pet sudah level maksimal (20).' });
      }
      accrue(user, nowMs);
      user.pets = user.pets.filter((p) => p.id !== a.id && p.id !== b.id);
      const id = await nextId('pet');
      const nextLevel = a.level + 1;
      user.pets.push({ id, level: nextLevel, createdAt: new Date(nowMs).toISOString() });
      await setJSON('user:' + req.session.phone, user);
      await audit('merge-pet', req.session.phone, `Merge 2 pet L${a.level} jadi pet L${nextLevel} (${id}).`);
      return send(res, 200, { ...petStatus(user, nowMs), merged: { id, level: nextLevel } });
    }

    if (body.action === 'convert') {
      accrue(user, nowMs);
      let kristal = body.kristal === undefined || body.kristal === null
        ? Math.floor((user.kristal || 0) / KRISTAL_PER_KOIN) * KRISTAL_PER_KOIN
        : Number(body.kristal);
      if (!Number.isInteger(kristal) || kristal <= 0) {
        return send(res, 400, { ok: false, error: 'Jumlah kristal tidak valid.' });
      }
      if (kristal % KRISTAL_PER_KOIN !== 0) {
        return send(res, 400, { ok: false, error: `Tukar harus kelipatan ${KRISTAL_PER_KOIN.toLocaleString('id-ID')} kristal.` });
      }
      if (kristal > (user.kristal || 0)) {
        return send(res, 400, { ok: false, error: 'Kristal tidak cukup.' });
      }
      const gained = Math.floor(kristal / KRISTAL_PER_KOIN);
      user.kristal -= kristal;
      user.koin = (user.koin || 0) + gained;
      await setJSON('user:' + req.session.phone, user);
      await audit('tukar-koin', req.session.phone, `Tukar ${kristal} kristal jadi ${gained} koin.`);
      return send(res, 200, { ...petStatus(user, nowMs), converted: { kristal, koin: gained } });
    }

    return send(res, 400, { ok: false, error: 'Action tidak dikenal.' });
  } catch (e) {
    console.error('[pets]', e);
    return send(res, 500, { ok: false, error: 'Terjadi kesalahan server. Silakan coba lagi.' });
  }
});
