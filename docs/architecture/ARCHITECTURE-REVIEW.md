# Architecture Review Report - Artupski ReSite

**Tanggal Review**: 2026-10-01
**Reviewer**: Architecture Review (Automated + Manual)
**Scope**: Seluruh dokumen spesifikasi arsitektur di root repository (`ARCHITECTURE.md`, `EVENT-SYSTEM.md`, `DATABASE.md`, `BLUEPRINT-SPEC.md`, `SCANNER-SPEC.md`, `ADMIN-SPEC.md`, `AI-SPEC.md`, `SECURITY.md`, `PRIVACY.md`, `TESTING.md`, `TECH-STACK.md`, `PLAN.md`, `AGENTS.md`, dan dokumen pendukung lainnya).
**Catatan**: Repository saat ini berisi kumpulan dokumen spesifikasi (documentation-first). Belum ada source code implementasi (`package.json`, `Cargo.toml`, `src/`, `src-tauri/`) yang di-commit. Review ini menilai **kelayakan dan konsistensi desain arsitektur pada level spesifikasi**, bukan kualitas implementasi kode yang sudah ada.

---

## 1. Executive Summary

Secara keseluruhan, arsitektur Artupski ReSite **realistis, koheren, dan siap untuk diimplementasikan**. Pemisahan layer (Tauri/Rust native ↔ TypeScript/React ↔ Node.js workers) didefinisikan secara eksplisit di [`ARCHITECTURE.md`](ARCHITECTURE.md:1) dan [`AGENTS.md`](../../AGENTS.md:1), dengan batasan kepemilikan modul yang jelas. Playwright ditempatkan secara benar sebagai child process terisolasi, SQLite memiliki single-writer boundary yang tegas, dan event architecture memakai taksonomi `<domain>.<action>` yang konsisten serta dilengkapi mekanisme batching untuk mencegah UI stutter.

Tiga temuan utama:

1. **Kekuatan terbesar**: Disiplin boundary. [`AGENTS.md`](../../AGENTS.md:51) menetapkan aturan keras — Rust tidak boleh memanggil paket Node.js, worker crawler hanya berkomunikasi via stdio IPC, dan hanya layer `src/services/db` yang boleh mengeksekusi SQL.
2. **Risiko terbesar**: Terdapat beberapa **inkonsistensi penamaan skema** antar dokumen (nama tabel `scans` vs `scan_runs`, path storage `~/.artupski-resite/` vs `%LOCALAPPDATA%`, serta lokasi tanggung jawab SQLite yang disebut di Rust pada satu dokumen namun di TypeScript worker pada dokumen lain). Ini wajib dikunci sebelum coding dimulai.
3. **Potensi over-engineering**: Sejumlah fitur pasca-MVP (admin UI synthesizer, multi-browser WebKit/Firefox, collaborative export bundle) sudah dispesifikasikan sangat detail di tahap dokumentasi, berisiko menarik fokus dari MVP inti.

**Verdict agregat**: **⚠️ Layak dengan perbaikan** — arsitektur solid, namun perlu sinkronisasi kontrak antar dokumen sebelum Phase 0 dimulai.

---

## 2. Ringkasan Verdict 10 Pertanyaan

| # | Pertanyaan | Verdict | Justifikasi Singkat |
| :--- | :--- | :---: | :--- |
| 1 | Apakah architecture realistic? | ✅ | Stack matang (Tauri 2, React, Playwright, SQLite) & pola desktop-native terbukti; scope besar tapi bertahap via 16 fase di [`PLAN.md`](../product/PLAN.md:1). |
| 2 | Apakah Tauri ↔ React ↔ Rust boundary jelas? | ✅ | Tanggung jawab Rust vs TypeScript dipisah eksplisit di [`ARCHITECTURE.md`](ARCHITECTURE.md:75) & [`AGENTS.md`](../../AGENTS.md:51). |
| 3 | Apakah Playwright bisa ditempatkan dengan benar? | ✅ | Berjalan sebagai child process terisolasi via `ProcessManager`, komunikasi JSON-RPC/stdio ([`ARCHITECTURE.md`](ARCHITECTURE.md:81), [`AGENTS.md`](../../AGENTS.md:53)). |
| 4 | Apakah SQLite boundary jelas? | ⚠️ | Prinsip single-writer jelas, tetapi **lokasi eksekusi SQL ambigu** (Rust driver vs `better-sqlite3` worker) — lihat [`PLAN.md`](../product/PLAN.md:42) vs [`AGENTS.md`](../../AGENTS.md:54). |
| 5 | Apakah event architecture masuk akal? | ✅ | Taksonomi terstruktur, payload bertipe, plus batching 50 event / 100ms di [`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:173). |
| 6 | Apakah Blueprint schema extensible? | ✅ | Versioned (`blueprint_version`), section modular, ada `admin_requirements` opsional yang non-breaking ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:145)). |
| 7 | Apakah future admin bisa ditambahkan? | ✅ | Didesain sebagai plugin consumer pasca-MVP yang tidak menyentuh core scanner ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:7)). |
| 8 | Apakah struktur folder maintainable? | ⚠️ | Struktur jelas & domain-driven, tetapi ada **inkonsistensi path** antara [`AGENTS.md`](../../AGENTS.md:32) dan [`DATABASE.md`](DATABASE.md:215). |
| 9 | Apakah ada circular dependency? | ✅ | Tidak ditemukan siklus; alur dependency satu arah (UI → services → workers → OS) sesuai [`ARCHITECTURE.md`](ARCHITECTURE.md:6). |
| 10 | Apakah ada bagian yang over-engineered? | ⚠️ | Beberapa fitur pasca-MVP terlalu detail di tahap awal; risiko scope creep. |

**Skor**: 7 ✅ / 3 ⚠️ / 0 ❌.

---

## 3. Analisis Detail per Pertanyaan

### 3.1 Apakah architecture realistic?

**Verdict: ✅ Realistis**

Arsitektur dibangun di atas stack yang matang dan saling melengkapi: Tauri 2 sebagai host native, React + TypeScript untuk UI, Node.js child process untuk crawling, dan SQLite untuk persistensi lokal ([`ARCHITECTURE.md`](ARCHITECTURE.md:3), [`TECH-STACK.md`](TECH-STACK.md:1)). Pemilihan Tauri (bukan Electron) tepat karena target aplikasi adalah desktop-native dengan kebutuhan akses filesystem, keyring OS, dan manajemen child process yang efisien — semuanya adalah kekuatan Rust/Tauri.

Pembagian layer produk bertingkat — Static Clone → Blueprint → Full Project ([`ARCHITECTURE.md`](ARCHITECTURE.md:25)) — adalah keputusan desain yang kuat karena memisahkan tingkat kesulitan dan nilai tambah, memungkinkan pengiriman MVP lebih cepat (Layer 1 & 2) sebelum Layer 3 (code generation) yang jauh lebih kompleks.

**Bukti**: 16 fase implementasi terurut dengan dependency antar fase yang eksplisit di [`PLAN.md`](../product/PLAN.md:8) menunjukkan perencanaan realistis, bukan sekadar visi abstrak.

**Catatan**: Kompleksitas total tinggi (crawling + AI + code gen + admin gen). Realistis hanya jika tim fokus pada MVP dulu.

---

### 3.2 Apakah Tauri ↔ React ↔ Rust boundary jelas?

**Verdict: ✅ Jelas**

Boundary didefinisikan secara eksplisit dan tegas:

- **Rust**: window management, OS filesystem I/O, inisialisasi SQLite driver, native menu, spawn/kill child process ([`ARCHITECTURE.md`](ARCHITECTURE.md:75)).
- **TypeScript**: seluruh business logic, DOM parsing rules, UI state (Zustand), scan config, AI prompt orchestration, code synthesis ([`ARCHITECTURE.md`](ARCHITECTURE.md:76)).
- **Komunikasi**: IPC / Events / Commands antar layer, dan child process IPC / stdio antar worker ([`ARCHITECTURE.md`](ARCHITECTURE.md:11)).

Aturan keras di [`AGENTS.md`](../../AGENTS.md:51) memperkuat boundary ini: "`src-tauri`: Never invoke Node.js packages." Ini mencegah anti-pattern paling umum pada aplikasi Tauri (business logic bocor ke Rust atau sebaliknya).

**Rekomendasi minor**: Definisikan kontrak Tauri Command (nama command, tipe input/output) secara formal dalam satu file (mis. `TAURI-COMMAND-SPEC.md`) agar boundary tidak hanya konseptual tapi juga kontraktual.

---

### 3.3 Apakah Playwright bisa ditempatkan dengan benar?

**Verdict: ✅ Ditempatkan dengan benar**

Penempatan Playwright sangat tepat:

1. **Isolasi**: Berjalan sebagai dedicated Node.js child process, bukan di dalam Rust maupun di renderer React ([`ARCHITECTURE.md`](ARCHITECTURE.md:82)).
2. **Komunikasi**: JSON-RPC via stdio atau WebSocket IPC ([`ARCHITECTURE.md`](ARCHITECTURE.md:83)).
3. **Lifecycle**: Dikelola oleh `ProcessManager` untuk cleanup ([`ARCHITECTURE.md`](ARCHITECTURE.md:71), [`AGENTS.md`](../../AGENTS.md:53)).
4. **Robustness**: Aturan "Zero Headless Hangs" mewajibkan timeout navigasi/network maksimal 30s ([`AGENTS.md`](../../AGENTS.md:60)).

Detail pipeline di [`SCANNER-SPEC.md`](../specs/SCANNER-SPEC.md:3) — `PageCrawler` mengendalikan `DOMAnalyzer`, `CSSAnalyzer`, `JSAnalyzer`, `NetworkAnalyzer`, `AssetCollector`, `ScreenshotEngine` — menunjukkan arsitektur analyzer yang modular dan testable.

**Catatan**: Karena Playwright dibundel di desktop app, ukuran installer akan membesar (Chromium ~150MB). Untuk multi-browser (Firefox/WebKit) di [`ARCHITECTURE.md`](ARCHITECTURE.md:47), pertimbangkan unduh on-demand, bukan bundling semua.

---

### 3.4 Apakah SQLite boundary jelas?

**Verdict: ⚠️ Prinsip jelas, detail ambigu**

Prinsip single-writer sudah benar dan dinyatakan tegas: "`src/services/db`: Only layer authorized to execute SQLite SQL statements" ([`AGENTS.md`](../../AGENTS.md:54)). Konfigurasi pragma WAL, `foreign_keys = ON`, dan `busy_timeout` ([`DATABASE.md`](DATABASE.md:15)) menunjukkan pemahaman concurrency yang baik.

**Namun ada ambiguitas lokasi eksekusi SQL:**

- [`PLAN.md`](../product/PLAN.md:42) menyebut "SQLite connection via Rust/Tauri bridge **or** better-sqlite3 worker" — dua opsi tanpa keputusan final.
- [`DATABASE.md`](DATABASE.md:9) menyebut "native driver **or** WASM fallback" — opsi ketiga.
- Sementara [`AGENTS.md`](../../AGENTS.md:54) mengarahkan eksekusi ke layer TypeScript `src/services/db`.

Jika SQL dieksekusi di Rust (`src-tauri/src/db/`), maka aturan [`AGENTS.md`](../../AGENTS.md:54) yang menyatakan layer TS `src/services/db` adalah satu-satunya yang boleh eksekusi SQL menjadi kontradiktif. Ini adalah **inkonsistensi arsitektural yang harus dikunci** sebelum Phase 2.

**Rekomendasi**: Pilih satu model — disarankan **Rust sebagai owner koneksi SQLite** (karena `src-tauri` sudah menangani "SQLite Native Driver" di [`ARCHITECTURE.md`](ARCHITECTURE.md:14)), dan `src/services/db` di TypeScript hanya menjadi **repository facade** yang memanggil Tauri commands, bukan mengeksekusi SQL langsung.

---

### 3.5 Apakah event architecture masuk akal?

**Verdict: ✅ Masuk akal dan matang**

Event architecture dirancang dengan baik:

1. **Taksonomi konsisten**: `<domain>.<action_or_state>` dengan 8 domain (`scanner`, `technology`, `asset`, `responsive`, `auth`, `blueprint`, `clone`, `project`) di [`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:22).
2. **Payload bertipe**: Setiap event punya TypeScript interface dengan `BaseEventPayload` yang membawa `eventId`, `projectId`, `timestamp`, `domain` ([`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:50)).
3. **Anti UI-stutter**: `IPCEventStreamer` mem-batch 50 log / flush tiap 100ms ([`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:178)) — solusi tepat untuk skenario 500 network call/detik.
4. **Alur satu arah**: Worker → Rust IPC bridge → Zustand store ([`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:10)).

Kombinasi `EventEmitter` + Tauri IPC bridge adalah pilihan pragmatis yang menghindari over-abstraction.

**Catatan**: Belum ada spesifikasi untuk **event replay/recovery** ketika UI ter-reload saat scan berjalan (state hilang). Pertimbangkan persist `process_logs` (sudah ada di [`DATABASE.md`](DATABASE.md:131)) sebagai sumber rehidrasi store.

---

### 3.6 Apakah Blueprint schema extensible?

**Verdict: ✅ Extensible**

Desain schema sangat mendukung evolusi:

1. **Versioning eksplisit**: `blueprint_version: 1` + `schema_version` di tabel `blueprints` ([`BLUEPRINT-SPEC.md`](../specs/BLUEPRINT-SPEC.md:16), [`DATABASE.md`](DATABASE.md:109)).
2. **Modular sections**: `site`, `pages`, `routes`, `components`, `design_system`, `forms`, `authentication`, `technologies`, `admin_requirements` — masing-masing independen ([`BLUEPRINT-SPEC.md`](../specs/BLUEPRINT-SPEC.md:23)).
3. **Validasi Zod**: Dijamin oleh aturan [`AGENTS.md`](../../AGENTS.md:70) ("Every prompt compiler must output strict JSON structured schemas validated via Zod").
4. **Forward compatibility**: `admin_requirements` opsional dan non-breaking — jika absen, generator standar tetap jalan tanpa error ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:145)).

**Rekomendasi**: Tambahkan aturan **schema migration** untuk Blueprint (bukan hanya DB) — mis. `blueprint.v1 → v2` upgrader, karena blueprint lama harus tetap bisa dibaca generator baru.

---

### 3.7 Apakah future admin bisa ditambahkan?

**Verdict: ✅ Bisa, dengan decoupling yang baik**

Admin subsystem dirancang sebagai **plugin consumer** pasca-MVP yang sepenuhnya terpisah dari core:

1. **Timeline jelas**: Diklasifikasikan POST-MVP secara eksplisit ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:11)).
2. **Non-invasive ke scanner**: MVP hanya mencatat `admin_requirements` di blueprint; scanner tidak perlu diubah untuk fitur admin nanti ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:16)).
3. **Schema extension siap**: `AdminRequirementsSchema`, `AdminEntitySchema`, `AdminFieldSchema` sudah didefinisikan lengkap ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:83)).
4. **Extension path konkret**: Package `@artupski/generator-admin-react` / `@artupski/generator-filament-laravel` dapat dipasang ke export screen ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:148)).
5. **11 domain administrasi** sudah dipetakan dengan capability CRUD ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:59)).

Ini contoh decoupling yang benar: fitur besar ditambahkan tanpa menyentuh core engine.

---

### 3.8 Apakah struktur folder maintainable?

**Verdict: ⚠️ Struktur baik, path inkonsisten**

Struktur folder bersifat **domain-driven** dan mudah dipahami ([`AGENTS.md`](../../AGENTS.md:32)):

```
src/components/   → UI reusable
src/routes/       → page views
src/stores/       → Zustand
src/services/     → infra | db | scanner | blueprint | ai | generator
src/workers/      → crawler (Playwright)
test/             → integration & E2E
```

Pemisahan `services/` per domain (bukan per tipe teknis) adalah keputusan maintainability yang baik — mudah menemukan kode terkait fitur.

**Masalah**: Inkonsistensi lokasi storage antar dokumen:

- [`DATABASE.md`](DATABASE.md:215): `~/.artupski-resite/`
- [`PRIVACY.md`](../security/PRIVACY.md:27): `%LOCALAPPDATA%` (Windows) / `~/Library/Application Support` (macOS)
- [`SECURITY.md`](../security/SECURITY.md:90): `AppData/Local/ArtupskiReSite/projects/`

Tiga format berbeda untuk root storage yang sama. **Wajib distandardisasi** menjadi satu konstanta (mis. `appDataDir()/ArtupskiReSite/`) sebelum implementasi.

**Catatan tambahan**: Nama tabel juga inkonsisten — [`DATABASE.md`](DATABASE.md:46) memakai `scans`, tetapi [`PLAN.md`](../product/PLAN.md:46) menyebut `scan_runs`. Sinkronkan.

---

### 3.9 Apakah ada circular dependency?

**Verdict: ✅ Tidak ditemukan siklus**

Alur dependency bersifat **satu arah (acyclic)**:

```
React UI (Zustand) → services/ (db, scanner, ai, generator) → workers/ → OS/Playwright
                            ↓
                      src-tauri (Rust) → OS primitives
```

- UI tidak mengimpor worker langsung; komunikasi via EventBus/IPC ([`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:10)).
- Worker crawler tidak mengimpor UI; hanya stdio IPC ([`AGENTS.md`](../../AGENTS.md:53)).
- `src-tauri` tidak memanggil Node.js ([`AGENTS.md`](../../AGENTS.md:52)).
- `services/db` adalah leaf dependency yang dikonsumsi domain lain, tidak mengimpor scanner/ai/generator.

Tidak ada edge yang mengarah balik ke layer atas, sehingga secara desain **bebas circular dependency**.

**Peringatan**: Risiko siklus muncul jika `EventBus` dijadikan singleton global yang diimpor di semua layer. Jaga agar EventBus tetap di layer `infra` dan dikonsumsi via interface, bukan import langsung lintas domain.

---

### 3.10 Apakah ada bagian yang over-engineered?

**Verdict: ⚠️ Ada beberapa area**

Beberapa bagian dispesifikasikan melampaui kebutuhan MVP:

1. **Multi-browser support**: Chromium, Firefox, WebKit ([`ARCHITECTURE.md`](ARCHITECTURE.md:47)) — menambah ukuran bundle & kompleksitas QA. MVP cukup Chromium.
2. **Admin UI synthesizer detail**: Schema RBAC lengkap, 11 domain, drag-and-drop menu, publish scheduler ([`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:63)) — untuk fitur yang bahkan belum masuk MVP.
3. **Collaborative export bundle**: Format `.artupski` archive terenkripsi ([`TODO.md`](../product/TODO.md:37)) — fitur kolaborasi tim, jauh dari core solo-user desktop tool.
4. **Local LLM integration** ([`TODO.md`](../product/TODO.md:20)) — menambah surface area besar untuk nilai marginal di awal.

**Penilaian**: Spesifikasi detail ini **tidak salah secara teknis** (justru menunjukkan visi jangka panjang), tetapi berisiko **scope creep** dan menunda MVP. Disarankan memberi label eksplisit "POST-MVP / Not in Scope for v1" pada bagian-bagian tersebut.

**Kontra-argumen**: Karena repo ini masih tahap dokumentasi, mendokumentasikan masa depan lebih awal adalah praktik yang baik. Masalahnya bukan pada keberadaan dokumen, melainkan pada **disiplin eksekusi** agar MVP tidak tertarik ke fitur lanjutan.

---

## 4. Risks

| ID | Risiko | Severity | Area | Mitigasi |
| :--- | :--- | :---: | :--- | :--- |
| R1 | Ambiguitas lokasi eksekusi SQL (Rust vs TS worker) menyebabkan boundary bocor | High | [`PLAN.md`](../product/PLAN.md:42), [`AGENTS.md`](../../AGENTS.md:54) | Kunci satu model: Rust owner koneksi, TS sebagai facade |
| R2 | Inkonsistensi path storage (`~/.artupski-resite` vs `%LOCALAPPDATA%` vs `AppData/Local/ArtupskiReSite`) | High | [`DATABASE.md`](DATABASE.md:215), [`PRIVACY.md`](../security/PRIVACY.md:27), [`SECURITY.md`](../security/SECURITY.md:90) | Definisikan satu konstanta root + resolver per-OS |
| R3 | Inkonsistensi nama tabel (`scans` vs `scan_runs`) | Medium | [`DATABASE.md`](DATABASE.md:46), [`PLAN.md`](../product/PLAN.md:46) | Sinkronkan skema sebelum migration `0001_initial.sql` |
| R4 | Scope creep dari fitur pasca-MVP (admin, multi-browser, collab export, local LLM) | Medium | [`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:59), [`TODO.md`](../product/TODO.md:20) | Label "POST-MVP", gate via roadmap |
| R5 | Ukuran installer membengkak akibat bundling browser | Medium | [`ARCHITECTURE.md`](ARCHITECTURE.md:47) | Chromium-only untuk MVP; unduh browser on-demand |
| R6 | State UI hilang saat reload di tengah scan (event tidak ter-replay) | Low | [`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:173) | Rehidrasi Zustand dari `process_logs` |
| R7 | Belum ada kontrak formal Tauri Command | Low | [`ARCHITECTURE.md`](ARCHITECTURE.md:11) | Tambah `TAURI-COMMAND-SPEC.md` |
| R8 | Blueprint belum punya strategi migrasi antar versi schema | Low | [`BLUEPRINT-SPEC.md`](../specs/BLUEPRINT-SPEC.md:16) | Tambah blueprint upgrader v1→vN |

---

## 5. Actionable Recommendations

Prioritas **P0** (harus sebelum coding), **P1** (sebelum Phase terkait), **P2** (nice-to-have).

### P0 — Blocker sebelum Phase 0/2
1. **Kunci model eksekusi SQLite**: Tetapkan Rust (`src-tauri/src/db/`) sebagai pemilik koneksi, dan `src/services/db` sebagai repository facade TypeScript. Update [`AGENTS.md`](../../AGENTS.md:54) & [`PLAN.md`](../product/PLAN.md:42) agar konsisten.
2. **Standardisasi root storage path**: Definisikan satu konstanta, mis. `AppData/Local/ArtupskiReSite/` (Windows) dan padanan macOS/Linux. Perbaiki [`DATABASE.md`](DATABASE.md:215), [`PRIVACY.md`](../security/PRIVACY.md:27), [`SECURITY.md`](../security/SECURITY.md:90).
3. **Sinkronkan nama tabel**: Satukan `scans` vs `scan_runs` di seluruh dokumen DB & plan.

### P1 — Sebelum fase terkait
4. **Buat `TAURI-COMMAND-SPEC.md`**: Daftar resmi Tauri commands (nama, payload, return type) sebagai kontrak boundary Rust ↔ React.
5. **Tetapkan strategi browser**: MVP = Chromium saja; Firefox/WebKit = unduh on-demand pasca-MVP. Update [`ARCHITECTURE.md`](ARCHITECTURE.md:47).
6. **Blueprint version migration**: Tambah section upgrader blueprint (`v1 → vN`) di [`BLUEPRINT-SPEC.md`](../specs/BLUEPRINT-SPEC.md:1).
7. **Rehidrasi UI state**: Spesifikasikan mekanisme memuat ulang state dari `process_logs` saat UI reload di tengah scan ([`EVENT-SYSTEM.md`](EVENT-SYSTEM.md:150)).

### P2 — Peningkatan kualitas
8. **Label "POST-MVP"**: Beri tag eksplisit pada [`ADMIN-SPEC.md`](../specs/ADMIN-SPEC.md:59), fitur `.artupski` bundle di [`TODO.md`](../product/TODO.md:37), dan local LLM di [`TODO.md`](../product/TODO.md:20).
9. **Definisikan aturan import antar layer**: Dokumentasikan matriks "boleh mengimpor apa" untuk mencegah circular dependency di masa depan (EventBus sebagai interface, bukan import global).
10. **Tambah Definition of Done per fase** sudah ada di [`AGENTS.md`](../../AGENTS.md:99) — pastikan tiap PR Phase 0-16 memverifikasi `typecheck`, `test`, `lint`, dan `anti-ui-slop` sesuai mandate frontend ([`UI-SPEC.md`](../design/UI-SPEC.md:10)).

---

## 6. Kesimpulan

Arsitektur Artupski ReSite **layak untuk diimplementasikan** dengan skor 7 ✅ / 3 ⚠️ / 0 ❌. Fondasi desainnya kuat: boundary antar layer tegas, Playwright ditempatkan benar sebagai child process, SQLite mengikuti pola single-writer, dan event system dirancang untuk throughput tinggi tanpa mengorbankan responsivitas UI. Blueprint schema dan admin subsystem menunjukkan pemikiran extensibility yang matang.

Tiga area yang perlu diperbaiki semuanya bersifat **inkonsistensi dokumentasi**, bukan kelemahan desain fundamental: (1) lokasi eksekusi SQL, (2) standardisasi path storage, (3) sinkronisasi nama tabel. Menyelesaikan ketiganya sebelum Phase 0 akan menghilangkan risiko R1–R3.

Kekhawatiran utama jangka panjang adalah **scope creep** dari fitur pasca-MVP yang sudah sangat detail. Dengan disiplin roadmap dan penegakan label MVP vs POST-MVP, risiko ini dapat dikelola.

**Rekomendasi akhir**: Mulai Phase 0 setelah menyelesaikan tiga rekomendasi P0 di atas. Jadikan [`AGENTS.md`](../../AGENTS.md:1) dan dokumen review ini sebagai rujukan tunggal boundary selama implementasi.
