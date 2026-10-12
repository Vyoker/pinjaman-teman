'use strict';
/* Pinjaman Teman — SPA frontend (Bootstrap 5 + animasi) */

const APP_VERSION = '1.4.1';
const $ = (s) => document.querySelector(s);
/** Pasang handler ke semua elemen yang cocok (pengganti pola querySelectorAll berulang). */
const bindAll = (sel, ev, fn) => document.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
const main = $('#main'), nav = $('#nav'), topbar = $('#topbar');

const S = { token: localStorage.getItem('pt_token') || '', role: '', name: '', phone: '' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function fmtRp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = err ? 'err' : '';
  t.classList.remove('hidden');
  // restart animasi
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3200);
}
function badge(st) {
  const cls = 'b-' + String(st).replace(/[^a-z]/gi, '');
  return `<span class="badge ${cls}">${esc(st)}</span>`;
}
/** Badge rank: { name, color, icon } atau null. */
function rankBadge(rank) {
  if (!rank) return '<span class="badge b-belum"><i class="bi bi-award me-1"></i>Belum ada rank</span>';
  return `<span class="badge" style="background:${rank.color}22;color:${rank.color};border:1px solid ${rank.color}66">` +
    `<i class="bi ${rank.icon} me-1"></i>${esc(rank.name)}</span>`;
}
/** delay stagger untuk animasi entrance: stagger(i) -> ' class="anim-in" style="--d:140ms"' */
function stagger(i, cls) {
  return ` class="${cls || ''} anim-in" style="--d:${Math.min(i * 70, 560)}ms"`;
}
/** Animasi angka naik (count-up) dengan ease-out. */
function countUp(el, target, fmt) {
  const dur = 900, t0 = performance.now();
  function frame(t) {
    const p = Math.min((t - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(target * e));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function runCounters(root) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const kind = el.dataset.countKind || 'num';
    countUp(el, target, kind === 'rp' ? fmtRp : (v) => String(v));
  });
}

async function api(path, method = 'GET', body) {
  const opt = { method, headers: {} };
  if (S.token) opt.headers.Authorization = 'Bearer ' + S.token;
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({ ok: false, error: 'Respons server tidak valid.' }));
  // 401 pada pemanggilan login = kredensial salah (bukan sesi berakhir) -> tampilkan pesan aslinya
  if (r.status === 401 && path !== '/api/auth') { logout(); throw new Error('Sesi berakhir. Silakan login lagi.'); }
  if (!j.ok) throw new Error(j.error || 'Terjadi kesalahan.');
  return j;
}

function logout() {
  S.token = ''; S.role = ''; S.name = ''; S.phone = '';
  localStorage.removeItem('pt_token');
  showStorageWarn(false);
  go('login');
}

/** Tampilkan/sembunyikan peringatan mode memori (KV belum terhubung). */
function showStorageWarn(show) {
  const el = document.getElementById('storageWarn');
  if (el) el.classList.toggle('hidden', !show);
}

const NAVS = {
  borrower: [
    ['bDash', 'Beranda', 'bi-grid-1x2-fill'],
    ['ajukan', 'Ajukan', 'bi-plus-circle-fill'],
    ['bayar', 'Bayar', 'bi-wallet2'],
    ['riwayat', 'Riwayat', 'bi-clock-history'],
    ['akun', 'Akun', 'bi-person-fill'],
  ],
  admin: [
    ['aDash', 'Dashboard', 'bi-speedometer2'],
    ['pengajuan', 'Pengajuan', 'bi-inbox-fill'],
    ['klaim', 'Pembayaran', 'bi-arrow-left-right'],
    ['peminjam', 'Peminjam', 'bi-people-fill'],
    ['verifikasi', 'Verifikasi', 'bi-patch-check-fill'],
    ['broadcast', 'Broadcast', 'bi-megaphone-fill'],
    ['pengaturan', 'Pengaturan', 'bi-gear-fill'],
  ],
};

function renderChrome() {
  const logged = !!S.token;
  topbar.classList.toggle('hidden', !logged);
  nav.classList.toggle('hidden', !logged);
  $('#footer').classList.toggle('hidden', !logged);
  $('#btnNotif').classList.toggle('hidden', !(logged && S.role === 'borrower'));
  if (!logged) return;
  $('#userName').textContent = S.name + (S.role === 'admin' ? ' (Admin)' : '');
  nav.innerHTML = NAVS[S.role].map(([v, l, ic]) =>
    `<button data-v="${v}" class="${S._view === v ? 'active' : ''}"><i class="bi ${ic}"></i>${l}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(b.dataset.v)));
}

function skeleton() {
  return [90, 150, 110].map((h, i) =>
    `<div class="skeleton anim-in" style="--d:${i * 90}ms;height:${h}px"></div>`).join('');
}

async function go(view) {
  S._view = view;
  renderChrome();
  main.innerHTML = skeleton();
  try {
    await VIEWS[view]();
    runCounters(main);
  } catch (e) {
    main.innerHTML = `<div class="card anim-in"><p class="text-danger mb-0"><i class="bi bi-exclamation-triangle-fill me-2"></i>${esc(e.message)}</p></div>`;
  }
  window.scrollTo(0, 0);
  refreshNotifBadge();
}

/** Perbarui lencana jumlah notifikasi belum dibaca di bel topbar. */
async function refreshNotifBadge() {
  if (!S.token || S.role !== 'borrower') return;
  try {
    const r = await api('/api/notifications');
    const b = $('#notifBadge');
    b.textContent = r.unread > 9 ? '9+' : String(r.unread);
    b.classList.toggle('hidden', !r.unread);
  } catch { /* abaikan */ }
}

/* ============ AUTH ============ */

function vLogin() {
  main.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo anim-in"><i class="bi bi-cash-coin"></i></div>
      <h2 class="anim-in" style="--d:80ms">Pinjaman Teman</h2>
      <p class="auth-sub anim-in" style="--d:140ms">Kelola pinjaman antar teman dekat</p>
      <div class="card anim-in" style="--d:200ms">
        <label class="form-label">Nomor HP</label>
        <input id="f-phone" class="form-control" inputmode="numeric" placeholder="08xxxxxxxxxx">
        <label class="form-label">Password</label>
        <input id="f-pass" class="form-control" type="password" placeholder="Password">
        <button class="btn btn-primary w-100 mt-3" id="b-login"><i class="bi bi-box-arrow-in-right me-2"></i>Masuk</button>
      </div>
      <p class="link-row anim-in" style="--d:260ms">Belum punya akun? <a href="#" id="to-reg">Daftar</a></p>
    </div>`;
  $('#to-reg').addEventListener('click', (e) => { e.preventDefault(); go('register'); });
  const doLogin = async () => {
    try {
      const j = await api('/api/auth', 'POST', {
        action: 'login', phone: $('#f-phone').value, password: $('#f-pass').value,
      });
      S.token = j.token; S.role = j.role; S.name = j.name;
      localStorage.setItem('pt_token', j.token);
      showStorageWarn(j.storage === 'memory');
      go(j.role === 'admin' ? 'aDash' : 'bDash');
    } catch (e) { toast(e.message, true); }
  };
  $('#b-login').addEventListener('click', doLogin);
  $('#f-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

function vRegister() {
  main.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo anim-in"><i class="bi bi-person-plus-fill"></i></div>
      <h2 class="anim-in" style="--d:80ms">Daftar Akun</h2>
      <p class="auth-sub anim-in" style="--d:140ms">Akun perlu disetujui admin sebelum bisa dipakai</p>
      <div class="card anim-in" style="--d:200ms">
        <label class="form-label">Nama lengkap</label>
        <input id="f-name" class="form-control" placeholder="Nama kamu">
        <label class="form-label">Nomor HP</label>
        <input id="f-phone" class="form-control" inputmode="numeric" placeholder="08xxxxxxxxxx">
        <label class="form-label">Password (min. 6 karakter)</label>
        <input id="f-pass" class="form-control" type="password" placeholder="Password">
        <button class="btn btn-primary w-100 mt-3" id="b-reg"><i class="bi bi-check-circle-fill me-2"></i>Daftar</button>
      </div>
      <p class="link-row anim-in" style="--d:260ms">Sudah punya akun? <a href="#" id="to-login">Masuk</a></p>
    </div>`;
  $('#to-login').addEventListener('click', (e) => { e.preventDefault(); go('login'); });
  $('#b-reg').addEventListener('click', async () => {
    try {
      const j = await api('/api/auth', 'POST', {
        action: 'register', name: $('#f-name').value, phone: $('#f-phone').value, password: $('#f-pass').value,
      });
      toast(j.message || 'Pendaftaran diterima.');
      go('login');
    } catch (e) { toast(e.message, true); }
  });
}

/* ============ PEMINJAM ============ */

function loanCard(l, showSchedule, i) {
  const sched = showSchedule ? `
    <h4>Jadwal ${l.metode === 'cicilan' ? 'cicilan' : 'pelunasan'}</h4>
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead><tr><th>#</th><th>Jatuh tempo</th><th class="text-end">Jumlah</th><th>Status</th></tr></thead>
      <tbody>${l.schedule.map((s) => `<tr>
        <td>${s.n}/${l.nCicilan}</td><td>${fmtDate(s.dueDate)}</td>
        <td class="text-end fw-bold">${fmtRp(s.amount)}${(s.lateFee || 0) > 0 ? `<div style="font-size:11px;color:var(--danger);font-weight:600">+denda ${fmtRp(s.lateFee)} (${s.daysLate}h)</div>` : ''}${s.lateFeePaid > 0 ? `<div style="font-size:11px" class="muted">denda lunas ${fmtRp(s.lateFeePaid)}</div>` : ''}</td><td>${badge(s.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '';
  return `
    <div${stagger(i || 0, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong class="fs-5">${fmtRp(l.pokok)}</strong>${badge(l.status)}
      </div>
      <div class="kv"><span class="k">Tenor</span><span class="v">${l.tenorHari || l.tenorProposal} hari</span></div>
      <div class="kv"><span class="k">Metode</span><span class="v">${l.metode === 'cicilan' ? 'Cicilan' : 'Sekaligus'}</span></div>
      ${l.total ? `<div class="kv"><span class="k">Total tagihan</span><span class="v big">${fmtRp(l.total)}</span></div>` : ''}
      <div class="kv"><span class="k">Diajukan</span><span class="v">${fmtDate(l.createdAt)}</span></div>
      ${sched}
    </div>`;
}

async function vBDash() {
  const me = await api('/api/me');
  S.name = me.name; S.phone = me.phone;
  const { loans } = await api('/api/loans');
  const active = loans.find((l) => l.status === 'diajukan' || l.status === 'berjalan');
  const hist = loans.filter((l) => l !== active);
  const rk = me.rank, nx = me.nextRank, stt = me.stats || { payments: 0, loansLunas: 0, totalPinjam: 0 };
  const pct = nx ? Math.min(100, Math.round((stt.payments / nx.min) * 100)) : 100;
  const rankCard = `
    <div${stagger(1, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h3 class="mb-0"><i class="bi bi-trophy-fill me-2" style="color:var(--gold)"></i>Rank Saya</h3>${rankBadge(rk)}
      </div>
      <div class="kv"><span class="k">Pembayaran berhasil</span><span class="v">${stt.payments}x</span></div>
      <div class="kv"><span class="k">Pinjaman lunas</span><span class="v">${stt.loansLunas}x</span></div>
      <div class="kv"><span class="k">Total pernah pinjam</span><span class="v">${fmtRp(stt.totalPinjam)}</span></div>
      ${nx ? `<div class="mt-2"><div class="d-flex justify-content-between"><span class="muted">Menuju ${esc(nx.name)}</span><span class="muted">${stt.payments}/${nx.min} pembayaran</span></div>
        <div class="progress mt-1" style="height:10px;background:#0e1712"><div class="progress-bar" role="progressbar" style="width:${pct}%;background:linear-gradient(90deg,var(--emerald),${nx.color})"></div></div></div>`
        : (rk ? `<p class="note mt-2"><i class="bi bi-gem me-1"></i>Rank tertinggi tercapai. Pertahankan!</p>` : '')}
      <p class="muted mt-2 mb-0" style="font-size:12px">Denda telat: 1%/hari dari tagihan. Bayar tepat waktu untuk naik rank lebih cepat.</p>
    </div>`;
  main.innerHTML = `
    <div${stagger(0, 'card hero-card')}>
      <div class="d-flex justify-content-between align-items-center mb-1">
        <h3 class="mb-0">Halo, ${esc(me.name)}</h3>${badge(me.status)}
      </div>
      <div class="kv"><span class="k">Limit pinjaman kamu</span><span class="v big" data-count="${me.effectiveLimit ?? me.limit}" data-count-kind="rp">…</span></div>
      ${(me.bonusLimit || 0) > 0
        ? `<div class="muted" style="font-size:12px">termasuk bonus data diri ${fmtRp(me.bonusLimit)}</div>`
        : `<div class="muted" style="font-size:12px">Mau limit lebih besar? <a href="#" id="b-lengkapi" style="color:var(--gold)">Lengkapi data diri</a></div>`}
      ${active ? '' : '<button class="btn btn-primary w-100 mt-3" id="b-ajukan"><i class="bi bi-plus-circle-fill me-2"></i>Ajukan Pinjaman</button>'}
    </div>
    ${rankCard}
    <div class="section-title">Pinjaman berjalan</div>
    ${active ? loanCard(active, true, 2) : `<div${stagger(2, 'card')}><p class="muted mb-0"><i class="bi bi-inbox me-2"></i>Tidak ada pinjaman aktif.</p></div>`}
    <div class="section-title">Riwayat</div>
    ${hist.map((l, i) => loanCard(l, false, i + 3)).join('') || `<div class="card anim-in"><p class="muted mb-0">Belum ada riwayat.</p></div>`}`;
  const b = $('#b-ajukan');
  if (b) b.addEventListener('click', () => go('ajukan'));
  const bl = $('#b-lengkapi');
  if (bl) bl.addEventListener('click', (e) => { e.preventDefault(); go('akun'); });
}

let simTimer = null;
async function vAjukan() {
  const me = await api('/api/me');
  main.innerHTML = `
    <div${stagger(0, 'card')}>
      <h3><i class="bi bi-plus-circle-fill me-2" style="color:var(--gold)"></i>Ajukan Pinjaman</h3>
      <div class="kv"><span class="k">Limit kamu</span><span class="v">${fmtRp(me.effectiveLimit ?? me.limit)}${(me.bonusLimit || 0) > 0 ? ` <span class="muted" style="font-size:12px">(termasuk bonus ${fmtRp(me.bonusLimit)})</span>` : ''}</span></div>
      ${!me.pencairan ? '<p class="note warn"><i class="bi bi-exclamation-triangle-fill me-1"></i>Kamu belum mengisi data pencairan. Isi dulu di menu Akun agar pinjaman bisa dicairkan.</p>' : ''}
      <label class="form-label">Jumlah pokok (Rp)</label>
      <input id="a-pokok" class="form-control" type="number" min="1000" step="1000" placeholder="500000">
      <label class="form-label">Tenor: <strong id="a-tenor-lbl" style="color:var(--gold)">30</strong> hari</label>
      <input id="a-tenor" class="form-range" type="range" min="15" max="30" value="30">
      <label class="form-label">Metode pelunasan</label>
      <div class="radio-cards">
        <label><input type="radio" name="a-metode" value="lunas" checked> Sekaligus</label>
        <label><input type="radio" name="a-metode" value="cicilan"> Cicilan</label>
      </div>
      <div id="a-sim"></div>
      <button class="btn btn-primary w-100 mt-3" id="a-submit"><i class="bi bi-send-fill me-2"></i>Kirim Pengajuan</button>
    </div>`;

  const range = $('#a-tenor');
  const paintRange = () => {
    const p = ((range.value - 15) / 15) * 100;
    range.style.setProperty('--fill', p + '%');
  };
  paintRange();

  const renderSim = async () => {
    const pokok = Number($('#a-pokok').value);
    const tenor = Number(range.value);
    $('#a-tenor-lbl').textContent = tenor;
    paintRange();
    if (!pokok || pokok <= 0) { $('#a-sim').innerHTML = ''; return; }
    try {
      const s = await api('/api/simulate', 'POST', {
        pokok, tenorHari: tenor,
        metode: document.querySelector('input[name="a-metode"]:checked').value,
      });
      $('#a-sim').innerHTML = `
        <div class="anim-pop">
        <h4>Simulasi</h4>
        <div class="kv"><span class="k">Bunga (0,2%/hari)</span><span class="v">${fmtRp(s.bunga)}</span></div>
        <div class="kv"><span class="k">Biaya layanan</span><span class="v">${fmtRp(s.biayaLayanan)}</span></div>
        <div class="kv"><span class="k">Total tagihan</span><span class="v big">${fmtRp(s.total)}</span></div>
        ${s.metode === 'cicilan' ? `<div class="kv"><span class="k">Cicilan otomatis</span><span class="v">${s.nCicilan}x</span></div>
        <div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>#</th><th class="text-end">Jumlah</th></tr></thead>
        <tbody>${s.schedule.map((x) => `<tr><td>${x.n}</td><td class="text-end">${fmtRp(x.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h4>Total bayar per metode</h4>
        <div class="kv"><span class="k"><i class="bi bi-wallet2 me-1"></i>Dana / ShopeePay</span><span class="v green">${fmtRp(s.totalBayar.dana)}</span></div>
        <div class="kv"><span class="k"><i class="bi bi-qr-code me-1"></i>QRIS (+1% MDR)</span><span class="v">${fmtRp(s.totalBayar.qris)}</span></div>
        ${s.lebihDariLimit ? '<p class="note warn"><i class="bi bi-exclamation-triangle-fill me-1"></i>Pokok melebihi limit kamu.</p>' : ''}
        <p class="note"><i class="bi bi-info-circle-fill me-1"></i>Tenor final ditentukan admin saat persetujuan (15–30 hari).</p>
        </div>`;
    } catch (e) { $('#a-sim').innerHTML = `<p class="note warn">${esc(e.message)}</p>`; }
  };
  const deb = () => { clearTimeout(simTimer); simTimer = setTimeout(renderSim, 450); };
  $('#a-pokok').addEventListener('input', deb);
  range.addEventListener('input', deb);
  document.querySelectorAll('input[name="a-metode"]').forEach((r) => r.addEventListener('change', renderSim));

  $('#a-submit').addEventListener('click', async () => {
    try {
      await api('/api/loans', 'POST', {
        pokok: Number($('#a-pokok').value),
        tenorHari: Number(range.value),
        metode: document.querySelector('input[name="a-metode"]:checked').value,
      });
      toast('Pengajuan terkirim. Menunggu persetujuan admin.');
      go('bDash');
    } catch (e) { toast(e.message, true); }
  });
}

async function vBayar() {
  const { loans } = await api('/api/loans');
  const berjalan = loans.filter((l) => l.status === 'berjalan');
  const items = [];
  berjalan.forEach((l) => l.schedule.forEach((s, i) => {
    if (s.status === 'belum' || s.status === 'diklaim') items.push({ l, s, i });
  }));
  if (!items.length) {
    main.innerHTML = `<div${stagger(0, 'card')}><p class="muted mb-0"><i class="bi bi-check-circle-fill me-2"></i>Tidak ada tagihan yang perlu dibayar.</p></div>`;
    return;
  }
  main.innerHTML = `<div class="section-title">Tagihan belum dibayar</div>` + items.map(({ l, s, i }, idx) => {
    const key = l.id + '_' + i;
    const title = l.metode === 'cicilan' ? `Cicilan ${s.n}/${l.nCicilan}` : 'Pelunasan';
    if (s.status === 'diklaim') {
      return `<div${stagger(idx, 'card')}><div class="d-flex justify-content-between align-items-center">
        <div><strong>${title}</strong>
        <div class="muted">${fmtRp(l.pokok)} &middot; jatuh tempo ${fmtDate(s.dueDate)}</div></div>
        ${badge('menunggu')}</div>
        <p class="muted mb-0 mt-2"><i class="bi bi-hourglass-split me-1"></i>Laporan bayar ${fmtRp(s.amount)} menunggu konfirmasi admin.</p></div>`;
    }
    return `
    <div${stagger(idx, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-1">
        <div><strong>${title}</strong>
        <div class="muted">Jatuh tempo ${fmtDate(s.dueDate)}${(s.daysLate || 0) > 0 ? ` &middot; <span style="color:var(--danger);font-weight:700">telat ${s.daysLate} hari</span>` : ''}</div></div>
        <div class="text-end"><strong class="fs-5" style="color:var(--gold)">${fmtRp(s.totalDue ?? s.amount)}</strong>
        ${(s.lateFee || 0) > 0 ? `<div class="muted" style="font-size:11px">termasuk denda ${fmtRp(s.lateFee)}</div>` : ''}</div>
      </div>
      <label class="form-label">Metode pembayaran</label>
      <select id="m-${key}" class="form-select">
        <option value="dana">Dana</option>
        <option value="shopeepay">ShopeePay</option>
        <option value="qris">QRIS (+1% MDR)</option>
      </select>
      <div id="info-${key}" class="mt-2"></div>
      <button class="btn btn-primary btn-sm mt-2" data-pay="${key}" data-loan="${l.id}" data-idx="${i}">
        <i class="bi bi-send-fill me-1"></i>Lapor Sudah Bayar
      </button>
    </div>`;
  }).join('');

  const settings = await api('/api/settings').then((j) => j.settings).catch(() => ({}));
  const dest = {
    dana: settings.dana ? 'Dana: <strong>' + esc(settings.dana) + '</strong>' : 'Nomor Dana belum diisi admin',
    shopeepay: settings.shopeepay ? 'ShopeePay: <strong>' + esc(settings.shopeepay) + '</strong>' : 'ShopeePay belum diisi admin',
    qris: settings.qrisNote ? 'QRIS: ' + esc(settings.qrisNote) : 'Info QRIS belum diisi admin',
  };
  const updInfo = (key, s) => {
    const m = $('#m-' + key).value;
    const base = s.totalDue ?? s.amount;
    const total = m === 'qris' ? Math.round(base * 1.01) : base;
    $('#info-' + key).innerHTML = `<div class="pay-info">
      <div><i class="bi bi-arrow-right-circle me-1"></i>${dest[m]}</div>
      ${(s.lateFee || 0) > 0 ? `<div class="muted">Tagihan ${fmtRp(s.amount)} + denda telat ${fmtRp(s.lateFee)} (${s.daysLate} hari × 1%)</div>` : ''}
      <div class="total">Total bayar: ${fmtRp(total)}${m === 'qris' ? ' <span class="muted">(termasuk MDR 1%)</span>' : ''}</div>
      <div class="muted mt-1">Transfer dulu ke tujuan di atas, lalu tekan "Lapor Sudah Bayar".</div>
    </div>`;
  };
  items.forEach(({ l, s, i }) => {
    if (s.status !== 'belum') return;
    const key = l.id + '_' + i;
    $('#m-' + key).addEventListener('change', () => updInfo(key, s));
    updInfo(key, s);
  });
  main.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.pay;
    try {
      await api('/api/payments', 'POST', {
        action: 'claim', loanId: b.dataset.loan,
        schedIdx: Number(b.dataset.idx), payMethod: $('#m-' + key).value,
      });
      toast('Laporan bayar terkirim. Menunggu konfirmasi admin.');
      go('bayar');
    } catch (e) { toast(e.message, true); }
  }));
}

async function vRiwayat() {
  const { loans } = await api('/api/loans');
  const { claims } = await api('/api/payments');
  main.innerHTML = `
    <div class="section-title">Riwayat pembayaran</div>
    ${claims.map((c, i) => `
      <div${stagger(i, 'card')}><div class="d-flex justify-content-between align-items-center">
        <div><strong>${fmtRp(c.amount)}</strong> <span class="muted">${esc(c.payMethod.toUpperCase())}</span>
        <div class="muted">${fmtDate(c.createdAt)}</div></div>${badge(c.status)}</div>
      </div>`).join('') || `<div class="card anim-in"><p class="muted mb-0">Belum ada pembayaran.</p></div>`}
    <div class="section-title">Riwayat pinjaman</div>
    ${loans.map((l, i) => loanCard(l, false, i)).join('') || `<div class="card anim-in"><p class="muted mb-0">Belum ada pinjaman.</p></div>`}`;
}

/* ============ ADMIN ============ */

async function vADash() {
  const st = await api('/api/admin-stats');
  const row = (x, i) => `
    <div${stagger(i, 'card')}><div class="d-flex justify-content-between align-items-center">
      <div><strong>${esc(x.borrowerName)}</strong>
      <div class="muted">${x.loanId}${x.n ? ` &middot; Cicilan ${x.n}/${x.nCicilan}` : ''} &middot; jatuh tempo ${fmtDate(x.dueDate)}${(x.daysLate || 0) > 0 ? ` &middot; <span style="color:var(--danger);font-weight:700">telat ${x.daysLate} hari</span>` : ''}</div></div>
      <div class="text-end"><strong style="color:var(--gold)">${fmtRp(x.totalDue ?? x.amount)}</strong>
      ${(x.lateFee || 0) > 0 ? `<div class="muted" style="font-size:11px">termasuk denda ${fmtRp(x.lateFee)}</div>` : ''}</div></div></div>`;
  const stats = [
    ['Total outstanding', st.outstanding, 'rp', false],
    ['Pinjaman berjalan', st.activeLoans, 'num', false],
    ['Pengajuan menunggu', st.pendingLoans, 'num', false],
    ['Bayar menunggu', st.pendingClaims, 'num', false],
    ['Pendaftar menunggu', st.pendingBorrowers, 'num', false],
    ['Verifikasi data', st.pendingVerifikasi || 0, 'num', (st.pendingVerifikasi || 0) > 0],
    ['Telat bayar', st.late.length, 'num', st.late.length > 0],
  ];
  main.innerHTML = `
    <div class="stat-grid">
      ${stats.map(([l, v, kind, alert], i) => `
        <div${stagger(i, 'stat' + (alert ? ' alert' : ''))}>
          <div class="n" data-count="${v}" data-count-kind="${kind}">…</div><div class="l">${l}</div>
        </div>`).join('')}
    </div>
    ${st.late.length ? `<div class="section-title text-danger">Telat bayar</div>${st.late.map((x, i) => row(x, i)).join('')}` : ''}
    <div class="section-title">Jatuh tempo 7 hari ke depan</div>
    ${st.dueThisWeek.map((x, i) => row(x, i)).join('') || `<div class="card anim-in"><p class="muted mb-0"><i class="bi bi-calendar-check me-2"></i>Tidak ada.</p></div>`}`;
}

async function vPengajuan() {
  const { loans: pending } = await api('/api/loans?status=diajukan');
  const { loans: running } = await api('/api/loans?status=berjalan');
  const { borrowers } = await api('/api/borrowers');
  const pcMap = Object.fromEntries(borrowers.map((b) => [b.phone, b.pencairan]));
  const pcTxt = (phone) => {
    const p = pcMap[phone];
    if (!p) return '<span style="color:var(--danger)">Belum diisi — tidak bisa dicairkan</span>';
    const m = { dana: 'Dana', shopeepay: 'ShopeePay', bank: 'Bank' }[p.metode] || p.metode;
    return `${m}${p.namaBank ? ' ' + esc(p.namaBank) : ''} &middot; ${esc(p.nomor)} &middot; a.n. ${esc(p.atasNama)}`;
  };
  const secPengajuan = '<div class="section-title">Pengajuan pinjaman</div>' + (pending.map((l, i) => `
    <div${stagger(i, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2"><strong>${esc(l.borrowerName)}</strong>${badge(l.status)}</div>
      <div class="kv"><span class="k">Pokok</span><span class="v">${fmtRp(l.pokok)}</span></div>
      <div class="kv"><span class="k">Usulan tenor</span><span class="v">${l.tenorProposal} hari</span></div>
      <div class="kv"><span class="k">Metode</span><span class="v">${l.metode === 'cicilan' ? 'Cicilan' : 'Sekaligus'}</span></div>
      <div class="kv"><span class="k">Pencairan</span><span class="v">${pcTxt(l.borrowerPhone)}</span></div>
      <div class="kv"><span class="k">Diajukan</span><span class="v">${fmtDate(l.createdAt)}</span></div>
      <label class="form-label">Tenor final (15–30 hari)</label>
      <input type="number" id="t-${l.id}" class="form-control" min="15" max="30" value="${l.tenorProposal}">
      <div class="d-flex gap-2 mt-3">
        <button class="btn btn-primary btn-sm flex-fill" data-ok="${l.id}"><i class="bi bi-check-lg me-1"></i>Setujui</button>
        <button class="btn btn-danger btn-sm flex-fill" data-no="${l.id}"><i class="bi bi-x-lg me-1"></i>Tolak</button>
      </div>
    </div>`).join('') || `<div class="card anim-in"><p class="muted mb-0"><i class="bi bi-inbox me-2"></i>Tidak ada pengajuan menunggu.</p></div>`);
  const secBerjalan = '<div class="section-title">Pinjaman berjalan</div>' + (running.map((l, i) => {
    const paid = l.schedule.filter((s) => s.status === 'lunas').length;
    const canCancel = l.schedule.every((s) => s.status === 'belum');
    return `
    <div${stagger(i, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div><strong>${esc(l.borrowerName)}</strong><div class="muted">${l.id} &middot; ${fmtRp(l.total)} &middot; ${paid}/${l.schedule.length} terbayar</div></div>
        ${badge(l.status)}
      </div>
      ${canCancel
        ? `<button class="btn btn-outline-danger btn-sm w-100" data-cancel="${l.id}"><i class="bi bi-x-circle me-1"></i>Batalkan Pinjaman</button>`
        : `<p class="muted mb-0" style="font-size:12px"><i class="bi bi-lock-fill me-1"></i>Tidak bisa dibatalkan: sudah ada pembayaran.</p>`}
    </div>`;
  }).join('') || `<div class="card anim-in"><p class="muted mb-0"><i class="bi bi-inbox me-2"></i>Tidak ada pinjaman berjalan.</p></div>`);
  main.innerHTML = secPengajuan + secBerjalan;
  main.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/loan-action', 'POST', {
        action: 'decide', loanId: b.dataset.ok, approve: true, tenorHari: Number($('#t-' + b.dataset.ok).value),
      });
      toast('Pinjaman disetujui. Jadwal dibuat otomatis.');
      go('pengajuan');
    } catch (e) { toast(e.message, true); }
  }));
  main.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/loan-action', 'POST', { action: 'decide', loanId: b.dataset.no, approve: false });
      toast('Pengajuan ditolak.');
      go('pengajuan');
    } catch (e) { toast(e.message, true); }
  }));
  main.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Batalkan pinjaman ini? Status menjadi dibatalkan dan tidak bisa dikembalikan.')) return;
    try {
      await api('/api/loan-action', 'POST', { action: 'cancel', loanId: b.dataset.cancel });
      toast('Pinjaman dibatalkan.');
      go('pengajuan');
    } catch (e) { toast(e.message, true); }
  }));
}

async function vKlaim() {
  const { claims } = await api('/api/payments?status=menunggu');
  if (!claims.length) { main.innerHTML = `<div${stagger(0, 'card')}><p class="muted mb-0"><i class="bi bi-inbox me-2"></i>Tidak ada laporan bayar menunggu.</p></div>`; return; }
  main.innerHTML = '<div class="section-title">Laporan pembayaran</div>' + claims.map((c, i) => `
    <div${stagger(i, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2"><div>
        <strong>${esc(c.borrowerName)}</strong>
        <div class="muted">${c.loanId} &middot; via ${esc(c.payMethod.toUpperCase())} &middot; ${fmtDate(c.createdAt)}</div>
        ${(c.lateFee || 0) > 0 ? `<div class="muted" style="color:var(--danger)">Tagihan ${fmtRp(c.baseAmount)} + denda ${fmtRp(c.lateFee)} (${c.daysLate} hari telat)</div>` : ''}
      </div><strong class="fs-5" style="color:var(--gold)">${fmtRp(c.amount)}</strong></div>
      <div class="d-flex gap-2">
        <button class="btn btn-primary btn-sm flex-fill" data-ok="${c.id}"><i class="bi bi-check-lg me-1"></i>Terima</button>
        <button class="btn btn-danger btn-sm flex-fill" data-no="${c.id}"><i class="bi bi-x-lg me-1"></i>Tolak</button>
      </div>
    </div>`).join('');
  main.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/payments', 'POST', { action: 'confirm', claimId: b.dataset.ok, approve: true });
      toast('Pembayaran diterima.');
      go('klaim');
    } catch (e) { toast(e.message, true); }
  }));
  main.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/payments', 'POST', { action: 'confirm', claimId: b.dataset.no, approve: false });
      toast('Laporan ditolak.');
      go('klaim');
    } catch (e) { toast(e.message, true); }
  }));
}

async function vPeminjam() {
  const { borrowers } = await api('/api/borrowers');
  const pend = borrowers.filter((b) => b.status === 'pending');
  const act = borrowers.filter((b) => b.status === 'active');
  main.innerHTML = `
    <div class="section-title">Menunggu persetujuan (${pend.length})</div>
    ${pend.map((b, i) => `
      <div${stagger(i, 'card')}><div class="d-flex justify-content-between align-items-center mb-2"><div>
        <strong>${esc(b.name)}</strong><div class="muted">${esc(b.phone)} &middot; daftar ${fmtDate(b.createdAt)}</div>
      </div>${badge(b.status)}</div>
        <label class="form-label">Limit (Rp)</label>
        <input type="number" id="l-${b.phone}" class="form-control" min="1000" step="1000" value="1000000">
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-primary btn-sm flex-fill" data-ok="${b.phone}"><i class="bi bi-check-lg me-1"></i>Setujui</button>
          <button class="btn btn-danger btn-sm flex-fill" data-no="${b.phone}"><i class="bi bi-x-lg me-1"></i>Tolak</button>
        </div>
        <button class="btn btn-outline-danger btn-sm w-100 mt-2" data-del="${b.phone}"><i class="bi bi-trash-fill me-1"></i>Hapus Akun</button>
      </div>`).join('') || `<div class="card anim-in"><p class="muted mb-0">Tidak ada.</p></div>`}
    <div class="section-title">Peminjam aktif (${act.length})</div>
    ${act.map((b, i) => `
      <div${stagger(i, 'card')}><div class="d-flex justify-content-between align-items-center mb-2"><div>
        <strong>${esc(b.name)}</strong> ${b.rank ? `<span class="badge" style="background:#e8c26a22;color:var(--gold);border:1px solid #e8c26a66"><i class="bi bi-award me-1"></i>${esc(b.rank)}</span>` : ''}
        <div class="muted">${esc(b.phone)} &middot; ${b.stats.payments}x bayar &middot; ${b.stats.loansLunas}x lunas &middot; ${fmtRp(b.stats.totalPinjam)} dipinjam</div>
      </div>${badge(b.status)}</div>
        <label class="form-label">Limit (Rp)</label>
        <div class="d-flex gap-2"><input type="number" id="l-${b.phone}" class="form-control" value="${b.limit}">
        <button class="btn btn-outline-light btn-sm" data-lim="${b.phone}">Simpan</button></div>
        <button class="btn btn-outline-danger btn-sm w-100 mt-2" data-del="${b.phone}"><i class="bi bi-trash-fill me-1"></i>Hapus Akun</button>
      </div>`).join('') || `<div class="card anim-in"><p class="muted mb-0">Belum ada.</p></div>`}`;
  main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Hapus akun ${b.dataset.del} permanen? Data akun hilang, riwayat pinjaman tetap tersimpan.`)) return;
    try {
      await api('/api/borrowers', 'POST', { action: 'delete', phone: b.dataset.del });
      toast('Akun dihapus.');
      go('peminjam');
    } catch (e) { toast(e.message, true); }
  }));
  main.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/borrowers', 'POST', { phone: b.dataset.ok, approve: true, limit: Number($('#l-' + b.dataset.ok).value) });
      toast('Peminjam disetujui.');
      go('peminjam');
    } catch (e) { toast(e.message, true); }
  }));
  main.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/borrowers', 'POST', { phone: b.dataset.no, approve: false });
      toast('Pendaftaran ditolak.');
      go('peminjam');
    } catch (e) { toast(e.message, true); }
  }));
  main.querySelectorAll('[data-lim]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/borrowers', 'POST', { phone: b.dataset.lim, approve: true, limit: Number($('#l-' + b.dataset.lim).value) });
      toast('Limit diperbarui.');
    } catch (e) { toast(e.message, true); }
  }));
}

async function vPengaturan() {
  const { settings } = await api('/api/settings');
  main.innerHTML = `
    <div${stagger(0, 'card')}><h3><i class="bi bi-gear-fill me-2" style="color:var(--gold)"></i>Info Pembayaran</h3>
      <p class="muted">Ditampilkan ke peminjam saat bayar.</p>
      <label class="form-label"><i class="bi bi-wallet2 me-1"></i>Nomor Dana</label>
      <input id="s-dana" class="form-control" value="${esc(settings.dana)}" placeholder="08xxxxxxxxxx">
      <label class="form-label"><i class="bi bi-bag-fill me-1"></i>ShopeePay (nomor / ID)</label>
      <input id="s-shopeepay" class="form-control" value="${esc(settings.shopeepay)}" placeholder="08xxxxxxxxxx">
      <label class="form-label"><i class="bi bi-qr-code me-1"></i>Info QRIS (teks / link gambar)</label>
      <textarea id="s-qris" class="form-control" rows="2" placeholder="cth: QRIS atas nama ...">${esc(settings.qrisNote)}</textarea>
      <button class="btn btn-primary w-100 mt-3" id="s-save"><i class="bi bi-check-lg me-2"></i>Simpan</button>
    </div>`;
  $('#s-save').addEventListener('click', async () => {
    try {
      await api('/api/settings', 'POST', {
        dana: $('#s-dana').value, shopeepay: $('#s-shopeepay').value, qrisNote: $('#s-qris').value,
      });
      toast('Pengaturan disimpan.');
    } catch (e) { toast(e.message, true); }
  });
}

/** Kompres foto dari HP sebelum dikirim (maks 1024px, JPEG). */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.72));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto tidak terbaca.')); };
    img.src = url;
  });
}

const PF_STATUS = {
  belum: '<span class="badge b-belum">Belum diisi</span>',
  menunggu: '<span class="badge b-menunggu">Menunggu verifikasi</span>',
  disetujui: '<span class="badge b-diterima">Disetujui</span>',
  ditolak: '<span class="badge b-ditolak">Ditolak — kirim ulang</span>',
};

async function vAkun() {
  const d = await api('/api/profile');
  const pct = d.maxBonus ? Math.round((d.bonus / d.maxBonus) * 100) : 0;
  const inputFor = (f, cur) => {
    const id = 'pf-' + f.key;
    const v = cur.value;
    if (f.type === 'select') {
      return `<select id="${id}" class="form-select">${f.options.map((o) => `<option ${v === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    }
    if (f.type === 'date') return `<input id="${id}" type="date" class="form-control" value="${esc(v)}">`;
    if (f.type === 'number') return `<input id="${id}" type="number" class="form-control" value="${esc(v)}" min="17" max="100">`;
    if (f.type === 'textarea') return `<textarea id="${id}" class="form-control" rows="2">${esc(v)}</textarea>`;
    if (f.type === 'photo') {
      return `${v ? `<a href="${v}" target="_blank" rel="noopener"><img src="${v}" class="photo-thumb mb-2" alt="${esc(f.label)}"></a>` : ''}
        <input id="${id}" type="file" class="form-control" accept="image/*" capture="environment">`;
    }
    return `<input id="${id}" type="text" class="form-control" value="${esc(v)}">`;
  };
  main.innerHTML = `
    <div${stagger(0, 'card')}>
      <h3><i class="bi bi-person-fill me-2" style="color:var(--gold)"></i>Akun Saya</h3>
      <div class="kv"><span class="k">Nama</span><span class="v">${esc(d.name)}</span></div>
      <div class="kv"><span class="k">No. HP</span><span class="v">${esc(d.phone)}</span></div>
      <div class="kv"><span class="k">Limit dasar</span><span class="v">${fmtRp(d.limit)}</span></div>
      <div class="kv"><span class="k">Bonus data</span><span class="v" style="color:var(--gold)">+${fmtRp(d.bonus)}</span></div>
      <div class="kv"><span class="k">Limit efektif</span><span class="v big">${fmtRp(d.effectiveLimit)}</span></div>
      <div class="progress mt-2" style="height:10px;background:#0e1712"><div class="progress-bar" style="width:${pct}%;background:linear-gradient(90deg,var(--emerald),var(--gold))"></div></div>
      <p class="muted mt-1 mb-0" style="font-size:12px">Bonus ${fmtRp(d.bonus)} dari maks ${fmtRp(d.maxBonus)}. Setiap data diverifikasi manual oleh admin sebelum bonus aktif.</p>
    </div>
    <div${stagger(1, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h3 class="mb-0"><i class="bi bi-send-fill me-2" style="color:var(--gold)"></i>Data Pencairan</h3>
        ${d.pencairan ? '<span class="badge b-diterima">Terisi</span>' : '<span class="badge b-ditolak">Wajib diisi</span>'}
      </div>
      <p class="muted">Tujuan pengiriman dana saat pinjaman disetujui. Wajib diisi sebelum pencairan.</p>
      <label class="form-label">Metode</label>
      <select id="pc-metode" class="form-select">
        <option value="dana" ${d.pencairan && d.pencairan.metode === 'dana' ? 'selected' : ''}>Dana</option>
        <option value="shopeepay" ${d.pencairan && d.pencairan.metode === 'shopeepay' ? 'selected' : ''}>ShopeePay</option>
        <option value="bank" ${d.pencairan && d.pencairan.metode === 'bank' ? 'selected' : ''}>Bank (ATM)</option>
      </select>
      <div id="pc-bank-wrap" class="${d.pencairan && d.pencairan.metode === 'bank' ? '' : 'hidden'}">
        <label class="form-label">Nama bank</label>
        <input id="pc-bank" class="form-control" value="${esc(d.pencairan ? d.pencairan.namaBank : '')}" placeholder="cth: BCA">
      </div>
      <label class="form-label">Nomor tujuan (HP / rekening)</label>
      <input id="pc-nomor" class="form-control" inputmode="numeric" value="${esc(d.pencairan ? d.pencairan.nomor : '')}" placeholder="08xxxxxxxxxx / nomor rekening">
      <label class="form-label">Atas nama</label>
      <input id="pc-nama" class="form-control" value="${esc(d.pencairan ? d.pencairan.atasNama : '')}" placeholder="Nama pemilik akun">
      <button class="btn btn-primary btn-sm mt-3" id="pc-save"><i class="bi bi-check-lg me-1"></i>Simpan Data Pencairan</button>
    </div>
    <div class="section-title">Data Diri</div>
    ${d.fields.map((f, i) => {
      const cur = d.profile[f.key] || { value: '', status: 'belum' };
      return `
      <div${stagger(i + 2, 'card')}>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>${esc(f.label)} <span class="muted" style="font-size:12px">+${fmtRp(f.bonus)}</span></strong>
          ${PF_STATUS[cur.status] || PF_STATUS.belum}
        </div>
        ${inputFor(f, cur)}
        <button class="btn btn-primary btn-sm mt-2" data-pfsend="${f.key}">
          <i class="bi bi-send-fill me-1"></i>${cur.status === 'belum' ? 'Kirim' : 'Kirim Ulang'}
        </button>
      </div>`;
    }).join('')}`;

  $('#pc-metode').addEventListener('change', (e) => {
    $('#pc-bank-wrap').classList.toggle('hidden', e.target.value !== 'bank');
  });
  $('#pc-save').addEventListener('click', async () => {
    try {
      await api('/api/profile', 'POST', {
        action: 'pencairan', metode: $('#pc-metode').value, nomor: $('#pc-nomor').value,
        atasNama: $('#pc-nama').value, namaBank: $('#pc-bank').value,
      });
      toast('Data pencairan tersimpan.');
      go('akun');
    } catch (e) { toast(e.message, true); }
  });

  main.querySelectorAll('[data-pfsend]').forEach((btn) => btn.addEventListener('click', async () => {
    const key = btn.dataset.pfsend;
    const f = d.fields.find((x) => x.key === key);
    let value;
    if (f.type === 'photo') {
      const file = $('#pf-' + key).files[0];
      if (!file) return toast('Pilih foto dulu.', true);
      btn.disabled = true;
      const old = btn.innerHTML; btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Memproses…';
      try { value = await compressImage(file); }
      catch (e) { btn.disabled = false; btn.innerHTML = old; return toast(e.message, true); }
      btn.innerHTML = old;
    } else {
      value = $('#pf-' + key).value;
    }
    btn.disabled = true;
    try {
      await api('/api/profile', 'POST', { field: key, value });
      toast('Data terkirim. Menunggu verifikasi admin.');
      go('akun');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  }));
}

async function vVerifikasi() {
  const { borrowers } = await api('/api/borrowers');
  const pending = [];
  for (const b of borrowers) {
    if (b.status !== 'active') continue;
    const d = await api('/api/profile?phone=' + encodeURIComponent(b.phone)).catch(() => null);
    if (!d) continue;
    const fields = d.fields.filter((f) => (d.profile[f.key] || {}).status === 'menunggu');
    if (fields.length) pending.push({ b, d, fields });
  }
  if (!pending.length) {
    main.innerHTML = `<div${stagger(0, 'card')}><p class="muted mb-0"><i class="bi bi-patch-check-fill me-2"></i>Tidak ada data menunggu verifikasi.</p></div>`;
    return;
  }
  main.innerHTML = '<div class="section-title">Verifikasi data (' + pending.reduce((a, p) => a + p.fields.length, 0) + ')</div>' +
    pending.map(({ b, d, fields }, pi) => `
    <div${stagger(pi, 'card')}>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div><strong>${esc(b.name)}</strong><div class="muted">${esc(b.phone)}</div></div>
        <span class="badge b-menunggu">${fields.length} menunggu</span>
      </div>
      ${fields.map((f) => {
        const cur = d.profile[f.key];
        const valHtml = f.type === 'photo'
          ? `<a href="${cur.value}" target="_blank" rel="noopener"><img src="${cur.value}" class="photo-thumb" alt="${esc(f.label)}"></a>`
          : `<div class="verify-val">${esc(String(cur.value))}</div>`;
        return `<div class="verify-row">
          <div class="flex-fill">${valHtml}<div class="muted" style="font-size:12px">${esc(f.label)} &middot; bonus ${fmtRp(f.bonus)}</div></div>
          <div class="d-flex gap-2 align-items-start">
            <button class="btn btn-primary btn-sm" data-vok="${esc(b.phone)}|${f.key}" title="Setujui"><i class="bi bi-check-lg"></i></button>
            <button class="btn btn-danger btn-sm" data-vno="${esc(b.phone)}|${f.key}" title="Tolak"><i class="bi bi-x-lg"></i></button>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');

  main.querySelectorAll('[data-vok],[data-vno]').forEach((btn) => btn.addEventListener('click', async () => {
    const [phone, field] = (btn.dataset.vok || btn.dataset.vno).split('|');
    const approve = !!btn.dataset.vok;
    if (!approve && !confirm('Tolak data ini? Peminjam bisa kirim ulang.')) return;
    btn.disabled = true;
    try {
      await api('/api/profile', 'POST', { action: 'verify', phone, field, approve });
      toast(approve ? 'Data disetujui. Bonus limit aktif.' : 'Data ditolak.');
      go('verifikasi');
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  }));
}

async function vNotif() {
  const { notifications } = await api('/api/notifications');
  if (!notifications.length) {
    main.innerHTML = `<div${stagger(0, 'card')}><p class="muted mb-0"><i class="bi bi-bell me-2"></i>Belum ada notifikasi.</p></div>`;
    return;
  }
  main.innerHTML = '<div class="section-title">Notifikasi</div>' + notifications.map((n, i) => `
    <div${stagger(i, 'card' + (n.read ? '' : ' notif-unread'))}>
      <div class="d-flex gap-2">
        <i class="bi bi-megaphone-fill mt-1" style="color:var(--gold)"></i>
        <div class="flex-fill">
          <p class="mb-1" style="white-space:pre-wrap">${esc(n.message)}</p>
          <div class="muted">${fmtDate(n.createdAt)}${n.read ? '' : ' &middot; <strong style="color:var(--gold)">Baru</strong>'}</div>
        </div>
      </div>
    </div>`).join('');
  // Buka halaman ini = tandai semua sudah dibaca
  api('/api/notifications', 'POST', { action: 'readAll' }).then(refreshNotifBadge).catch(() => {});
}

async function vBroadcast() {
  const { borrowers } = await api('/api/borrowers');
  const { history } = await api('/api/notifications');
  const act = borrowers.filter((b) => b.status === 'active');
  main.innerHTML = `
    <div${stagger(0, 'card')}>
      <h3><i class="bi bi-megaphone-fill me-2" style="color:var(--gold)"></i>Broadcast Notifikasi</h3>
      <label class="form-label">Kirim ke</label>
      <div class="radio-cards">
        <label><input type="radio" name="bc-mode" value="all" checked> Semua user</label>
        <label><input type="radio" name="bc-mode" value="selected"> User tertentu</label>
      </div>
      <div id="bc-users" class="hidden mt-2">
        ${act.map((b) => `<label class="d-flex align-items-center gap-2 mb-1"><input type="checkbox" class="form-check-input bc-chk" value="${esc(b.phone)}"> ${esc(b.name)} <span class="muted">${esc(b.phone)}</span></label>`).join('') || '<p class="muted mb-0">Tidak ada user aktif.</p>'}
      </div>
      <label class="form-label">Pesan</label>
      <div class="d-flex gap-2 mb-2">
        <button class="btn btn-outline-light btn-sm" id="bc-tpl-due"><i class="bi bi-alarm me-1"></i>Template jatuh tempo</button>
        <button class="btn btn-outline-light btn-sm" id="bc-tpl-info"><i class="bi bi-info-circle me-1"></i>Template info</button>
      </div>
      <textarea id="bc-msg" class="form-control" rows="4" maxlength="500" placeholder="Tulis pesan untuk peminjam…"></textarea>
      <button class="btn btn-primary w-100 mt-3" id="bc-send"><i class="bi bi-send-fill me-2"></i>Kirim Broadcast</button>
    </div>
    <div class="section-title">Riwayat broadcast</div>
    ${history.map((h, i) => `
      <div${stagger(i + 1, 'card')}>
        <div class="d-flex justify-content-between"><strong>${esc(h.targetName || h.to)}</strong><span class="muted">${fmtDate(h.createdAt)}</span></div>
        <p class="mb-0 mt-1" style="white-space:pre-wrap">${esc(h.message)}</p>
      </div>`).join('') || `<div class="card anim-in"><p class="muted mb-0">Belum ada broadcast.</p></div>`}`;

  bindAll('input[name="bc-mode"]', 'change', () => {
    const sel = document.querySelector('input[name="bc-mode"]:checked').value === 'selected';
    $('#bc-users').classList.toggle('hidden', !sel);
  });
  $('#bc-tpl-due').addEventListener('click', () => {
    $('#bc-msg').value = 'Pengingat: tagihan/cicilan Anda jatuh tempo dalam waktu dekat. Mohon segera lakukan pembayaran agar terhindar dari denda 1%/hari. Terima kasih.';
  });
  $('#bc-tpl-info').addEventListener('click', () => { $('#bc-msg').value = 'Info Pinjaman Teman: '; $('#bc-msg').focus(); });
  $('#bc-send').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="bc-mode"]:checked').value;
    const message = $('#bc-msg').value.trim();
    if (message.length < 3) return toast('Pesan terlalu pendek.', true);
    const phones = [...document.querySelectorAll('.bc-chk:checked')].map((c) => c.value);
    if (mode === 'selected' && !phones.length) return toast('Pilih minimal satu user.', true);
    if (!confirm('Kirim broadcast ini?')) return;
    try {
      const r = await api('/api/notifications', 'POST', { mode, phones, message });
      toast(`Broadcast terkirim (${r.sent} notifikasi).`);
      go('broadcast');
    } catch (e) { toast(e.message, true); }
  });
}

const VIEWS = {
  login: vLogin, register: vRegister,
  bDash: vBDash, ajukan: vAjukan, bayar: vBayar, riwayat: vRiwayat, akun: vAkun, notif: vNotif,
  aDash: vADash, pengajuan: vPengajuan, klaim: vKlaim, peminjam: vPeminjam, verifikasi: vVerifikasi, broadcast: vBroadcast, pengaturan: vPengaturan,
};

$('#btnLogout').addEventListener('click', logout);
$('#btnNotif').addEventListener('click', () => go('notif'));
$('#footVer').textContent = 'Pinjaman Teman v' + APP_VERSION;
$('#footYear').textContent = new Date().getFullYear();

(async function init() {
  if (!S.token) return go('login');
  try {
    const me = await api('/api/me');
    S.role = me.role; S.name = me.name; S.phone = me.phone;
    showStorageWarn(me.storage === 'memory');
    go(S.role === 'admin' ? 'aDash' : 'bDash');
  } catch { go('login'); }
})();
