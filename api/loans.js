'use strict';
// /api/loans
//   GET  -> daftar pinjaman (peminjam: milik sendiri; admin: semua, ?status=)
//   POST (peminjam) { pokok, tenorHari, metode } -> ajukan pinjaman (status 'diajukan')
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send } = require('../lib/auth');
const { MIN_TENOR, calcLateFee, todayStr, maxTenorFor } = require('../lib/calc');
const { effectiveLimit } = require('../lib/profile');

async function idxPush(key, val) {
  const arr = (await getJSON(key)) || [];
  if (!arr.includes(val)) { arr.push(val); await setJSON(key, arr); }
}

async function listLoans(filter) {
  const ids = (await getJSON('idx:loans')) || [];
  const out = [];
  for (const id of ids) {
    const l = await getJSON('loan:' + id);
    if (!l) continue;
    if (filter && filter.phone && l.borrowerPhone !== filter.phone) continue;
    if (filter && filter.status && l.status !== filter.status) continue;
    out.push(l);
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  // Tambahkan info denda berjalan (dihitung, tidak disimpan)
  const today = todayStr();
  for (const l of out) {
    if (l.status !== 'berjalan' || !Array.isArray(l.schedule)) continue;
    l.schedule = l.schedule.map((s) => {
      if (s.status === 'lunas') return { ...s, daysLate: 0, lateFee: 0, totalDue: s.amount };
      const { daysLate, lateFee } = calcLateFee(s.amount, s.dueDate, today);
      return { ...s, daysLate, lateFee, totalDue: s.amount + lateFee };
    });
  }
  return out;
}

async function hasActiveLoan(phone, jenis) {
  const loans = await listLoans({ phone });
  return loans.some((l) => (l.jenis || 'tunai') === (jenis || 'tunai') &&
    ['diajukan', 'disetujui', 'berjalan'].includes(l.status));
}

/** Validasi data barang gadai dari peminjam. */
function validateBarang(b) {
  const nama = String((b && b.nama) || '').trim();
  const deskripsi = String((b && b.deskripsi) || '').trim().slice(0, 500);
  const foto = (b && b.foto) || '';
  if (nama.length < 3 || nama.length > 100) {
    return { ok: false, error: 'Nama barang 3–100 karakter.' };
  }
  if (typeof foto !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(foto)) {
    return { ok: false, error: 'Foto barang wajib dilampirkan.' };
  }
  if (foto.length > 700000) {
    return { ok: false, error: 'Foto barang terlalu besar (maks ±700KB).' };
  }
  return { ok: true, value: { nama, deskripsi, foto, taksirAdmin: null, statusTitip: 'diajukan' } };
}

module.exports = requireAuth(async (req, res) => {
  const sess = req.session;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || '';
    const filter = sess.role === 'admin' ? { status } : { phone: sess.phone, status };
    const loans = await listLoans(filter);
    // Admin perlu tahu tenor maksimum tiap peminjam (unlock rank) saat menyetujui
    if (sess.role === 'admin') {
      for (const l of loans) {
        const u = await getJSON('user:' + l.borrowerPhone);
        l.maxTenor = maxTenorFor((u && u.stats && u.stats.payments) || 0);
      }
    }
    return send(res, 200, { ok: true, loans });
  }

  if (req.method === 'POST') {
    if (sess.role !== 'borrower') return send(res, 403, { ok: false, error: 'Hanya peminjam.' });
    try {
      const { pokok, tenorHari, metode, jenis, barang: barangIn } = await readBody(req);
      const isGadai = jenis === 'gadai';
      const pk = Number(pokok);
      const tn = Number(tenorHari);
      if (!Number.isInteger(pk) || pk <= 0) return send(res, 400, { ok: false, error: 'Pokok tidak valid.' });
      if (metode !== 'lunas' && metode !== 'cicilan') {
        return send(res, 400, { ok: false, error: 'Metode pelunasan tidak valid.' });
      }
      const user = await getJSON('user:' + sess.phone);
      if (!user || user.status !== 'active') return send(res, 403, { ok: false, error: 'Akun tidak aktif.' });
      const maxTenor = maxTenorFor((user.stats && user.stats.payments) || 0);
      if (!Number.isInteger(tn) || tn < MIN_TENOR || tn > maxTenor) {
        return send(res, 400, { ok: false, error: `Tenor harus ${MIN_TENOR}-${maxTenor} hari.` });
      }
      let barang = null;
      if (isGadai) {
        const vb = validateBarang(barangIn);
        if (!vb.ok) return send(res, 400, { ok: false, error: vb.error });
        barang = vb.value;
      }
      if (!isGadai && pk > effectiveLimit(user)) {
        return send(res, 400, { ok: false, error: 'Pokok melebihi limit kamu.' });
      }
      if (await hasActiveLoan(sess.phone, isGadai ? 'gadai' : 'tunai')) {
        return send(res, 400, { ok: false, error: isGadai ? 'Masih ada gadai aktif. Selesaikan dulu.' : 'Masih ada pinjaman aktif. Selesaikan dulu.' });
      }
      const id = await nextId('loan');
      const loan = {
        id, borrowerPhone: sess.phone, borrowerName: user.name,
        jenis: isGadai ? 'gadai' : 'tunai', barang,
        pokok: pk, tenorProposal: tn, tenorHari: null, metode,
        nCicilan: null, bunga: null, biayaLayanan: null, total: null,
        schedule: [], status: 'diajukan',
        createdAt: new Date().toISOString(), approvedAt: null, disbursedAt: null,
      };
      await setJSON('loan:' + id, loan);
      await idxPush('idx:loans', id);
      return send(res, 200, { ok: true, loan });
    } catch (e) {
      console.error('[loans]', e);
      return send(res, 500, { ok: false, error: 'Terjadi kesalahan server. Silakan coba lagi.' });
    }
  }

  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
}, );
