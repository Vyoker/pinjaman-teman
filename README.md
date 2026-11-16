# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana, ShopeePay, atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.9.2

- **Pembatasan akun oleh admin:** di menu Peminjam, tiap kartu peminjam aktif
  kini ada tombol "Batasi Akun" (dan "Lepas Pembatasan" kalau sudah dibatasi),
  plus badge "Dibatasi" di kartu yang sedang dibatasi. Admin bisa memilih
  user mana saja dan melepas pembatasannya kembali kapan saja. Peminjam
  mendapat notifikasi in-app saat dibatasi maupun saat dilepas, dan aksi ini
  tercatat di audit log.
- **Di sisi peminjam yang dibatasi:** tombol "Ajukan Pinjaman" berubah jadi
  abu-abu dengan gambar kunci gembok dan tidak bisa ditekan, baik di dashboard
  maupun di halaman Ajukan. Server juga menolak pengajuan dari akun yang
  dibatasi, jadi tidak bisa diakali lewat jalur lain. Login dan pembayaran
  pinjaman berjalan tetap bisa seperti biasa.
- Perbaikan bug nominal dashboard (v2.9.1): outstanding, daftar telat, pesan
  pengingat, dan "Sudah dibayar" kini memakai sisa pokok setelah bayar
  sebagian, plus baris baru "Sisa tagihan" di kartu pinjaman admin.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
