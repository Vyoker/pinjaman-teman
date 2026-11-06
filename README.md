# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana, ShopeePay, atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.9

- **Pengajuan pakai input, bukan slider:** nominal pokok kini diketik langsung
  (format ribuan otomatis), minimal Rp10.000 dan tidak boleh melebihi total
  limit — batas ini juga dijaga server, jadi pengajuan di bawah Rp10.000
  ditolak. Kalau limit belum mencapai Rp10.000, pengajuan tetap terkunci
  sampai admin mengatur limit.
- **Tema neo-brutalism:** seluruh tampilan dirombak — border tebal, bayangan
  keras, sudut lebih tegas, tombol terasa ditekan saat disentuh. Warna gradasi
  emerald/emas yang sudah dipakai tetap dipertahankan.
- **Background garis list transparan:** latar belakang kini memakai garis-garis
  horizontal transparan (seperti garis buku catatan) di atas gradasi gelap.
- Bayar sebagian tunai via admin tetap ada: tombol "Bayar Sebagian" di kartu
  pinjaman, denda 1%/hari dihitung dari sisa, alokasi denda dulu baru pokok.
  Pinjaman berjalan menyelesaikan dengan ketentuannya sendiri; pinjaman baru
  tetap mengikuti aturan tutup buku + biaya pencairan.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
