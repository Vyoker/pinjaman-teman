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
- **Data pencairan wajib (v1.4)**: peminjam wajib mengisi tujuan pencairan
  (Dana / ShopeePay / Bank-ATM: nomor + atas nama + nama bank) di menu Akun;
  persetujuan pinjaman terhalang sampai data ini terisi. Admin melihat
  tujuan pencairan di kartu pengajuan.
- **Broadcast notifikasi (v1.4)**: admin bisa mengirim notifikasi in-app
  ke semua user atau user terpilih (menu Broadcast, ada template jatuh
  tempo & info). Peminjam melihatnya via ikon bel dengan lencana jumlah
  belum dibaca.
- **v1.5**: QRIS resmi terpasang sebagai gambar yang bisa di-scan di layar
  bayar (`public/qris.jpg`); kartu pinjaman berjalan di menu Pengajuan
  menampilkan rincian pokok, tenor, bunga, biaya layanan, total, dan
  sudah dibayar; peminjam bisa menghapus akunnya sendiri di menu Akun
  (konfirmasi kata sandi) selama tidak ada tagihan berjalan. Satu peminjam
  tetap hanya boleh punya 1 pinjaman aktif.
- **v1.7**: input jumlah pokok di menu Ajukan diganti jadi slider (garis)
  seperti slider tenor — batas maksimalnya = limit + bonus limit, jadi
  peminjam tidak bisa menggeser melebihi limit. Server tetap memvalidasi
  ulang batas limit saat pengajuan dikirim.
- **v1.8**: rank memberi manfaat nyata — bonus limit permanen per rank
  (Bronze +10rb, Silver +15rb, Gold +20rb, Platinum +25rb, Diamond +50rb)
  yang menambah limit efektif; Platinum membuka tenor hingga 45 hari dan
  Diamond hingga 60 hari (rank lain tetap maks 30 hari). Slider tenor di
  menu Ajukan, validasi pengajuan, simulasi, dan persetujuan admin semuanya
  mengikuti batas tenor rank peminjam; kartu Rank menampilkan bonus dan
  tenor maksimum rank saat ini serta hadiah rank berikutnya.
- **v1.9**: admin bisa menandai pembayaran tunai secara manual — setiap
  tagihan yang belum dibayar di kartu pinjaman berjalan punya tombol
  "Tandai Lunas" (dengan pilihan tanggal bayar dan catatan, mis. cicilan
  minggu pertama). Denda 1%/hari dihitung sampai tanggal bayar, statistik
  pembayaran & rank peminjam ikut bertambah, dan peminjam otomatis menerima
  notifikasi. Pembayaran tunai tampil di riwayat peminjam.
- **v2.0 (keamanan)**: rate limit login — 3x gagal dalam sehari (WIB) kunci
  akun sampai besok; password minimal 8 karakter + ganti password mandiri di
  menu Akun; "logout semua perangkat" atas permintaan peminjam yang disetujui
  admin; rate limit pendaftaran 3x/jam per IP; audit log 100 aksi terakhir
  admin (persetujuan, penolakan, tandai lunas tunai, ubah limit, hapus akun,
  verifikasi data, broadcast) di menu Audit Log; pesan error 500 generik
  (tidak membocorkan detail internal); security headers di vercel.json.
- **v2.1 (gadai barang)**: fitur terpisah dari pinjaman tunai — peminjam
  mengajukan gadai lewat menu Gadai (nama barang, kondisi, foto wajib,
  jumlah diinginkan); admin verifikasi dengan nilai taksir + jumlah
  disetujui (maks 80% taksir) + tenor; setelah disetujui peminjam
  menyerahkan barang fisik, admin tekan "Barang diterima" maka dana cair
  dan tagihan berjalan (rumus bunga/biaya/denda sama); denda 1%/hari
  tetap berjalan selama nunggak dan barang ditahan sampai lunas penuh;
  setelah lunas admin tekan "Barang dikembalikan". Slot aktif terpisah
  (1 tunai + 1 gadai boleh jalan bareng); menu Bayar dibagi 2 seksi
  (Pinjaman Tunai & Gadai Barang).

## Arsitektur

- **Frontend**: `public/` — SPA vanilla (HTML/CSS/JS), tanpa build step.
- **Backend**: `api/` — Vercel Serverless Functions (Node, `(req, res)`).
- **Database**: Vercel KV (Redis). Tanpa env KV, otomatis pakai memori
  (hanya untuk dev/tes lokal — data hilang saat restart).

## Struktur API

| Method | Endpoint | Akses | Fungsi |
|---|---|---|---|
| POST | `/api/auth` | publik | `{action:'register'}` daftar peminjam (pending) / `{action:'login'}` login -> token |
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
