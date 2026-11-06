# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana, ShopeePay, atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.7

- **Biaya pencairan Rp 2.500 per pinjaman** (pengganti biaya transfer saat
  pencairan), ditambahkan ke total tagihan dan tampil sebagai baris sendiri
  di simulasi, kartu pinjaman, dan preview admin. Hanya berlaku untuk
  pinjaman baru yang disetujui setelah v2.7; pinjaman yang sedang berjalan
  tidak berubah. Biaya ini bukan revenue — hanya pengganti biaya transfer.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
