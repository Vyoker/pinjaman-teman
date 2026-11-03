# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman. Bayar via Dana, ShopeePay, atau QRIS
(QRIS +1% MDR). Denda telat 1% per hari dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.6

- **Rank dirombak total (berlaku juga untuk yang sudah punya rank):**
  dihitung dari jumlah pelunasan penuh — Bronze 5x (bonus limit +Rp 10.000),
  Silver 10x (+Rp 15.000), Gold 15x (+Rp 20.000), Platinum 20x (+Rp 25.000),
  Diamond 25x (+Rp 50.000), KING 30x (+Rp 100.000).
- **Admin bisa melihat data lengkap tiap peminjam** — semua data diri,
  data pencairan, dan mengunduh foto KTP/KK.
- **Lupa password:** peminjam mengajukan reset dari halaman login, admin
  menetapkan password baru. Kata sandi tidak bisa dilihat siapa pun karena
  tersimpan terenkripsi.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
