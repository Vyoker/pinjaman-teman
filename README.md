# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana, ShopeePay, atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.9.3

- **Langganan (subscription):** dua paket bulanan — Lite Rp10.000/bulan
  (bonus limit +Rp5.000 setiap pelunasan, jeda pengajuan baru 48 jam) dan
  PRO Rp25.000/bulan (bonus +Rp10.000 setiap pelunasan, jeda 24 jam).
  Tanpa langganan, jeda tetap 72 jam dan tidak ada bonus.
- **Bayar manual via QRIS:** peminjam membayar lewat QRIS di menu Langganan
  (sama seperti bayar pinjaman), lalu menghubungi admin. Admin mengaktifkan
  paketnya dari menu Peminjam — berlaku 30 hari sejak diaktifkan; atur ulang
  paket yang sama = perpanjang 30 hari. Bonus limit yang sudah terkumpul
  tetap tersimpan walau langganan habis.
- Menu Langganan baru di peminjam: status paket & masa berlaku, bonus
  terkumpul, perbandingan paket, dan QRIS. Admin melihat badge paket di kartu
  peminjam (Lite/PRO) beserta masa berlaku dan bonus terkumpul.
- Pembatasan akun tetap ada: admin bisa batasi/lepas akun dari menu Peminjam;
  peminjam yang dibatasi melihat tombol Ajukan abu-abu bergembok.

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
