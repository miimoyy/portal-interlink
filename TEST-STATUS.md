# TEST STATUS — Interlink Dashboard

Terakhir dicek: 2026-07-22 15:16 WIB
Dicek oleh: Antigravity AI Agent (Gemini 3.6 Flash)
Cara cek: Otomatis Playwright (18 test cases)

## Auth
| Fitur | Status | Catatan |
|---|---|---|
| Login Admin (quickLogin) | ✅ PASS | Berhasil masuk ke dashboard admin |
| Login Client (quickLogin) | ✅ PASS | Berhasil masuk ke dashboard client dengan role terbatas |
| Logout | ✅ PASS | Berhasil keluar & kembali ke halaman login |
| Toggle Password Field | ✅ PASS | Visual toggle password (show/hide) berfungsi normal |

## Navigation & Modals
| Fitur | Status | Catatan |
|---|---|---|
| Navigasi Subnav (Overview, Clients, Devices, Racks, Tickets, XC, Accounts) | ✅ PASS | Berhasil perpindahan halaman tanpa reload |
| Indicator Global Floor Filter | ✅ PASS | Tampil sesuai lantai yang dipilih |
| Open & Close Modal Overlay | ✅ PASS | Modal overlay membuka dan menutup secara akurat |

## Client
| Fitur | Status | Catatan |
|---|---|---|
| Detail Client (openClientDetail) | ✅ PASS | Buka view detail client dan kembali ke daftar |
| Filter & Pencarian Client | ✅ PASS | Pencarian nama/PT & filter status berjalan normal |
| Export PDF Data Client | ✅ PASS | Fungsi `exportClientsPdf()` tereksekusi tanpa crash |
| Tambah Client (saveClient) | ⚠️ BELUM DITEST | Membutuhkan test case E2E baru untuk input form lengkap |
| Edit Client | ⚠️ BELUM DITEST | Membutuhkan test case E2E baru |
| Hapus Client | ⚠️ BELUM DITEST | Membutuhkan test case E2E baru |

## Device & Inventory
| Fitur | Status | Catatan |
|---|---|---|
| Filter & Pencarian Perangkat | ✅ PASS | Pencarian & filter lokasi/status berfungsi |
| Detail Perangkat (openDeviceDetail) | ✅ PASS | View detail perangkat dan tombol kembali berfungsi |
| Input Unit Berat (Gram / Kg) | ✅ PASS | Input berat mendukung pilihan unit Gram dan Kg |
| Export PDF Data Perangkat | ✅ PASS | Fungsi `exportDevicesPdf()` tereksekusi tanpa crash |
| Tambah/Edit Perangkat | ⚠️ BELUM DITEST | Modal form device belum masuk di E2E spec |

## Rack & Floor
| Fitur | Status | Catatan |
|---|---|---|
| Ganti Lantai / Floor Filter | ✅ PASS | Perubahan lantai merender ulang daftar rak |
| Update Statistik Lantai | ✅ PASS | Stat card ter-update sesuai lantai |
| Detail Rak (openRackDetail) | ✅ PASS | View detail rak & grid U-space berfungsi |
| Export PDF Data Rak | ✅ PASS | Export PDF rak berfungsi |

## Ticket
| Fitur | Status | Catatan |
|---|---|---|
| Submit Ticket (Masuk Barang / XC) | ✅ PASS | Modal submit tiket tersimpan & modal tertutup |
| Input Unit Berat Tiket (Gram / Kg) | ✅ PASS | Pengisian berat perangkat pada tiket mendukung pilihan unit Gram dan Kg |
| Filter Tipe & Status Tiket | ✅ PASS | Filter select `#ticketTypeFilterSelect` berfungsi |
| Export PDF Data Tiket | ✅ PASS | Fungsi `exportTicketsPdf()` tereksekusi tanpa error |

## CrossConnect
| Fitur | Status | Catatan |
|---|---|---|
| Filter Status CrossConnect (Chip Buttons) | ✅ PASS | Filter status `.chip[data-xcfilter]` berfungsi |
| Detail CrossConnect (openCrossConnectDetail) | ✅ PASS | Buka detail koneksi & navigasi kembali |
| Edit CrossConnect | ✅ PASS | Membuka modal tiket untuk pengeditan |
| Export PDF Data CrossConnect | ✅ PASS | Fungsi `exportCrossConnects()` tereksekusi |

## Account & Sub-account
| Fitur | Status | Catatan |
|---|---|---|
| Tambah Akun Baru (saveAccount) | ✅ PASS | Pengisian form `#au_name`, `#au_email`, `#au_role` tersimpan |
| Filter Search & Reset Akun | ✅ PASS | Filter `#accountFilterSearch` & `resetAccountFilters()` berfungsi |
| Ganti Password Akun (Admin) | ✅ PASS | Modal `#modalAdminAccountPassword` dengan key `encodeURIComponent` |
| Hapus Akun | ✅ PASS | Modal konfirmasi `#modalDeleteAccount` & pembersihan baris tabel |
| Sub-Account Management | ✅ PASS | Navigasi `navigateToPage('subaccount')`, pembuatan & penghapusan sub-account |
| Change Password Modal | ✅ PASS | Modal `#modalChangePassword` & toggle password field |

---

## Riwayat Perubahan
- 2026-07-22: Pembuatan file `TEST-STATUS.md` awal. Seluruh 8 file Playwright spec (`01` s/d `08`) di-fix & di-run ulang. 18 dari 18 test suite PASS 100%.
- 2026-07-22: Penambahan pilihan unit berat (Gram / Kg) pada modal Device dan Tiket, format tampilan otomatis (Gram jika < 1 Kg, Kg jika >= 1 Kg). Seluruh 18 Playwright test tetap PASS 100%.
- 2026-07-22: Redesain input berat perangkat menjadi 1 kolom input bersih tanpa panah spinner / tombol unit. Mendukung pengetikan pintar (misal: "500 gr", "500g", "2 kg", atau "500"). Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Penyesuaian akhir input berat: 1 kolom input teks angka tanpa spinner (type="text", placeholder="Contoh: 500,2 atau 20,3") + 1 dropdown unit (Kg / Gram). Mendukung format desimal koma (misal: "20,3" atau "500,2"). Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Fitur Hapus Sebagian & Keluar Sebagian (Partial Exit/Delete) untuk perangkat berjumlah > 1. Memungkinkan hapus/keluar unit spesifik tanpa menghapus seluruh record. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Mengganti popup prompt bawaan browser dengan Custom Modal Dialog bergaya Interlink Dashboard (Interactive Stepper `-` / `+`). Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Menghapus panah spinner atas/bawah pada input angka modal hapus unit, serta merapikan posisi angka persis di tengah (vertical & horizontal alignment). Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan bug pengeluaran barang via tiket: Mengisi default Jumlah Keluar sesuai total unit yang tersedia di inventory, serta memperbaiki fallback nilai jumlah keluar pada proses penyelesaian tiket. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Refactoring fungsi penanganan pengeluaran barang via tiket (`processDeviceExitForTicket`). Memastikan seluruh tiket Keluar Barang secara konsisten memproses jumlah unit spesifik yang diminta (misal: 3 dari 4 unit) pada semua jalur penyelesaian (modal simpan & quick-complete tombol). Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan fitur pencatatan pengeluaran barang manual di sisi Admin (`saveDevice`): Mendukung pengeluaran sebagian (partial exit) sehingga ketika Admin mencatat pengeluaran 3 dari 4 unit, sisa 1 unit tetap tersimpan di inventory Perangkat Masuk. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Mengatur default `Jumlah Keluar` di form tiket keluar menjadi `1` unit per tindakan (agar pelacakan Serial Number spesifik/individual per perangkat lebih rapi dan aman). Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Penambahan penanganan Serial Number otomatis (Smart SN Extraction): Jika batch perangkat memiliki banyak SN (misal: SN1001, SN1002, SN1003) dan 1 unit dikeluarkan, sistem secara otomatis mencabut SN unit yang keluar dari daftar SN di Perangkat Masuk dan memindahkannya ke Perangkat Keluar. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Penyederhanaan tabel inventory (1 Perangkat = 1 Baris dengan 1 Serial Number): Menghapus kolom `JML` pada header & baris tabel Perangkat Masuk dan Perangkat Keluar, serta menyembunyikan input Jumlah pada modal form agar alur pengeluaran dan inventarisasi berbasis SN individual menjadi jauh lebih bersih dan sederhana. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan Keamanan #1 (Password Hashing): Mengimplementasikan hashing password menggunakan `bcrypt` (cost 10) di backend (`server.js` & `db.js`) untuk pendaftaran, login (`bcrypt.compare`), dan ubah password. Dilengkapi dengan auto-migration transparan untuk me-rehash password plain-text lama tanpa mengubah kredensial user demo. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan Keamanan #2 (Session & Token Management): Menyimpan session token secara persisten di database SQLite (tabel `sessions`) dengan TTL 24 jam (`expiresAt`), penanganan auto-cleanup token kedaluwarsa, dan endpoint `POST /api/auth/logout`. Session pengguna kini tidak akan hilang saat server di-restart. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan Keamanan #3 (XSS Protection): Menambahkan fungsi sanitisasi `escapeHtml()` di `ui.js` dan membungkus seluruh field input teks bebas (nama client, PIC, keterangan, nama perangkat, judul/deskripsi tiket, lokasi, dll) pada fungsi-fungsi render UI (`renderClients`, `openClientDetail`, `renderDevices`, `renderSNCell`, `renderTickets`, `renderCrossConnects`). Mencegah eksekusi script HTML/JS berbahaya di browser. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan Keamanan #4 (Otorisasi Multi-Tenant): Memaksa penegakan otorisasi di backend `server.js` dengan meng-override `clientId` payload body dengan `req.user.clientId` dari session token untuk peran Client/Subclient, serta menambahkan penegakan verifikasi kepemilikan data sebelum melakukan tindakan update/delete. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan Keamanan #5 (Rate Limiting Login): Menambahkan middleware `express-rate-limit` pada endpoint `/api/auth/login` dan `/api/users/change-password` untuk mencegah serangan Brute Force secara efektif dengan batasan percobaan request per 15 menit per IP. Seluruh 18 Playwright test PASS 100%.
- 2026-07-22: Perbaikan Keamanan #6 & #7 (Input Validation, DoS Protection & CORS Note): Mengatur batasan payload `express.json({ limit: '1mb' })`, penambahan `sanitizeInputString()`, dan dokumentasi arahan produksi CORS. Seluruh 18 Playwright E2E test PASS 100%.
