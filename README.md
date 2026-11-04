# Auto Skip YouTube Ads (Microsoft Edge & Chrome)

Ekstensi browser berbasis Manifest V3 untuk Microsoft Edge dan Google Chrome yang secara otomatis menekan tombol "Lewati Iklan" (Skip Ad) saat tombol tersebut muncul di YouTube, tanpa memblokir permintaan jaringan iklan.

Dengan metode ini, YouTube tidak akan mendeteksi penggunaan ad-blocker karena video iklan tetap diizinkan dimuat dan diputar secara normal, namun sistem otomatisasi langsung mengeklik tombol skip begitu countdown selesai atau tombol tersedia.

---

## Fitur Utama

- **Otomatis Klik Tombol Skip Murni**: Mendeteksi dan mengeklik tombol lewati iklan secara instan sesaat setelah muncul di layar.
- **Tutup Banner Overlay**: Menutup pop-up banner iklan yang muncul di atas pemutar video secara otomatis.
- **Tanpa Ad-Block Triggers**: Tidak memblokir network request atau script analitik YouTube, sehingga terhindar dari deteksi anti-adblock.
- **Tanpa Stutter / 403 Forbidden**: Membiarkan video iklan mengalir alami pada kecepatan standar tanpa memodifikasi rate buffer CDN, mencegah error buffer macet.
- **Counter Iklan Dilewati**: Menghitung berapa banyak iklan yang telah dilewati secara real-time.
- **Pengaturan Fleksibel**:
  - Auto-Skip Tombol Iklan (Aktif secara default)
  - Tutup Banner Iklan (Aktif secara default)
  - Bisukan Audio Iklan (Opsional)

---

## Cara Memasang di Microsoft Edge

1. Buka browser **Microsoft Edge**.
2. Masuk ke halaman manajemen ekstensi dengan mengetikkan alamat berikut di address bar:
   ```text
   edge://extensions
   ```
3. Di bilah menu sebelah kiri, aktifkan toggle **Mode pengembang** (*Developer mode*).
4. Klik tombol **Muat yang belum dibongkar** (*Load unpacked*) di bagian atas.
5. Pilih folder ekstensi ini:
   ```text
   /home/oktaavsm/Code/github.com/auto-skip-ads-ext
   ```
6. Ekstensi **Auto Skip Ads** sekarang aktif dan siap digunakan.

---

## Cara Memasang di Google Chrome (Opsional)

1. Buka browser **Google Chrome**.
2. Buka URL:
   ```text
   chrome://extensions
   ```
3. Aktifkan **Developer mode** di pojok kanan atas.
4. Klik tombol **Load unpacked** di pojok kiri atas dan pilih folder ekstensi ini.

---

## Struktur Berkas

```text
auto-skip-ads-ext/
|-- manifest.json          # Konfigurasi Manifest V3 ekstensi
|-- content.js             # Skrip automasi deteksi & klik tombol skip murni
|-- popup/
|   |-- popup.html         # Tampilan UI menu kontrol ekstensi
|   |-- popup.css          # Desain dan tata letak UI popup
|   |-- popup.js           # Pengelola logika toggle dan penghitung iklan
|-- icons/
|   |-- icon16.png
|   |-- icon48.png
|   |-- icon128.png
`-- README.md
```

---

## Lisensi

Didistribusikan di bawah lisensi MIT.
