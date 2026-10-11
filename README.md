# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

## Rumus

```
Total tagihan = Pokok + (Pokok x 0,2% x tenor hari) + Rp 2.000 (biaya layanan)
```

- Tenor 15–30 hari, ditentukan admin saat persetujuan.
- Pelunasan: **sekaligus** (1x di akhir tenor) atau **cicilan** (otomatis mingguan:
  jumlah cicilan = tenor / 7 dibulatkan, min. 2x; total dibagi rata, sisa
  pembulatan masuk angsuran terakhir).
- Bayar via Dana / ShopeePay / QRIS. QRIS kena **+1% MDR per transaksi**
  (dihitung dari total tagihan).
- **Denda telat (v1.1)**: 1%/hari (flat, tidak berbunga-berbunga) dari nominal
  tagihan yang lewat jatuh tempo, dihitung per item cicilan. Denda dihitung
  sampai tanggal lapor bayar dan ikut ditagihkan saat pembayaran.
- **Rank (v1.1)**: naik berdasarkan jumlah pembayaran berhasil —
  Bronze 10x, Silver 20x, Gold 30x, Platinum 40x, Diamond 50x.
  Statistik per peminjam (pembayaran berhasil, pinjaman lunas, total pinjam)
  tampil di dashboard.
- **Data diri & bonus limit (v1.2)**: menu Akun berisi 10 data
  (nama lengkap, usia, jenis kelamin, tanggal lahir, no. KK, no. NIK, alamat,
  pekerjaan, foto KTP, foto KK). Tiap data yang **disetujui admin**
  menambah limit: Rp 2.500 (6 data), Rp 5.000 (KK/NIK), Rp 10.000 (foto KTP/KK)
  — maks Rp 45.000. Verifikasi manual satu per satu di menu Verifikasi admin.
- **Kelola pinjaman (v1.3)**: admin bisa membatalkan pinjaman yang sudah
  berjalan (menu Pengajuan) selama belum ada pembayaran sama sekali;
  statistik total pinjam peminjam ikut dikoreksi.
- **Hapus akun (v1.3)**: admin bisa menghapus akun peminjam permanen
  (menu Peminjam); sesi login akun tersebut langsung hangus. Tidak bisa
  dihapus jika masih ada pinjaman aktif — batalkan dulu.

## Arsitektur

- **Frontend**: `public/` — SPA vanilla (HTML/CSS/JS), tanpa build step.
- **Backend**: `api/` — Vercel Serverless Functions (Node, `(req, res)`).
- **Database**: Vercel KV (Redis). Tanpa env KV, otomatis pakai memori
  (hanya untuk dev/tes lokal — data hilang saat restart).

## Struktur API

| Method | Endpoint | Akses | Fungsi |
|---|---|---|---|
| POST | `/api/auth-register` | publik | daftar peminjam (status pending) |
| POST | `/api/auth-login` | publik | login -> token (Bearer) |
| GET | `/api/me` | login | profil sesi |
| GET/POST | `/api/borrowers` | admin | daftar / setujui + atur limit |
| POST | `/api/simulate` | login | simulasi hitungan |
| GET/POST | `/api/loans` | login | daftar / ajukan pinjaman |
| POST | `/api/loan-decide` | admin | setujui (buat jadwal) / tolak |
| GET/POST | `/api/payments` | login | lapor bayar / konfirmasi (admin) |
| GET | `/api/admin-stats` | admin | outstanding, jatuh tempo, telat |
| GET/POST | `/api/settings` | login/admin | info pembayaran (Dana/ShopeePay/QRIS) |

Aturan v1: satu peminjam hanya boleh punya **satu pinjaman aktif** dalam satu waktu.

## Batasan yang disadari (v1)

- Uang bergerak manual (transfer bank/e-wallet di luar aplikasi); aplikasi hanya mencatat.
- Tanpa denda keterlambatan otomatis — admin menindaklanjuti manual.
- Tanpa notifikasi push — peminjam melihat jadwal di aplikasi.
- Sesi 7 hari via token Bearer di `localStorage`.
