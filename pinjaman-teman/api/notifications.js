'use strict';
// /api/notifications
// Peminjam:
//   GET  -> daftar notifikasi untuk saya (broadcast 'all' + khusus saya) + jumlah belum dibaca
//   POST { action:'read', id } | { action:'readAll' } -> tandai sudah dibaca
// Admin (gabungan broadcast.js sejak v1.4.1 — hemat jatah function Vercel Hobby):
//   GET  -> riwayat broadcast terakhir
//   POST { mode:'all' } | { mode:'selected', phones:[...] } + { message } -> kirim broadcast
//   POST { action:'remind', loanId, schedIdx } -> pengingat jatuh tempo 1-klik (v1.6)
const { getJSON, setJSON, nextId } = require('../lib/store');
const { requireAuth, readBody, send, normPhone } = require('../lib/auth');
const { calcLateFee, todayStr } = require('../lib/calc');
const { audit } = require('../lib/audit');

function fmtRp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

async function listFor(user) {
  const ids = (await getJSON('idx:notifs')) || [];
  const readSet = new Set(user.readNotifIds || []);
  const out = [];
  for (const id of ids) {
    const n = await getJSON('notif:' + id);
    if (!n) continue;
    if (n.to !== 'all' && n.to !== user.phone) continue;
    out.push({ id: n.id, message: n.message, createdAt: n.createdAt, read: readSet.has(n.id) });
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

async function history() {
  const ids = (await getJSON('idx:notifs')) || [];
  const out = [];
  for (const id of ids.slice(-20)) {
    const n = await getJSON('notif:' + id);
    if (n) out.push(n);
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

async function broadcast(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, history: await history() });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method tidak didukung.' });

  const body = await readBody(req);

  // --- Pengingat jatuh tempo 1-klik (v1.6, admin) ---
  if (body.action === 'remind') {
    const loan = await getJSON('loan:' + String(body.loanId || ''));
    if (!loan) return send(res, 404, { ok: false, error: 'Pinjaman tidak ditemukan.' });
    if (loan.status !== 'berjalan') return send(res, 400, { ok: false, error: 'Pinjaman tidak aktif.' });
    const s = loan.schedule[Number(body.schedIdx)];
    if (!s) return send(res, 400, { ok: false, error: 'Tagihan tidak valid.' });
    if (s.status === 'lunas') return send(res, 400, { ok: false, error: 'Tagihan sudah lunas.' });
    const today = todayStr();
    const diffHari = Math.ceil(
      (new Date(s.dueDate + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 864e5);
    if (diffHari > 3) {
      return send(res, 400, { ok: false, error: `Belum perlu diingatkan (jatuh tempo masih ${diffHari} hari lagi).` });
    }
    const last = s.remindedAt ? Date.now() - new Date(s.remindedAt).getTime() : Infinity;
    if (last < 24 * 3600e3) {
      const jam = Math.max(1, Math.floor(last / 3600e3));
      return send(res, 400, { ok: false, error: `Sudah diingatkan ${jam} jam lalu. Coba lagi besok.` });
    }
    const { daysLate, lateFee } = calcLateFee(s.amount, s.dueDate, today);
    const total = s.amount + lateFee;
    const judul = loan.metode === 'cicilan' ? `Cicilan ${s.n}/${loan.nCicilan}` : 'Pelunasan';
    const message = daysLate > 0
      ? `Pengingat dari admin: ${judul} ${fmtRp(s.amount)} sudah TELAT ${daysLate} hari (jatuh tempo ${s.dueDate}). Total saat ini ${fmtRp(total)} termasuk denda ${fmtRp(lateFee)}. Segera bayar agar denda tidak bertambah.`
      : `Pengingat dari admin: ${judul} ${fmtRp(total)} jatuh tempo ${s.dueDate}${diffHari === 0 ? ' (hari ini)' : ` (${diffHari} hari lagi)`}. Segera lakukan pembayaran agar terhindar dari denda 1%/hari.`;
    s.remindedAt = new Date().toISOString();
    await setJSON('loan:' + loan.id, loan);
    const id = await nextId('notif');
    const rec = {
      id, to: loan.borrowerPhone, targetName: loan.borrowerName,
      message, createdAt: new Date().toISOString(), kind: 'remind',
    };
    await setJSON('notif:' + id, rec);
    const ids = (await getJSON('idx:notifs')) || [];
    ids.push(id);
    await setJSON('idx:notifs', ids);
    return send(res, 200, { ok: true, sent: 1, to: loan.borrowerName, message });
  }

  const message = String(body.message || '').trim();
  if (message.length < 3 || message.length > 500) {
    return send(res, 400, { ok: false, error: 'Pesan harus 3–500 karakter.' });
  }
  const mode = body.mode === 'selected' ? 'selected' : 'all';

  let targets = []; // [{ to, targetName }]
  if (mode === 'all') {
    targets = [{ to: 'all', targetName: 'Semua user' }];
  } else {
    const phones = [...new Set((Array.isArray(body.phones) ? body.phones : []).map(normPhone).filter(Boolean))];
    if (!phones.length) return send(res, 400, { ok: false, error: 'Pilih minimal satu user.' });
    for (const ph of phones) {
      const u = await getJSON('user:' + ph);
      if (u && u.status === 'active') targets.push({ to: ph, targetName: u.name });
    }
    if (!targets.length) return send(res, 400, { ok: false, error: 'User terpilih tidak ditemukan/aktif.' });
  }

  const createdAt = new Date().toISOString();
  const ids = (await getJSON('idx:notifs')) || [];
  const sent = [];
  for (const t of targets) {
    const id = await nextId('notif');
    const rec = { id, to: t.to, targetName: t.targetName, message, createdAt };
    await setJSON('notif:' + id, rec);
    ids.push(id);
    sent.push(rec);
  }
  await setJSON('idx:notifs', ids);
  await audit('broadcast', req.session.phone, `${mode === 'all' ? 'semua user' : sent.length + ' user'}: ${message.slice(0, 120)}`);
  return send(res, 200, { ok: true, sent: sent.length, notifications: sent });
}

module.exports = requireAuth(async (req, res) => {
  if (req.session.role === 'admin') return broadcast(req, res);

  if (req.session.role !== 'borrower') return send(res, 403, { ok: false, error: 'Khusus peminjam.' });
  const user = await getJSON('user:' + req.session.phone);
  if (!user) return send(res, 404, { ok: false, error: 'Akun tidak ditemukan.' });

  if (req.method === 'GET') {
    const notifications = await listFor(user);
    return send(res, 200, { ok: true, notifications, unread: notifications.filter((n) => !n.read).length });
  }
  if (req.method === 'POST') {
    const body = await readBody(req);
    // Pengingat jatuh tempo hanya untuk admin (v1.6)
    if (body.action === 'remind') {
      return send(res, 403, { ok: false, error: 'Khusus admin.' });
    }
    // Percobaan broadcast oleh peminjam -> tolak seperti endpoint admin lama
    if (body.mode !== undefined || body.message !== undefined) {
      return send(res, 403, { ok: false, error: 'Khusus admin.' });
    }
    const read = new Set(user.readNotifIds || []);
    if (body.action === 'readAll') {
      const all = await listFor(user);
      all.forEach((n) => read.add(n.id));
    } else if (body.action === 'read' && body.id) {
      read.add(String(body.id));
    } else {
      return send(res, 400, { ok: false, error: 'Aksi tidak dikenal.' });
    }
    user.readNotifIds = [...read].slice(-300);
    await setJSON('user:' + user.phone, user);
    return send(res, 200, { ok: true });
  }
  return send(res, 405, { ok: false, error: 'Method tidak didukung.' });
});
