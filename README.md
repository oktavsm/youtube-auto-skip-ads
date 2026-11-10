# Auto Skip YouTube Ads

Ekstensi browser berbasis **Manifest V3** untuk Microsoft Edge dan Google Chrome yang secara otomatis melewati iklan di YouTube (baik iklan skippable maupun iklan non-skippable 5s / 15s) serta mencegah jeda otomatis saat layar ditinggal (*anti-idle pause* "Video paused. Continue watching?"), tanpa memblokir permintaan jaringan iklan (*network request*).

Dengan kombinasi **Trusted ProxyEvent**, **Direct Seek Completion**, dan **Proactive Activity Keep-Alive**, YouTube tidak akan mendeteksi penggunaan ad-blocker karena video iklan tetap diizinkan dimuat secara normal, sementara pemutaran video terus berlanjut tanpa gangguan.

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Arsitektur Teknis](#arsitektur-teknis)
- [Struktur Berkas](#struktur-berkas)
- [Panduan Pemasangan](#panduan-pemasangan)
  - [Microsoft Edge](#microsoft-edge)
  - [Google Chrome](#google-chrome)
- [Privasi & Keamanan](#privasi--keamanan)
- [Lisensi](#lisensi)

---

## Fitur Utama

- **Otomatis Klik Tombol Skip Murni**: Mengeksekusi aksi lewati iklan seketika tombol "Lewati Iklan" (*Skip Ad*) aktif di detik ke-5 atau setelah hitungan mundur selesai.
- **Lewati Iklan Non-Skip (5s / 15s)**: Mendeteksi iklan yang tidak memiliki tombol lewati (seperti bumper ad 5-6 detik atau iklan non-skippable 15 detik), dan langsung melompatkan durasi ke detik akhir (`duration - 0.1`) sehingga iklan selesai instan dalam 0.1 detik.
- **Cegah Jeda Otomatis (Anti-Idle Pause)**: Mencegah dan secara otomatis melanjutkan pemutaran saat dialog *"Video paused. Continue watching?"* / *"Video dijeda. Lanjutkan menonton?"* muncul, sehingga video atau musik dapat diputar terus-menerus tanpa henti.
- **Dukungan Multi-Iklan**: Menangani rangkaian iklan beruntun (*Ad 1 of 2* dan *Ad 2 of 2*) secara otomatis tanpa henti.
- **Bypass Proteksi isTrusted YouTube**: Memanfaatkan injeksi konteks `world: "MAIN"` dan `ProxyEvent` untuk memicu handler klik internal player YouTube (`Nqb.onClick`) secara sah tanpa diblokir oleh anti-bot.
- **Tutup Banner Overlay**: Otomatis menutup banner iklan pop-up yang menutupi area bawah video.
- **Pengatur Kecepatan Iklan (1x - 16x)**: Pilihan untuk memutar video iklan lebih cepat dengan perlindungan *auto-ease* di detik akhir agar buffer video tidak macet.
- **Bisukan Audio Iklan (Auto-Mute)**: Opsi membisukan suara iklan secara otomatis selama iklan berlangsung dan mengembalikan volume saat video utama mulai.
- **Statistik & Penghitung Real-Time**: Melacak jumlah iklan yang berhasil dilewati melalui antarmuka popup yang bersih dan modern.
- **Bebas Deteksi Anti-Adblock**: Tidak memblokir traffic CDN atau domain analitik, menjaga kestabilan pemutaran video tanpa peringatan larangan ad-blocker.

---

## Arsitektur Teknis

Ekstensi ini dirancang menggunakan arsitektur modular dua lapis (*Dual-World Architecture*) agar kompatibel penuh dengan standar keamanan Manifest V3:

```text
[ Browser Context ]
  |
  +-- Injected Script (world: "MAIN")
  |     - Berjalan langsung di eksekusi utama YouTube
  |     - Menangkap listener klik asli via EventTarget.prototype.addEventListener
  |     - Membungkus MouseEvent dengan ProxyEvent (isTrusted: true, composedPath)
  |     - Mengeksekusi Nqb.onClick langsung pada tombol .ytp-skip-ad-button
  |     - Melompatkan durasi iklan non-skippable secara native
  |     - Memperbarui window._lact berkala untuk mencegah pemicu dialog idle
  |     - Mengonfirmasi dialog "Continue watching" dan melanjutkan pemutaran seketika
  |
  +-- Content Script (Isolated World)
  |     - Mengelola preferensi pengguna (toggle unskippable, anti-idle, speed, mute, banner)
  |     - Menyimpan data statistik ke chrome.storage.local
  |     - Mengawasi DOM dan mendeteksi kondisi iklan serta dialog idle
  |
  +-- Extension Popup (Action UI)
        - Antarmuka tema gelap (Dark Theme)
        - Sinkronisasi pengaturan real-time melalui onChanged storage
```

---

## Struktur Berkas

```text
auto-skip-ads-ext/
|-- manifest.json          # Konfigurasi Manifest V3 ekstensi
|-- injected.js            # Engine eksekusi ProxyEvent di Main World
|-- content.js             # Kontroler pemutar, audio, banner, dan storage di Isolated World
|-- popup/
|   |-- popup.html         # Tampilan UI menu kontrol ekstensi
|   |-- popup.css          # Desain dan tata letak UI popup
|   |-- popup.js           # Pengelola logika toggle dan penghitung iklan
|-- icons/
|   |-- icon16.png
|   |-- icon48.png
|   |-- icon128.png
|-- LICENSE                # Lisensi open-source MIT
`-- README.md              # Dokumentasi proyek
```

---

## Panduan Pemasangan

### Microsoft Edge

1. Buka browser **Microsoft Edge**.
2. Masuk ke halaman ekstensi dengan mengetikkan alamat berikut di bilah alamat (*address bar*):
   ```text
   edge://extensions
   ```
3. Di bilah menu sebelah kiri, aktifkan sakelar **Mode pengembang** (*Developer mode*).
4. Klik tombol **Muat yang belum dibongkar** (*Load unpacked*) di bagian atas.
5. Pilih folder repositori ini:
   ```text
   /path/ke/auto-skip-ads-ext
   ```
6. Ekstensi **Auto Skip YouTube Ads** kini aktif dan siap digunakan.

### Google Chrome

1. Buka browser **Google Chrome**.
2. Buka URL manajemen ekstensi:
   ```text
   chrome://extensions
   ```
3. Aktifkan sakelar **Developer mode** di pojok kanan atas.
4. Klik tombol **Load unpacked** di pojok kiri atas, lalu pilih folder repositori ini.
5. Ekstensi akan langsung terpasang dan aktif di tab YouTube.

---

## Privasi & Keamanan

- **100% Berjalan Lokal**: Seluruh logika deteksi dan otomasi dieksekusi secara lokal di dalam browser pengguna.
- **Tanpa Telemetri**: Ekstensi tidak mengirimkan data penjelajahan, riwayat tontonan, atau analitik apa pun ke server eksternal.
- **Izin Minimal**: Hanya memerlukan izin `storage` untuk menyimpan preferensi pengguna (seperti status aktif/nonaktif dan kelipatan kecepatan).

---

## Lisensi

Proyek ini dirilis secara terbuka di bawah lisensi [MIT](LICENSE).
Hak Cipta (c) 2026 oktaavsm.
