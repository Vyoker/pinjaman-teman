# SETUP — Pinjaman Teman di Vercel

## 1. Push ke GitHub (dari Termux)

```bash
cd ~/pinjaman-teman   # sesuaikan path folder project di HP kamu
git init
git add .
git commit -m "Pinjaman Teman v1"
git branch -M main
git remote add origin https://github.com/Vyoker/pinjaman-teman.git
git push -u origin main
```

(Buat repo `pinjaman-teman` dulu di github.com — bisa private.)

## 2. Buat project di Vercel

1. Buka vercel.com → login (bisa pakai akun GitHub).
2. **Add New → Project** → Import repo `pinjaman-teman`.
3. Framework Preset: **Other**. Root Directory: `./` (default).
4. **Environment Variables** — tambahkan:
   - `ADMIN_PHONE` = nomor HP kamu (cth. `081234567890`)
   - `ADMIN_PASSWORD` = password admin yang kuat
5. Klik **Deploy**. Tunggu sampai live, catat URL-nya
   (cth. `https://pinjaman-teman.vercel.app`).

## 3. Aktifkan database (Upstash Redis — pengganti Vercel KV)

> Catatan: Vercel sudah mempensiunkan produk "KV" mandiri. Penggantinya adalah
> **Upstash Redis** dari Marketplace — env var yang diisi otomatis tetap
> `KV_REST_API_URL` dan `KV_REST_API_TOKEN`, jadi kode tidak perlu diubah.

1. Di dashboard project → tab **Storage** → tap **Upstash**.
2. **Create** database Redis baru (nama cth. `pinjaman-kv`, region pilih Singapore).
3. **Connect** / hubungkan ke project `pinjaman-teman`.
4. Vercel otomatis mengisi `KV_REST_API_URL` dan `KV_REST_API_TOKEN`.
5. **Redeploy** project (Deployments → ⋯ → Redeploy) agar env terbaca.

Tanpa langkah ini aplikasi jalan tapi data hanya di memori
(hilang tiap fungsi cold-start, dan sesi login langsung kedaluwarsa)
— JANGAN dipakai produksi.

## 4. Isi info pembayaran (sebagai admin)

1. Buka URL Vercel → login pakai `ADMIN_PHONE` + `ADMIN_PASSWORD`.
2. Menu **Pengaturan** → isi nomor Dana, ShopeePay, info QRIS → Simpan.

## 5. Alur pakai

1. Teman buka URL (atau APK, lihat bawah) → **Daftar**.
2. Kamu (menu **Peminjam**) setujui + atur limit per teman.
3. Teman **Ajukan** pinjaman (lihat simulasi dulu) → kamu setujui di
   menu **Pengajuan** (tenor final 15–30 hari, jadwal dibuat otomatis).
4. Teman transfer manual via Dana/ShopeePay/QRIS → **Bayar** → pilih metode
   → **Lapor Sudah Bayar**.
5. Kamu cek menu **Pembayaran** → **Terima** (pastikan uang masuk dulu).
6. Pantau di **Dashboard**: outstanding, jatuh tempo 7 hari, yang telat.

## 6. Bungkus jadi APK (opsional, via AppMint)

Sama seperti game: buat aplikasi WebView baru di AppMint,
arahkan URL ke `https://pinjaman-teman.vercel.app` (URL Vercel kamu),
lalu build APK dan bagikan ke teman-teman.

## 7. Tes lokal (opsional)

```bash
npm install
npm test   # syntax check + tes logika & alur API (mode memori)
```

## Catatan keamanan

- Jangan sebar `ADMIN_PASSWORD` ke siapa pun.
- Repo GitHub disarankan **private** (tidak wajib, tapi lebih aman).
- `.env` tidak boleh di-commit (sudah ada di `.gitignore`).
