# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana, ShopeePay, atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.8

- **Bayar sebagian tunai via admin:** di menu Tandai Lunas, admin bisa
  mencatat pembayaran sebagian (mis. Rp50.000 dari total Rp1.009.000).
  Sisa tagihan terkunci sebagai basis denda baru — denda 1%/hari dihitung
  dari sisa, bukan dari total awal. Pembayaran dialokasikan ke denda dulu,
  baru ke pokok. Pinjaman tetap berjalan sampai sisa + denda = 0; bayar
  sebagian tidak menambah hitungan rank (rank tetap dari pelunasan penuh).
  Peminjam juga bisa melunasi sisa lewat klaim transfer biasa. Pinjaman
  berjalan menyelesaikan dengan ketentuannya sendiri; pinjaman baru tetap
  mengikuti aturan tutup buku + biaya pencairan.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
