# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana, ShopeePay, atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.9.1

- **Perbaikan bug nominal dashboard (berlaku untuk semua peminjam):** setelah
  bayar sebagian, dashboard admin masih menghitung dari total awal. Sekarang
  semua nominal memakai sisa pokok: Total outstanding, daftar telat & jatuh
  tempo minggu ini, dan pesan pengingat admin. Contoh Enjang (total
  Rp1.009.000, sudah bayar sebagian Rp50.000): outstanding sekarang
  Rp959.000 (bukan Rp1.009.000), dan kalau telat 4 hari totalnya Rp997.360
  (denda Rp38.360 dari sisa, bukan Rp1.049.360).
- Kartu pinjaman admin kini menampilkan "Sudah dibayar" yang menghitung
  bayar sebagian juga (sebelumnya Rp0 padahal sudah ada bayar sebagian),
  plus baris baru "Sisa tagihan" agar sisa yang harus ditagih langsung
  kelihatan.
- Pengajuan pakai input (bukan slider), minimal Rp10.000 dan tidak melebihi
  total limit. Tema neo-brutalism dengan gradasi emerald/emas, background
  garis list transparan.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
