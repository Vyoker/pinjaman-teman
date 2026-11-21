# Pinjaman Teman

Aplikasi pinjaman privat untuk teman dekat. Admin (pemberi pinjaman) mengelola
pendaftaran, limit, persetujuan, dan konfirmasi pembayaran. Teman mendaftar,
mengajukan pinjaman, dan melapor bayar lewat aplikasi.

Pinjaman baru jatuh tempo setiap tanggal 1 bulan berikutnya (tutup buku):
bunga 0,2% per hari dihitung sampai tanggal 1, dibayar sekali lunas.
Biaya layanan Rp 2.000 per pinjaman, biaya pencairan Rp 2.500 per pinjaman.
Bayar via Dana atau QRIS (QRIS +1% MDR). Denda telat 1% per hari
dari tagihan yang lewat jatuh tempo.

## Yang baru di v2.9.6

- **Pet hanya untuk Lite/PRO:** minigame Pet kini hanya bisa dibuka oleh
  pelanggan Lite atau PRO yang masih aktif. Peminjam Free melihat halaman
  "Pet Terkunci" dengan tombol ke menu Langganan. Kalau langganan habis,
  Pet terkunci lagi — pet dan kristalnya tetap tersimpan dan kembali
  terbuka saat berlangganan lagi. Koin yang sudah dimiliki tetap bisa
  dipakai untuk mengurangi pembayaran, walau Pet terkunci.
- **Keterangan Pet di menu Langganan:** tiap paket (Lite/PRO) kini
  menampilkan "Akses Pet: Terbuka" beserta penjelasannya (pet menghasilkan
  kristal, 10.000 kristal = 1 koin = Rp1 potongan bayar).

## Yang baru di v2.9.5

- **ShopeePay dihapus:** bayar hanya via Dana atau QRIS (QRIS +1% MDR),
  pencairan hanya Dana atau Bank. Riwayat lama tetap bisa dibaca.
- **Background grid ala gaming:** grid neon hijau/emas lebih tegas, 6 kotak
  jatuh dari atas sambil berputar dan berdenyut dengan glow.
- **Minigame Pet (menu Pet):** pet level 1-20, merge 2 pet level sama jadi
  1 pet level atas. Pet pertama gratis 1 ekor L1. Beli pet pakai kristal:
  L1 500, L2 1.000 kristal, dst, harga naik x2 tiap sudah beli level sama.
  Produksi: L1 1 kristal/2 detik, L2 2 kristal/detik, L3 4 kristal/detik, dst.
  Farming offline maks 1 jam, standby (aplikasi dibuka) tidak ada batas.
- **Sistem koin:** 10.000 kristal = 1 koin, 1 koin = Rp1 potongan bayar.
  Koin dipakai saat lapor bayar; kalau klaim ditolak admin, koin kembali.

## Yang baru di v2.9.4

- **Background kotak-kotak ala AfiStore:** garis grid hijau membentuk kotak,
  plus 6 kotak melayang yang bergerak halus naik-turun (animasi 11–19 detik,
  warna hijau dipertahankan; garis emas lama dihapus).
- **Menu Langganan compact:** tiap paket kini hanya menampilkan judul
  (nama + harga/bulan) — klik untuk membuka keterangan lengkap (bonus limit,
  jeda pengajuan), lalu tombol "Langganan"/"Perpanjang" pindah ke tampilan
  QRIS paket yang dipilih, lengkap dengan tombol "Pilih paket lain".
- **Slider info di dashboard:** 3 slide untuk informasi terbaru, animasi fade
  dari kanan ke kiri, pindah otomatis tiap 10 detik, bisa diketuk titiknya
  untuk pindah manual. Gambar diambil dari `public/info-1.webp`,
  `public/info-2.webp`, `public/info-3.webp` (WebP, 1464x340 px) — kalau gambar belum ada, tampil
  placeholder "Gambar menyusul". Info 1 (Langganan Lite/PRO) dan info 2 (Gunakan Sesuai
  Keperluan) sudah ada; info 3 masih placeholder.
- Langganan tetap ada: Lite Rp10.000/bulan (+Rp5.000 limit per pelunasan,
  jeda 48 jam), PRO Rp25.000/bulan (+Rp10.000, jeda 24 jam), bayar manual via
  QRIS lalu admin aktifkan dari menu Peminjam (30 hari).

## Catatan

Aplikasi pribadi untuk lingkaran teman dekat saja, dikelola langsung oleh admin.
