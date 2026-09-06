# BYTZ Platform

## Tentang Proyek

BYTZ adalah platform managed marketplace untuk proyek digital di Indonesia. Konsepnya bukan freelancer marketplace biasa seperti Upwork, tapi lebih ke "Virtual Software House" yang terkurasi. Owner mengajukan kebutuhan proyek, platform menganalisis dan menghasilkan dokumen bisnis/teknis dengan bantuan AI, lalu mencocokkan dengan talent yang sesuai.

Benchmark utama: Gigster (model managed marketplace), Upwork (open marketplace), Toptal (talent vetting), Projects.co.id (lokal), A.Team (team matching).

Gap yang diisi: Gigster terlalu mahal dan tertutup untuk pasar Indonesia. Upwork terlalu bebas tanpa kurasi. Toptal hanya untuk top 3% talent (eksklusif). BYTZ mengambil posisi di tengah, yaitu terkurasi tapi transparan, dengan harga yang masuk akal untuk pasar UMKM dan startup lokal, plus pemerataan proyek ke semua talent.

Perbedaan utama BYTZ dari kompetitor:

- Vs Gigster: Transparan (owner bisa lihat profil talent), harga terjangkau pasar Indonesia, ada opsi beli BRD saja
- Vs Upwork: Platform melakukan kurasi dan quality control, harga sudah ditetapkan sistem (bukan bidding war), ada pemerataan proyek, ada Gantt chart dan time tracking built-in
- Vs Toptal: Tidak eksklusif, semua talent bisa berpartisipasi dengan pemerataan adil (tier internal only, tidak membatasi akses)
- Vs Projects.co.id: AI-powered scoping dan estimasi, dokumen standar (BRD/PRD), escrow terjamin, ML-based matching
- Vs A.Team: Fokus individual talent matching (bukan team), harga lebih terjangkau

Arsitektur platform dibangun dengan pola microservice supaya mature dan extensible. Fokus saat ini di proyek digital (software development, web, mobile, UI/UX, data). Arsitektur sudah didesain supaya bisa diperluas ke bidang engineering lain (sipil, geodesi, geologi, planologi) dan industri bisnis lainnya di fase berikutnya.

### Konvensi Penamaan (Branding)

Platform ini bernama **KerjaCUS!** di UI (repo tetap `BYTZ` untuk package names). Penamaan sudah diseragamkan di seluruh monorepo:

| Konteks | Kode/DB/API | Tampilan ID | Tampilan EN |
|---|---|---|---|
| Penyedia jasa | `talent` | Talenta | Talent |
| Pemberi proyek | `owner` | Pemilik Proyek | Project Owner |
| Role enum (DB) | `'talent'`, `'owner'` | - | - |
| Halaman talenta | `/talent/*` | - | - |
| API endpoint | `/api/v1/talent-profiles`, `/api/v1/talents/*` | - | - |
| NATS subjects | `talent.*`, `project.team.talent_*` | - | - |
| DB tables | `talent_profiles`, `talent_skills`, `talent_assessments` | - | - |
| DB columns | `talent_id`, `owner_id`, `talent_payout` | - | - |

Semua penamaan `worker` dan `client` sudah diganti ke `talent` dan `owner` di seluruh kode, database schema, API routes, NATS events, shared types, dan frontend.

## Konteks Bisnis

### Model Bisnis

BYTZ adalah perantara terkurasi (managed intermediary), bukan kontraktor langsung. Platform memfasilitasi kontrak antara owner dan talent, dengan nilai tambah berupa kurasi proyek, pembuatan dokumen, dan pencocokan talent.

### Revenue Stream

1. Penjualan BRD (Business Requirement Document): Owner bayar untuk dokumen kebutuhan bisnis yang dihasilkan AI dan divalidasi
2. Penjualan PRD (Product Requirement Document): Jika owner lanjut, bayar tambahan untuk dokumen teknis lengkap
3. Margin dari pengerjaan proyek end-to-end: Owner bayar total harga proyek, platform ambil margin

Belum termasuk di scope saat ini: subscription bulanan, maintenance retainer, atau fee per jam.

### Struktur Margin

Platform fee adalah bagian platform dari harga proyek yang dibayar owner. Mekanik (fee-primitive, dikunci 2026-07-25): AI mengestimasi **harga proyek** dulu, per work package, berdasarkan complexity, required skill level, dan estimated hours. Angka itulah yang ditampilkan ke owner di PRD. Bracket dipilih dari total harga proyek, lalu total itu dibagi menjadi talent payout dan platform fee sesuai persentase bracket. Talenta menerima 100% dari payout yang di-quote ke mereka. Invariant: final_price = talent_payout + platform_fee.

Skema fee NAIK seiring nilai proyek (proyek besar menuntut koordinasi tim, manajemen milestone lintas talenta, dan penanganan dispute yang jauh lebih berat):

| Harga proyek | Talenta | KerjaCUS |
| --- | --- | --- |
| <= Rp 3 juta | 81,5% | 18,5% |
| <= Rp 5 juta | 76,5% | 23,5% |
| <= Rp 10 juta | 71,5% | 28,5% |
| <= Rp 15 juta | 66,5% | 33,5% |
| <= Rp 20 juta | 61,5% | 38,5% |
| <= Rp 30 juta | 56,5% | 43,5% |
| <= Rp 50 juta | 51,5% | 48,5% |
| > Rp 50 juta | 46,5% | 53,5% |

Blended take ~37,7% dari GMV pada mix proyek yang diproyeksikan di `KerjaCUS!_Financial_Projection_2026-2030.xlsx` (base case workbook memakai skema terkunci ini sejak 26 Juli 2026). Ini di atas band managed marketplace transparan (Braintrust 15% flat ke client dengan talenta 100%; Gun.io/Lemon.io markup 15-30%), jauh di atas marketplace lokal mentah (Projects.co.id 12%, Fastwork 17% berjenjang dan dipotong dari freelancer, Upwork ~15-18,5% take total yaitu ~10% sisi freelancer plus ~5% sisi klien), dan di bracket atas setara premium tertutup (Toptal/Gigster markup 40-50%). Risiko yang wajib dimonitor: elastisitas demand owner dan retensi talenta pada bracket >= Rp 20 juta, karena di sana talenta menerima kurang dari 62% harga yang dibayar owner.

CATATAN KODE: `packages/shared/src/pricing.ts` mengimplementasi tabel di atas. Harga proyek adalah primitive: `computeProjectPricing(packages)` menjumlahkan amount semua work package menjadi final_price, memilih bracket dari final_price, menghitung talent_payout = round(final_price × talentShare), lalu platform_fee = final_price − talent_payout (selisih, tanpa rounding drift), dan membagi payout itu pro rata ke tiap work package (`packagePayouts`, package terakhir menyerap sisa pembulatan). Yang diekspor: `PLATFORM_FEE_BRACKETS`, `PLATFORM_FEE_TOP_BRACKET`, `talentShareRate`, `platformFeeRate`, `computeProjectPricing`. Komisi dibukukan sebagai revenue saat escrow release lewat 3-leg ledger entry (DEBIT platform_revenue_account); tidak perlu transaction type `platform_fee` terpisah.

Admin panel menampilkan tabel bracket ini read-only (setting `platform_fee_brackets` di-seed langsung dari konstanta pricing.ts); tidak ada kontrol edit margin karena engine membaca konstanta kode, bukan platform_settings.

Team project pricing: bracket dipilih SEKALI di level proyek dari sum(amount) semua work package. Bracketing per package lalu dijumlahkan salah — proyek Rp 60 juta yang dipecah menjadi empat package Rp 15 juta akan kena 33,5% padahal tabel menetapkan 53,5%, sehingga take platform jadi fungsi dari sehalus apa AI memecah PRD, bukan dari besar deal. Payout proyek dibagi pro rata ke tiap package sesuai porsi amount-nya, jadi rasio talent_payout/amount tiap package sama dengan rasio proyek — rasio yang dibaca `computeMilestoneFee` saat settle milestone.

Transparent Fee Framing: Talent selalu menerima 100% dari quoted payout mereka. Platform fee sudah termasuk dalam harga yang ditampilkan ke owner. Framing di UI: "Talents keep 100% of their quoted amount. Platform service fee is included in the project price." Referensi: Braintrust (0% ke talenta, fee ke client), Gun.io (fee terpisah dan terlihat), Contra (0% freelancer commission).

### Cakupan Proyek

Fokus saat ini di proyek digital (software development, web, mobile app, UI/UX design, data/AI). Bidang hard engineering (sipil, geodesi, geologi) direncanakan untuk fase berikutnya. Arsitektur microservice memastikan penambahan domain baru hanya perlu service baru tanpa mengubah service existing.

## Flow Utama Platform

### 1. Owner Request Project

Owner mengisi form pengajuan proyek dengan field:

- Nama proyek dan deskripsi singkat
- Kategori (Web App, Mobile App, UI/UX Design, Data/AI, Other Digital)
- Budget range (estimasi kasar dari owner)
- Estimasi timeline / deadline yang diharapkan (time bound — input kritis untuk kalkulasi team size oleh AI)
- Konteks/konten detail kebutuhan (free text)
- Info perusahaan/organisasi (opsional)
- Preferensi talent (almamater, pengalaman minimum, skill tertentu, opsional)

Form ini pakai multi-step wizard (bukan satu halaman panjang) supaya tidak overwhelming. Setiap step divalidasi sebelum lanjut ke step berikutnya.

### 2. AI Chatbot Follow-up

Jika deskripsi proyek belum lengkap atau ambigu, chatbot AI melakukan follow-up:

- Menanyakan detail fitur yang dibutuhkan
- Mengklarifikasi target user dan skala aplikasi
- Menanyakan integrasi dengan sistem existing
- Memastikan prioritas fitur (must-have vs nice-to-have)
- Menanyakan referensi aplikasi sejenis (misal: "seperti Tokopedia tapi untuk X"). AI bisa pre-populate fitur berdasarkan referensi

Chatbot terus follow-up sampai informasi cukup untuk menghasilkan BRD yang lengkap.

Sebelum generate BRD, chatbot menampilkan scope summary (ringkasan bullet point dari semua informasi yang dikumpulkan) dan minta konfirmasi owner. Ini mencegah BRD yang salah arah dan mengurangi revisi.

Teknis chatbot:

- AI service (Python FastAPI) melakukan streaming via Z.ai chat completions dengan stream=true + Server-Sent Events; project-service (Hono) mem-proxy stream; frontend membaca SSE via custom hook (useScopingChat) di atas fetch. Vercel AI SDK belum dipakai
- Streaming response supaya user tidak menunggu lama
- System prompt berisi konteks tentang BYTZ, daftar pertanyaan yang perlu dijawab, dan format output yang diharapkan
- Conversation history disimpan di database per project
- Setiap pesan baru, AI mengevaluasi completeness score (0-100). Jika sudah di atas 80, suggest untuk generate BRD
- Template pertanyaan berbeda per kategori proyek (e-commerce punya pertanyaan beda dengan mobile app)
- Model: glm-5.3 (Z.ai) untuk chatbot dan BRD/PRD generation; fine-tuning belum diaktifkan
- RAG: chatbot menggunakan konteks dari proyek-proyek serupa sebelumnya via pgvector similarity search

### 3. Generate BRD

Setelah informasi lengkap, AI menghasilkan BRD yang berisi:

- Executive summary proyek
- Business objectives dan success metrics
- Scope dan batasan proyek
- Functional requirements (daftar fitur detail)
- Non-functional requirements (performa, keamanan, skalabilitas)
- Estimasi harga berdasarkan kompleksitas
- Estimasi timeline dan jumlah orang yang dibutuhkan (AI kalkulasi awal: scope vs time bound owner = team size suggestion)
- Risk assessment (termasuk risk jika timeline terlalu ketat untuk scope yang diminta)

BRD di-generate di AI Service (Python/FastAPI) via GLM JSON mode (generate_json) lalu di-normalisasi dan divalidasi di route agar format konsisten dan bisa langsung di-parse ke UI.

BRD ditampilkan ke owner untuk review. Owner bisa minta revisi melalui chat.

### 4. Owner Decision Point (setelah BRD)

Owner punya tiga pilihan:

- Opsi A: Beli BRD saja, bayar biaya BRD, selesai. Owner bisa pakai BRD untuk dikerjakan sendiri atau vendor lain.
- Opsi B: Lanjut ke PRD. Platform akan buat PRD (dokumen teknis lebih lengkap). Owner bayar tambahan untuk PRD. Setelah PRD jadi, owner bisa ambil PRD dan selesai, atau lanjut ke Opsi C.
- Opsi C: Lanjut develop sampai selesai dengan BYTZ. Platform cari talent, kelola proyek end-to-end.

### 5. Generate PRD (jika pilih Opsi B atau C)

AI menghasilkan PRD (Product Requirement Document) yang lebih teknis dari BRD. PRD berisi:

- Tech stack recommendation, arsitektur sistem, API design, database schema
- Breakdown task per sprint/milestone
- **Team Composition**: AI otomatis menghitung jumlah talent yang dibutuhkan berdasarkan:
  - Scope dan kompleksitas proyek (dari BRD)
  - Timeline yang diminta owner (time bound)
  - Skill yang dibutuhkan (frontend, backend, mobile, UI/UX, data, dll)
  - Estimasi man-hours total dibagi timeline = jumlah talent
  - Misal: proyek butuh 800 man-hours, owner minta selesai 2 bulan (320 jam kerja), maka butuh ~3 talent
  - **Team Templates** (accelerator): pre-built team configurations untuk common project types yang mempercepat AI decomposition:
    - Web App Standard: 1 backend + 1 frontend + 1 UI/UX (3 talents)
    - Mobile App: 1 backend + 1 mobile dev + 1 UI/UX (3 talents)
    - Full-Stack Starter: 1 fullstack + 1 UI/UX (2 talents)
    - Data Platform: 1 backend + 1 data engineer + 1 frontend (3 talents)
    - AI menggunakan template sebagai starting point lalu adjust berdasarkan BRD specifics
  - **Algorithm detail**:
    1. LLM Decomposition: glm-5.3 menganalisis BRD dan menghasilkan daftar work packages dengan required_skills, estimated_hours, dan dependencies. Output via GLM JSON mode (generate_json) di endpoint /generate-prd
    2. Team Size Calculation: `team_size = ceil(total_estimated_hours / (timeline_days * working_hours_per_day))`. Minimum 1, maximum 8 (constraint: platform belum siap kelola tim > 8)
    3. Role Assignment Optimization: jika ada work packages yang bisa di-assign ke satu talent (skill overlap), merge untuk efisiensi. Gunakan greedy algorithm — sort work packages by hours desc, assign ke talent yang masih ada capacity
    4. Dependency Graph: DAG (Directed Acyclic Graph) dari dependencies antar work packages. Validasi: no cycles. Compute critical path via topological sort + longest path
    5. Timeline Validation: jika critical path > timeline owner, AI suggest: (a) tambah talent, (b) extend timeline, (c) reduce scope. Tampilkan trade-off ke owner
- **Task Decomposition**: Jika team > 1 talent, AI otomatis memecah proyek menjadi work packages per role/skill:
  - Setiap work package berisi: milestones, tasks, estimated hours, required skills
  - Dependencies antar work packages (misal: backend harus selesai sebelum frontend integrasi)
  - Parallel work streams yang bisa dikerjakan bersamaan
  - Critical path identification (via topological sort pada dependency DAG)
- **Pricing per Talent**: AI menghitung harga per work package berdasarkan complexity dan skill level yang dibutuhkan. Total harga proyek = sum of all work packages. Platform fee adalah bagian dari total itu (lihat Struktur Margin), bukan tambahan di atasnya

PRD ditampilkan ke owner untuk review. Owner bisa minta revisi melalui chat (termasuk minta adjust jumlah talent atau timeline).
Setelah owner setuju, status berubah ke PRD_APPROVED

### 5b. Owner Decision Point (setelah PRD)

- Jika owner memilih Opsi B: Bayar PRD, ambil dokumen, selesai. Owner bisa pakai PRD untuk dikerjakan sendiri atau vendor lain.
- Jika owner memilih Opsi C: Lanjut ke matching talent dan development.

### 6. Pencocokan Talent-Owner (jika pilih Opsi C)

Semua komunikasi diperantarai platform. Owner dan talent TIDAK berkomunikasi langsung sebelum deal. Ini menjamin:

- Privasi kedua pihak (identitas talent dirahasiakan sebelum deal)
- Semua transaksi terjamin lewat platform
- Mencegah bypass platform (disintermediation)

#### Matching SLA

Platform menjamin waktu matching:

- Single talent project: matched dalam 72 jam (ditampilkan ke owner saat masuk MATCHING state)
- Team project: semua posisi terisi dalam 14 hari
- SLA ditampilkan di UI sebagai countdown/progress indicator

#### Single Talent Project (team_size = 1)

Alur pencocokan sama seperti sebelumnya:

- Platform merekomendasikan talent berdasarkan ML-powered matching (skill, pemerataan, track record, ketersediaan)
- Owner mereview profil anonim, approve atau request talent lain
- Talent menerima atau menolak setelah melihat ringkasan proyek
- Deal: kontrak digital, dana escrow, proyek dimulai

#### Multi-Talent Team Project (team_size > 1)

Jika PRD menentukan butuh lebih dari 1 talent, platform membentuk tim:

- Status berubah ke TEAM_FORMING (sub-state dari MATCHING)
- Platform merekomendasikan talent per work package berdasarkan skill yang dibutuhkan:
  - Setiap work package punya required skills sendiri (misal: work package "Backend API" butuh skill backend + database)
  - Matching algorithm berjalan per work package, bukan per proyek keseluruhan
  - Tetap mengutamakan pemerataan: epsilon-greedy dan fairness constraint berlaku per work package
- Owner mereview semua talent yang direkomendasikan secara anonim (Talent #1 untuk Frontend, Talent #2 untuk Backend, dst)
- Owner bisa approve per talent atau request pengganti untuk posisi tertentu
- Setiap talent menerima atau menolak work package mereka secara independen
- CATATAN KODE: ketiga handler yang menyentuh staffing (confirm, accept, decline di routes/matching.ts) mengunci baris proyek dengan urutan sama — proyek, lalu assignment, lalu work package. Sebelumnya accept memegang lock itu, decline tidak sama sekali, dan confirm mengambilnya paling akhir sambil sudah memegang baris work package, yaitu inversi yang bisa deadlock. Jawaban atas offer juga di-CAS pada `acceptance_status = 'pending'`, karena decline yang mendarat setelah accept membuka kembali work package yang baru saja dihitung menuju `matched`, meninggalkan proyek matched yang memegang package dan /positions menawarkannya lagi ke orang lain. Penjawab kedua mendapat 409
- Jika satu talent menolak, platform cari pengganti hanya untuk posisi tersebut (tidak perlu ulang seluruh tim)
- Batas waktu team formation: 14 hari sejak status MATCHING. Jika belum lengkap, platform menghubungi owner untuk diskusi (adjust timeline/scope atau terima tim yang sudah ada)
- Setelah SEMUA posisi terisi dan kedua pihak setuju:
  - Kontrak digital per talent di-generate (setiap talent punya kontrak sendiri)
  - Dana escrow masuk per work package
  - Status berubah ke MATCHED, lalu IN_PROGRESS
- Pencairan bertahap per milestone per talent

### 7. Eksekusi Proyek

Setelah deal, owner dan talent bisa berkomunikasi melalui platform chat (semua percakapan tercatat dan dimoderasi platform). Komunikasi langsung di luar platform tidak dianjurkan dan melanggar ToS.

#### Single Talent Project

- Talent mengerjakan proyek sesuai PRD
- Progress tracking via Gantt chart dan time tracking di platform
- Owner bisa monitor real-time: milestone progress, time spent, deliverables
- Owner approve milestone, dana cair ke talent
- Setelah semua milestone selesai, owner melakukan final review

#### Multi-Talent Team Project

- Setiap talent mengerjakan work package masing-masing sesuai PRD
- Platform chat: ada group chat (semua talent + owner) dan private chat per talent dengan owner
- Inter-talent chat: talent dalam satu tim bisa chat satu sama lain via platform (untuk koordinasi teknis)
- Progress tracking:
  - Gantt chart menampilkan semua work packages secara terintegrasi, color-coded per talent
  - Owner bisa filter view: per talent, per milestone, atau aggregate (semua talent)
  - Dashboard progress: overall project completion (rata-rata semua work packages), per-talent completion, critical path status
  - Alert otomatis jika satu talent ketinggalan yang bisa block talent lain (dependency)
- Milestone approval:
  - Milestone yang di-assign ke satu talent: owner approve, dana cair ke talent tersebut
  - Milestone integrasi (gabungan beberapa talent): semua talent terkait harus submit, owner approve keseluruhan, dana cair proporsional
  - Owner bisa approve milestone per talent secara independen (tidak perlu menunggu talent lain yang tidak terkait)
- Setelah semua milestone semua talent selesai, owner melakukan final review

#### Auto-Generated Invoices (Semua Tipe Proyek)

- Saat milestone di-approve dan escrow released, platform auto-generate invoice PDF:
  - Invoice number (sequential per project), project details, milestone description
  - Amount, payment method, payment confirmation reference
  - Platform fee breakdown (visible to admin only, not on owner/talent invoice)
  - Tax info placeholder (PPN if applicable, auto-generate e-Faktur data di fase berikutnya)
- Owner dan talent masing-masing dapat copy invoice, plus copy admin — tiga copy, satu invoice number
  - Copy owner hanya memuat gross yang dibayar, copy talent hanya memuat payout
  - Fee adalah selisih keduanya, jadi satu copy tidak boleh memuat dua-duanya
  - Audience ditentukan dari siapa yang request, bukan dari URL yang dikirim client
- Invoice history dashboard: tab "Financials" di project detail dan user dashboard
  - Filter: by project, by date range, by status (pending/released/disputed)
  - Export: CSV/PDF untuk keperluan accounting/tax
  - Running totals: total earned (talent), total spent (owner)

#### Monitoring & Koordinasi (Semua Tipe Proyek)

- Rating bersifat internal (tidak dilihat owner/talent lain), dipakai untuk AI matching dan evaluasi talent oleh platform
- Untuk team project: owner bisa memberikan rating per talent (bukan hanya rata-rata tim)

### Talent Placement (Opsional, Post-Project)

Setelah proyek selesai dan kedua pihak puas, platform menawarkan opsi talent placement:

- Owner bisa mengajukan interest untuk merekrut talent ke perusahaan mereka
- Platform memfasilitasi proses rekrutmen dengan conversion fee (10-15% dari estimasi gaji tahunan talent)
- Tiered fee: fee lebih tinggi untuk hubungan kerja < 1 tahun (platform belum banyak recoup value), fee lebih rendah untuk > 2 tahun (sudah banyak margin terkumpul). Referensi: Upwork menerapkan 13.5% dari estimasi 12-bulan earnings, staffing industry standard 15-25%
- Bundled services opsional: platform bisa memfasilitasi employment compliance, payroll processing sebagai revenue tambahan (model Upwork "Any Hire")
- Legal: conversion fee didokumentasikan di Terms of Service saat signup, diframing sebagai kompensasi atas facilitation dan introduction services (bukan restraint of trade)
- Mencegah "shadow hiring" di luar platform karena ada jalur resmi yang difasilitasi
- Talent tetap bisa menolak tawaran rekrutmen

### Platform Disintermediation Prevention (Behavioral Design)

Desain platform menerapkan prinsip psikologi dan behavioral economics untuk menjaga semua transaksi tetap melalui platform. Referensi: Harvard Business School research menunjukkan paradoks bahwa semakin platform meningkatkan trust antara kedua pihak, semakin tinggi risiko disintermediation — karena dengan trust yang cukup, kedua pihak bisa bypass intermediary.

Anonymity before deal (Trust Transfer Theory): Identitas talent dirahasiakan sebelum deal resmi. Owner mengembangkan "institution-based trust" terhadap platform, yang ditransfer ke talent. Tanpa identitas, owner tidak bisa menghubungi talent langsung. Studi Wharton: restricting external communication technology mengurangi disintermediation ~18%.

Multi-dimensional switching cost: Switching cost bukan hanya finansial, tapi juga: (1) time and effort cost — semua BRD/PRD, chat history, progress data di platform, (2) financial loss — escrow protection hilang, (3) psychological cost — identity dan connection yang sudah dibangun di platform (rating, portfolio, project history). Semakin banyak dimensi yang terlibat, semakin kuat lock-in.

Value-added lock-in (positif): Platform menyediakan fitur yang tidak bisa didapat di luar: escrow protection, Gantt tracking, dispute resolution, milestone management, time tracking, automated invoicing. Owner tetap di platform karena value, bukan karena dipaksa. Prinsip: jangan pernah izinkan manual invoicing di luar platform (Upwork lesson).

Talent Placement sebagai "release valve": Alih-alih owner diam-diam merekrut talent (shadow hiring), platform menyediakan jalur resmi dengan fee transparan. Referensi: Toptal dan Gigster mencegah disintermediation dengan model berbeda — Toptal via continuous margin, Gigster via team-as-a-service yang membuat relasi owner ke tim bukan individu. BYTZ menggabungkan: continuous platform value (escrow, tracking) + conversion fee jika owner ingin hire langsung.

Project-price-based revision fees: Revisi berbasis persentase harga proyek (bukan hourly rate talent) memastikan konsistensi. Alasan: (1) eliminasi talent-rate variance — revisi yang sama bisa cost $50 atau $500 tergantung rate talent, (2) eliminasi perverse incentive — hourly billing mendorong talent bekerja lambat pada revisi, (3) predictability — owner tahu biaya sebelum request, (4) anchoring effect — harga proyek yang sudah disetujui menjadi anchor. Industry standard: agensi menyertakan 2-3 round revisi di base price, revisi tambahan dicharge flat fee. Firms dengan change order process yang disiplin capture 95% lebih banyak additional services revenue.

Platform communication monitoring: Semua komunikasi owner-talent melalui platform chat. Platform bisa mendeteksi percakapan yang mengarah ke bypass (misal: tukar nomor HP, email pribadi) dan memberikan warning otomatis. ToS melarang transaksi di luar platform.

### 8. Admin Monitoring

- Admin BYTZ monitor seluruh proyek via admin panel
- Dashboard: total proyek aktif, revenue, talent utilization, dispute rate
- Alert: proyek yang terlambat, dispute baru, talent yang perlu review
- Bisa intervensi: reassign talent, mediasi dispute, suspend user

### Project Lifecycle (State Machine via XState v5)

Implementasi: XState v5 (29K GitHub stars, MIT license, TypeScript-first). State machine didefinisikan sebagai XState machine (`createMachine`) dengan type-safe transitions (target-only, tanpa guards atau actions). Visual editor di stately.ai untuk desain dan debugging. State disimpan sebagai kolom enum `projects.status` (lower_case), bukan sebagai persisted snapshot; validitas transisi dicek via `getInitialSnapshot`/`getNextSnapshot` plus peta `VALID_TRANSITIONS` statis, dan setiap transisi dicatat ke `project_status_logs`.

Catatan: state names di diagram menggunakan UPPER_CASE untuk readability. Di database enum, semua disimpan sebagai lower_case (draft, scoping, brd_generated, dst).

```
DRAFT -> SCOPING -> BRD_GENERATED -> BRD_APPROVED
  -> PRD_GENERATED -> PRD_APPROVED -> MATCHING -> [TEAM_FORMING] -> MATCHED
  -> IN_PROGRESS -> REVIEW -> COMPLETED

TEAM_FORMING: sub-state dari MATCHING, aktif jika team_size > 1
  - Platform merekomendasikan talent per work package
  - Owner approve/reject per posisi
  - Talent accept/decline per work package
  - Setelah semua posisi terisi -> MATCHED

Exit points (owner bisa selesai dan bayar dokumen saja):
- BRD_APPROVED -> BRD_PURCHASED (Opsi A: beli BRD saja)
- PRD_APPROVED -> PRD_PURCHASED (Opsi B: beli PRD saja)

Side states:
- CANCELLED (bisa dari state manapun sebelum IN_PROGRESS, dan juga dari IN_PROGRESS/PARTIALLY_ACTIVE dengan partial refund)
- DISPUTED (dari IN_PROGRESS atau REVIEW)
- ON_HOLD (dari IN_PROGRESS)
- PARTIALLY_ACTIVE (dari IN_PROGRESS, jika satu talent dalam tim terminated tapi yang lain masih aktif)

ON_HOLD valid transitions:
- ON_HOLD -> IN_PROGRESS (proyek dilanjutkan setelah hold, trigger event project.resumed)
- ON_HOLD -> CANCELLED (owner memutuskan tidak lanjut)
- ON_HOLD -> DISPUTED (ada dispute baru saat on hold)

DISPUTED valid transitions:
- DISPUTED -> IN_PROGRESS (dispute resolved, proyek dilanjutkan)
- DISPUTED -> CANCELLED (dispute resolved, proyek dibatalkan)
- DISPUTED -> COMPLETED (dispute resolved, deliverables diterima)

PARTIALLY_ACTIVE valid transitions:
- PARTIALLY_ACTIVE -> IN_PROGRESS (talent pengganti ditemukan, semua posisi terisi kembali)
- PARTIALLY_ACTIVE -> CANCELLED (owner membatalkan seluruh proyek)
- PARTIALLY_ACTIVE -> DISPUTED (ada dispute baru)
- PARTIALLY_ACTIVE -> REVIEW (semua work packages remaining selesai)
- Tidak bisa kembali ke TEAM_FORMING (replacement matching berjalan di background, tidak mengubah status utama proyek)
```

Setiap perpindahan state dicatat di tabel project_status_logs untuk audit trail.

## Kebijakan Escrow, Revisi, Pembatalan, dan Dispute

### Escrow dan Auto-Release

Single talent project:

- Dana owner masuk escrow sebelum pengerjaan dimulai (untuk fixed-price per milestone)
- Setelah talent submit milestone, owner punya 14 hari untuk review dan approve
- Jika owner tidak merespons dalam 14 hari, dana otomatis cair ke talent (auto-release)
- Auto-release mencegah owner menahan pembayaran tanpa alasan

Multi-talent team project:

- CATATAN KODE: escrow disetor SEKALI di level proyek, bukan per work package. `CreateSnapToken` memakai `projects.final_price` dan tidak pernah mengisi `transactions.work_package_id`, jadi tidak ada baris deposit yang bisa dicocokkan ke satu package. Alokasi per package hidup di `work_packages.talent_payout` dan dibaca saat release (`computeMilestoneFee`), bukan di transaksi deposit
- Konsekuensi yang sudah ditegakkan: dispute yang di-scope ke satu work package TIDAK bisa direfund. `DisputeService` melempar `DISPUTE_SCOPE_UNSUPPORTED` alih-alih diam-diam merefund seluruh proyek atau melewati blok refund lalu tetap menandai dispute resolved — dan resolved bersifat terminal, jadi kegagalan diam berarti escrow beku selamanya di kasus yang tidak bisa dibuka lagi. Menolak adalah jawaban jujur sampai deposit membawa package
- Escrow total tetap: total_escrow = sum(work_package_amount) = final_price. Platform fee dipotong dari escrow saat release, bukan disetor terpisah
- Setiap talent punya milestones sendiri, pencairan independen per talent per milestone
- Auto-release 14 hari berlaku per talent per milestone (tidak menunggu talent lain)
- Milestone integrasi (cross-talent): dana di-hold sampai semua talent terkait submit, lalu owner review keseluruhan. Auto-release 14 hari dihitung dari submit terakhir
- Jika satu talent terminated mid-project: escrow work package talent tersebut dibekukan, milestone yang belum selesai dikembalikan ke owner, milestone yang sudah di-approve tetap dibayar. Platform cari pengganti, escrow di-reallocate ke talent baru

### Kebijakan Revisi per Milestone

- Setiap milestone termasuk 2 putaran revisi gratis
- Revisi harus masih dalam scope yang sudah disepakati di PRD
- Jika owner minta perubahan di luar scope, itu dianggap change request dan perlu kesepakatan tambahan (harga dan timeline baru)

Revisi tambahan (setelah 2 putaran gratis):

- Owner mengajukan request revisi tambahan melalui chatbot platform
- Chatbot menganalisis scope revisi dan menghitung biaya otomatis
- Biaya revisi tambahan berdasarkan persentase harga proyek (BUKAN rate per jam talent) untuk konsistensi:
  - Revisi minor (perubahan kecil, UI tweak): 3-5% dari harga milestone terkait
  - Revisi moderate (perubahan fungsionalitas): 8-12% dari harga milestone terkait
  - Revisi major (fitur baru / perubahan arsitektur): dianggap change request, butuh estimasi ulang. Change request diproses sebagai revision_request baru dengan severity=major dan is_paid=true. AI menghitung ulang harga dan timeline, disimpan di revision_requests table. Tidak perlu tabel terpisah — revision_requests sudah cukup untuk tracking change requests
- Setelah biaya dihitung, request dikirim ke talent untuk di-approve atau decline
- Talent bisa decline jika revisi di luar kemampuan atau scope terlalu besar
- Jika talent decline, platform mencarikan solusi (negosiasi scope atau reassign)
- Owner harus bayar biaya revisi tambahan sebelum talent mulai mengerjakan
- Batas waktu pengajuan revisi: 7 hari setelah milestone disubmit

### Kebijakan Pembatalan (dengan Time Bounds)

#### Sebelum talent mulai (status sebelum IN_PROGRESS)

- Owner bisa batalkan proyek kapan saja
- Dana escrow dikembalikan penuh ke owner dalam 3 hari kerja
- Biaya BRD/PRD yang sudah dibayar tidak bisa direfund (dokumen sudah dihasilkan)
- Batas waktu: owner punya 30 hari sejak status MATCHED untuk memulai proyek. Jika tidak dimulai dalam 30 hari, proyek otomatis dibatalkan dan escrow dikembalikan
- Team project: jika dibatalkan saat TEAM_FORMING (belum semua posisi terisi), escrow dikembalikan penuh

#### Setelah talent mulai (status IN_PROGRESS) — Single Talent

- Milestone yang sudah di-approve dan dicairkan tidak bisa direfund
- Milestone yang sedang dikerjakan: platform menilai progres dalam 5 hari kerja, bayar proporsional ke talent
- Milestone yang belum dimulai: dana dikembalikan ke owner dalam 3 hari kerja
- Platform mencarikan talent pengganti dalam 7 hari kerja jika owner ingin melanjutkan
- Batas waktu pembatalan oleh owner: harus mengajukan dalam 3 hari setelah menemukan masalah pada milestone yang sedang dikerjakan

#### Setelah talent mulai (status IN_PROGRESS) — Multi-Talent Team

Owner membatalkan seluruh proyek:

- Sama seperti single talent, tapi diterapkan per talent:
- Setiap talent dinilai secara independen: milestone approved dibayar, sedang dikerjakan dinilai proporsional, belum dimulai direfund
- Semua kontrak per talent di-terminate
- Total refund = sum(refund per talent untuk milestone belum selesai)

Owner membatalkan satu talent saja (partial cancellation):

- Proyek tetap berjalan dengan talent lain (status PARTIALLY_ACTIVE)
- Talent yang dibatalkan: milestone approved dibayar, sedang dikerjakan dinilai proporsional, belum dimulai direfund
- Platform mencarikan talent pengganti untuk work package yang ditinggalkan dalam 7 hari kerja
- Talent lain yang terkena dependency dari work package yang vacant: timeline di-extend otomatis, platform komunikasikan ke owner
- Jika pengganti tidak ditemukan dalam 14 hari, platform diskusi dengan owner: re-scope proyek, adjust timeline, atau cancel work package tersebut

#### Jika talent tidak aktif mengerjakan proyek

- Jika talent tidak ada progress selama 7 hari berturut-turut tanpa pemberitahuan, platform kirim warning
- Jika setelah warning 3 hari masih tidak ada respons, platform bisa reassign talent
- Dana milestone yang belum selesai dikembalikan ke owner dalam 3 hari kerja
- Talent mendapat penalti di rating internal dan pemerataan_skor
- Team project: reassignment hanya untuk talent yang bermasalah, talent lain tetap lanjut. Platform otomatis extend due_date milestone yang tergantung pada talent yang di-reassign (+ 7 hari grace period)

#### Jika talent membatalkan (abandon)

- Milestone yang belum selesai: dana dikembalikan ke owner dalam 3 hari kerja
- Talent mendapat penalti di rating internal dan pemerataan_skor
- Jika abandon lebih dari 2 kali, talent disuspend dari platform
- Team project: sama seperti di atas, proyek tetap berjalan dengan talent lain. Platform cari pengganti untuk work package yang ditinggalkan

#### Refund timeline

- Refund escrow (sebelum IN_PROGRESS): 3 hari kerja
- Refund milestone yang belum dimulai: 3 hari kerja
- Refund proporsional (milestone sedang dikerjakan): 5-7 hari kerja (butuh assessment progress)
- Refund dari dispute resolution: 3 hari kerja setelah keputusan final
- Refund partial cancellation (team project, per talent): 3-5 hari kerja
- Semua refund diproses melalui payment gateway (Midtrans/Xendit), waktu actual tergantung metode pembayaran (instant untuk e-wallet, 1-3 hari untuk bank transfer)

#### Time bounds per milestone

- Talent harus submit milestone sebelum due_date yang disepakati
- Jika melewati due_date + 7 hari grace period, owner bisa mengajukan dispute atau pembatalan milestone
- Setelah talent submit, owner punya 14 hari untuk review (auto-release setelahnya)
- Setelah owner request revisi, talent punya 7 hari untuk menyelesaikan revisi
- Team project: due_date per talent per milestone. Jika satu talent melewati due_date dan work package lain tergantung padanya, platform otomatis notifikasi semua pihak dan extend due_date talent yang terdampak

### Dispute Resolution (3-Step Structured Process)

Alur penyelesaian sengketa (3 tahap eskalasi):

**Step 1 — Direct Resolution (3 hari kerja)**:

1. Owner atau talent mengajukan dispute melalui platform (dengan bukti: screenshot, file, timeline)
2. Status proyek berubah ke DISPUTED, dana escrow dibekukan
3. Platform membuka admin_mediation chat channel antara kedua pihak + admin mediator
4. Kedua pihak diberi kesempatan 3 hari kerja untuk menyelesaikan sendiri dengan bantuan chat mediator
5. Jika resolved: admin confirm resolution, status kembali ke IN_PROGRESS atau COMPLETED

**Step 2 — Admin Mediation (5 hari kerja)**: 6. Jika Step 1 gagal, admin mereview semua bukti dari kedua pihak 7. Admin menghubungi kedua pihak terpisah untuk klarifikasi 8. Admin mengajukan proposal resolusi (misal: split 70-30, partial refund + delivery) 9. Kedua pihak punya 2 hari untuk menerima atau menolak proposal

**Step 3 — Binding Decision (2 hari kerja)**: 10. Jika proposal ditolak, admin membuat keputusan final (binding, tidak bisa banding) 11. Keputusan bisa berupa: dana dirilis ke talent, dana dikembalikan ke owner, atau dibagi proporsional 12. Keputusan didokumentasikan di dispute record dengan detail reasoning

Team project disputes:

- Dispute bisa diajukan terhadap satu talent tertentu (tidak perlu dispute seluruh proyek)
- Hanya escrow work package talent yang di-dispute dibekukan, talent lain tetap berjalan
- Jika dispute melibatkan integration milestone (cross-talent), platform menentukan kontribusi masing-masing talent
- Keputusan dispute per talent, bukan per proyek keseluruhan
- Talent lain yang terdampak dependency dari talent yang di-dispute: timeline di-extend, platform komunikasikan

Kasus dispute yang umum:

- Kualitas deliverable tidak sesuai spesifikasi PRD
- Talent tidak responsif atau melewati deadline
- Owner mengubah requirement di luar scope tanpa kesepakatan
- Perselisihan tentang apa yang termasuk "dalam scope"
- Team project: satu talent tidak deliver tapi yang lain sudah selesai (partial dispute)

### NDA dan IP Agreement

- Platform menyediakan template NDA dan IP transfer agreement standar
- Template di-generate otomatis sebagai bagian dari kontrak digital saat proyek dimulai
- Inti: semua hasil kerja (kode, desain, dokumen) menjadi milik owner setelah pembayaran selesai
- Talent tidak boleh menggunakan kode owner untuk proyek lain
- Kedua pihak setuju untuk menjaga kerahasiaan informasi bisnis
- Team project: setiap talent menandatangani NDA dan IP agreement sendiri-sendiri. Talents dalam satu tim juga terikat NDA terhadap satu sama lain (tidak boleh share informasi proyek ke luar tim)

## Talent Vetting dan Evaluasi

### Vetting: CV Parsing dan AI Extraction

Proses vetting talent hanya satu tahap otomatis (tanpa skill assessment manual atau probation period, untuk menjamin pemerataan proyek):

1. Talent registrasi: data diri, CV upload (PDF/DOCX/PPTX), portfolio links (GitHub, Dribbble, Behance, LinkedIn, dll)
2. CV diparsing per format (pypdfium2/python-docx/python-pptx) di AI Service lalu diekstrak via GLM structured output (schema di prompt, divalidasi Pydantic)
3. Hasil parsing dicocokkan dengan input manual talent untuk validasi silang
4. Setelah CV berhasil diparsing dan divalidasi, talent langsung berstatus "verified" dan bisa menerima proyek

Tidak ada skill assessment manual atau probation period karena:

- Skill assessment menciptakan barrier yang menghambat pemerataan (talent yang tidak pandai tes tapi kompeten bisa tersingkir)
- Probation period menciptakan bias terhadap talent baru (monitoring lebih ketat = lebih mudah mendapat rating buruk)
- Kualitas talent dinilai dari CV, portfolio, dan riwayat proyek yang sudah diparsing AI, bukan dari tes buatan

### Talent Portfolio (Structured)

Talent portfolio ditampilkan sebagai structured cards (bukan free text):

- Setiap portfolio item: project title, category, tech stack tags, duration, role played, 1-3 screenshots (opsional), key outcomes
- Proyek yang selesai melalui BYTZ mendapat "Verified on BYTZ" badge dengan data aktual: on-time delivery, within budget, completion status
- Auto-endorsed skills: skills yang digunakan di proyek BYTZ ter-endorse otomatis (misal: "React Native — used in 3 BYTZ projects")
- External portfolio: links ke GitHub, Dribbble, Behance tetap bisa ditambahkan tapi tanpa verified badge
- Portfolio di-render di profil talent (private view) dan di profil anonymous (matching view, tanpa nama proyek owner)

### Owner Review Talent (Anonymous)

Saat matching, owner bisa mereview profil talent yang direkomendasikan platform:

- Profil ditampilkan TANPA nama talent (anonymous, hanya Talent #1, Talent #2, dst)
- Yang bisa dilihat owner: ringkasan CV (pengalaman, pendidikan, skill), structured portfolio cards (dengan verified badges), domain expertise, jumlah proyek selesai di platform, auto-endorsed skills
- Owner TIDAK bisa melihat: nama asli, rating internal, tier internal, kontak langsung, portfolio_links (URL GitHub/LinkedIn membawa nama asli dan jalur kontak di luar platform; baru terbuka setelah deal)
- Tujuan: owner menilai berdasarkan kompetensi, bukan reputasi atau bias nama/institusi

### Talent Tiers (Internal Only)

Tier talent bersifat INTERNAL ONLY — tidak terlihat oleh talent maupun owner. Digunakan hanya oleh sistem:

- Junior: 0-2 tahun pengalaman, portfolio terbatas
- Mid: 2-5 tahun pengalaman, beberapa proyek selesai
- Senior: 5+ tahun pengalaman, track record kuat

Tier hanya digunakan untuk:

- Adjusted pricing: rate yang digunakan dalam pricing engine berbeda per tier (tapi owner hanya lihat harga final proyek, bukan tier talent)
- AI matching relevance: tier sebagai salah satu feature dalam algoritma matching, tapi TIDAK sebagai filter (semua tier tetap bisa mendapat semua proyek)
- Internal monitoring: admin bisa melihat distribusi proyek per tier untuk memastikan pemerataan

Tier TIDAK digunakan untuk:

- Membatasi proyek mana yang bisa dilihat talent (semua talent melihat semua proyek yang sesuai skill)
- Membuat prestige atau ranking yang terlihat
- Memprioritaskan talent tertentu secara signifikan (bobot tier dalam matching harus kecil)

### Rating dan Review (Internal Only)

Rating dan review bersifat INTERNAL ONLY — tidak terlihat oleh owner lain atau talent lain:

- Setelah proyek selesai, owner dan talent saling memberikan rating (1-5) dan review
- Rating TIDAK ditampilkan di profil publik talent atau di halaman matching
- Rating digunakan untuk: AI matching (sebagai feature), evaluasi performa talent oleh admin, quality control internal
- Talent bisa melihat rating sendiri di dashboard pribadi (untuk self-improvement), tapi owner tidak bisa melihat rating talent lain
- Alasan internal only: mencegah "rich get richer" effect di mana talent dengan rating tinggi selalu dipilih, menghambat pemerataan

### Quality Control Berkelanjutan

- Semua quality control berdasarkan rating internal (tidak terlihat publik)
- Talent dengan average_rating di bawah 3.5 setelah 3+ proyek mendapat warning internal dari admin
- Talent dengan average_rating di bawah 3.0 setelah 5+ proyek disuspend sementara
- Talent yang disuspend bisa mengajukan banding dan improvement plan
- Admin memonitor distribusi proyek per tier dan per talent untuk memastikan pemerataan tetap terjaga

## Sistem Distribusi dan Pemerataan Proyek

Salah satu value utama BYTZ adalah pemerataan proyek ke talent. Bukan hanya talent top yang dapat semua proyek. Sistem ini menggunakan kombinasi rule-based scoring dan ML model, dengan penekanan kuat pada kesempatan bagi talent baru.

### Prinsip Pemerataan

- Talent baru tanpa rating/proyek HARUS punya kesempatan tinggi mendapat proyek (cold start problem)
- Tidak boleh ada "rich get richer" effect di mana talent berpengalaman monopoli proyek
- Tier internal tidak boleh menjadi filter yang membatasi akses proyek
- Rating internal tidak boleh menjadi satu-satunya penentu (karena talent baru belum punya rating)

### Strategi Cold Start (Exploration vs Exploitation)

Cold start problem: platform harus learn atribut talent baru (explore) agar bisa match lebih baik di masa depan (exploit). Setiap talent adalah separate multi-armed bandit problem, coupled oleh constrained job supply. Referensi: Lyft menerapkan full online reinforcement learning untuk matching, menghasilkan $30M+ incremental annual revenue.

Epsilon-greedy approach (rule-based, Fase 1-5) untuk menyeimbangkan kualitas matching dengan pemerataan:

- Exploration (30%): 30% slot rekomendasi dialokasikan untuk talent yang belum banyak/belum pernah dapat proyek, terlepas dari skor matching mereka (selama skill dasar cocok)
- Exploitation (70%): 70% slot menggunakan skor matching optimal (rule-based atau ML)
- Epsilon menurun secara bertahap per talent: setelah talent menyelesaikan 3+ proyek, slot exploration mereka berkurang. Tujuan: setiap talent punya minimal portfolio awal

New Talent Boost: Talent baru mendapat temporary increased visibility di listing rekomendasi (mirip Etsy new listing boost). Tujuan: platform mengumpulkan data performa talent secepat mungkin untuk improve matching quality. Boost berkurang setelah 2-3 proyek pertama selesai.

Graduated Exposure: Talent baru dimulai dari proyek yang lebih kecil/less complex (jika tersedia), lalu exposure meningkat seiring positive track record. Ini melindungi owner sekaligus memberi talent kesempatan membuktikan diri.

Hybrid Recommender: Kombinasi content-based approach (skills, portfolio quality dari CV parsing) dengan collaborative filtering (apa yang dikerjakan talent serupa dengan sukses). Transfer learning: apply insights dari talent dengan profil serupa untuk infer capability talent baru.

Transparent Fairness Communication: Eksplisit komunikasikan ke talent bagaimana sistem pemerataan bekerja. Riset behavioral economics menunjukkan: procedural fairness sama pentingnya dengan outcome fairness — jika talent percaya sistem adil, mereka lebih loyal meskipun tidak selalu dapat proyek. Tanpa komunikasi fairness, "losers" cenderung salah mempersepsikan kompetisi sebagai tidak adil.

Alternative approach (Fase 6): Thompson Sampling — setiap talent punya probability distribution yang di-update setelah setiap proyek selesai. Talent baru punya distribusi lebar (high uncertainty = high exploration), talent berpengalaman distribusi sempit. Riset menunjukkan Thompson Sampling memiliki advantage riil dibanding epsilon-greedy dan UCB1 karena otomatis adaptif.

### Prioritas Assignment

1. Talent yang belum pernah dapat proyek sama sekali (prioritas tertinggi, agar semua talent punya portfolio)
2. Talent yang sedang tidak mengerjakan proyek aktif dan punya sedikit proyek selesai
3. Talent yang sudah pernah dapat proyek tapi sedang tidak sibuk
4. Talent yang sedang mengerjakan proyek (prioritas terendah)

### Tetap Mempertimbangkan

- Skill match: talent harus punya kemampuan yang relevan dengan proyek (hard requirement, bukan hanya bobot)
- Track record: riwayat penyelesaian proyek tepat waktu (tapi talent baru diberi benefit of the doubt)
- Availability: kesediaan waktu yang cukup
- Rating internal: sebagai signal kualitas, tapi bobot kecil untuk tidak menghukum talent baru
- Tier internal: sebagai signal pengalaman, tapi bobot sangat kecil

### Algoritma Skor Rekomendasi (Rule-based, Fase 1-5)

```
skor_rekomendasi = (skill_match * 0.30) + (pemerataan_skor * 0.35) + (track_record * 0.20) + (rating * 0.15)
```

Bobot pemerataan (0.35) paling besar untuk memastikan distribusi merata. Rating (0.15) paling kecil untuk tidak menghukum talent baru.

Detail perhitungan tiap komponen:

skill_match (0-1):

- Hybrid fuzzy matching pipeline (3 stages, cascade):
  1. Exact match: lookup langsung di canonical skill taxonomy (skills table + aliases JSONB)
  2. String similarity: Jaro-Winkler distance (threshold > 0.85) untuk mencocokkan nama skill yang mirip tapi beda penulisan
  3. Semantic similarity: embedding cosine similarity via pgvector (threshold > 0.7) untuk menangkap skill yang secara konsep sama tapi nama beda (misal: "React" vs "React.js" vs "ReactJS")
- Bobot lebih tinggi untuk primary skill vs secondary skill
- Formula: `(jumlah_skill_cocok / total_skill_dibutuhkan) * weight_per_skill`
- Canonical skill taxonomy: master `skills` table dengan aliases, category, dan embedding. Dikelola oleh admin. Setiap skill baru yang ditemukan dari CV parsing di-review dan ditambahkan ke taxonomy

pemerataan_skor (0-1):

- Berbanding terbalik dengan jumlah proyek aktif dan total proyek
- Formula: `1 / (1 + proyek_aktif * 2 + total_proyek_selesai * 0.1)`
- Talent baru (0 proyek): skor 1.0 (maksimal)
- Talent dengan 1 proyek aktif: skor sekitar 0.33
- Talent dengan 0 aktif tapi 10 selesai: skor sekitar 0.5
- Bonus: talent yang belum pernah dapat proyek sama sekali (0 proyek aktif DAN 0 selesai) mendapat +0.2 pada skor_rekomendasi final (bukan pada pemerataan_skor — untuk mereka pemerataan_skor sudah 1.0), capped at 1.0

track_record (0-1):

- Berdasarkan: persentase proyek selesai tepat waktu, tingkat kepuasan owner (rating internal)
- Talent baru: default 0.6 (benefit of the doubt, lebih tinggi dari rata-rata)
- Formula: `(on_time_rate * 0.6) + (satisfaction_rate * 0.4)`

rating (0-1):

- Normalisasi dari rating 1-5 ke 0-1
- Talent baru tanpa rating diberi default 0.7 (tinggi, benefit of the doubt — jangan menghukum talent baru)
- Formula: `(avg_rating - 1) / 4`
- Rating ini internal only, tidak terlihat oleh owner

### ML-based Matching (setelah 100+ proyek selesai)

Setelah data historis cukup, rule-based scoring digantikan/dilengkapi ML model:

- Model: CatBoost (Yandex, Apache 2.0) dijalankan di AI Service (Python) — native categorical feature handling tanpa manual encoding, LightGBM sebagai benchmark comparison
- Features: skill vectors, rating history (internal), completion rate, time patterns, project complexity score, owner satisfaction history, pemerataan_skor, tier internal
- Constraint: model harus dilatih dengan fairness constraint supaya pemerataan tetap terjaga (tidak hanya optimisasi match success rate)
- Training: retrain mingguan dengan data proyek yang sudah selesai
- Output: probability score bahwa talent akan sukses menyelesaikan proyek
- Epsilon-greedy tetap berlaku: 30% slot exploration bahkan saat ML aktif
- Fallback: jika ML service down, gunakan rule-based scoring
- Evaluation: A/B test rule-based vs ML, track match success rate DAN distribution fairness (Gini coefficient per talent)

## Talent Onboarding

### Registrasi Talent

- Data diri (nama, email, nomor HP wajib format +62 dan unik per akun dengan verifikasi OTP, lokasi)
- Upload CV (PDF/DOCX/PPTX, maks 5MB — parsing per format via pypdfium2/python-docx/python-pptx)
- Link portfolio (GitHub, Dribbble, Behance, LinkedIn, dll)
- Pilih kategori skill (Frontend, Backend, Fullstack, Mobile, UI/UX, Data, DevOps, dll)
- Pengalaman kerja (tahun)
- Pendidikan (universitas, jurusan, tahun lulus)
- Sertifikasi atau kursus relevan (opsional)

### CV Parser Pipeline

Urutan proses parsing CV:

1. Upload: File masuk ke S3-compatible storage via presigned URL (browser upload langsung ke R2/MinIO, bypass backend), metadata disimpan di database
2. Document Parsing: AI Service (Python) mengekstrak text per format:
   - PDF: pypdfium2 (text-based; belum ada OCR untuk scanned PDF, fallback decode teks)
   - DOCX: python-docx; PPTX: python-pptx
   - Output: plain text (belum ada layout analysis)
3. Structured Extraction: text diproses di AI Service via GLM structured output (glm-5.3, schema dikirim di prompt lalu divalidasi Pydantic); fallback regex/Aho-Corasick bila LLM gagal:
   - nama, kontak
   - riwayat_pendidikan: [{universitas, jurusan, tahun_lulus, ipk}]
   - pengalaman_kerja: [{perusahaan, posisi, mulai, selesai, deskripsi}]
   - proyek: [{nama, deskripsi, tech_stack, url}]
   - skills: [string]
   - sertifikasi: [{nama, penerbit, tahun}]
4. Skill Matching: skill hasil ekstraksi LLM dipakai apa adanya; saat ekstraksi LLM gagal, fallback di AI service memakai Aho-Corasick exact/alias + Levenshtein fuzzy terhadap daftar skill in-file. Pencocokan ke canonical skill taxonomy (exact + alias) terjadi di project-service saat profil disimpan (bukan Jaro-Winkler/embedding di jalur CV ini)
5. Validasi Silang: Data hasil parsing dibandingkan dengan data yang diinput manual oleh talent. Jika ada perbedaan signifikan, tampilkan ke talent untuk konfirmasi
6. Sinkron: endpoint project-service /parse-cv memanggil AI service /api/v1/ai/parse-cv (await fetch) di dalam request lalu menyimpan hasilnya. pg-boss belum dipakai

### Dashboard Talent

- Lihat proyek yang tersedia dan sesuai skill (difilter otomatis berdasarkan skill match, SEMUA proyek terlihat oleh semua tier)
- Apply ke proyek dengan satu klik (profil sudah lengkap)
- Lihat status aplikasi (pending, diterima, ditolak)
- Tracking proyek yang sedang dikerjakan (milestone, deadline, Gantt view, work package yang di-assign)
- Team project: lihat siapa rekan tim, progress masing-masing, dependency alerts
- Time tracking: log waktu kerja per task/milestone
- Riwayat proyek dan rating internal sendiri (hanya talent yang bisa lihat rating pribadinya, untuk self-improvement)
- Notifikasi proyek baru yang sesuai skill

## Project Management Tools

### Gantt Chart (Owner dan Talent View)

- Library: SVAR React Gantt (@svar-ui/react-gantt v2.4+, MIT license, TypeScript, drag-and-drop)
- Tampilkan timeline per milestone dan task
- Dependencies antar task (finish-to-start, start-to-start)
- Critical path highlighting
- Zoom level: hari, minggu, bulan
- Owner view: read-only, monitoring progress
- Talent view: bisa update progress dan log time (hanya task milik talent tersebut)

Multi-talent team view:

- Gantt chart menampilkan semua work packages dan tasks dalam satu view terintegrasi
- Color-coded per talent (setiap talent punya warna berbeda untuk task mereka)
- Swimlane view: baris per talent, menampilkan task masing-masing secara paralel
- Cross-talent dependencies ditampilkan sebagai garis penghubung antar swimlane
- Filter: owner bisa filter per talent, per work package, atau lihat aggregate
- Talent hanya bisa edit task miliknya, tapi bisa lihat timeline talent lain (untuk koordinasi)
- Alert visual: task yang overdue atau blocking task talent lain ditandai merah

### Time Tracking

- Talent log waktu kerja per task
- Timer start/stop atau manual entry
- Daily/weekly summary
- Owner bisa lihat total time spent per milestone, per talent (untuk team project)
- Team project: dashboard summary menampilkan time spent per talent dan total project
- Data dipakai untuk improvement estimasi di proyek berikutnya (termasuk estimasi team size)
- Tidak dipakai untuk billing (model fixed-price per milestone), tapi untuk transparansi

### Milestone Board

- Kanban-style view: Pending, In Progress, Submitted, Revision Requested, Approved, Rejected
- Milestone status flow: pending -> in_progress -> submitted -> approved (happy path). Submitted -> revision_requested -> in_progress (revision cycle). Submitted -> rejected (final rejection by owner, triggers dispute or re-scoping)
- Drag-and-drop status update (talent side)
- File attachment per milestone submission
- Comment thread per milestone
- Due date dan overdue indicator
- Team project: board menampilkan milestones grouped per talent, dengan kolom "Integration" untuk milestones yang butuh multiple talent
- Filter per talent atau lihat semua

## Admin Panel

### Overview

Admin panel lengkap untuk monitoring dan manajemen BYTZ secara keseluruhan. Dibangun sebagai apps/admin (React + TanStack Router, BUKAN Refine) yang berjalan di port terpisah (5174) dari main web app (5173). Di production, admin panel diakses via subdomain admin.bytz.id. Admin memiliki login page sendiri yang memvalidasi role=admin. Semua request ke admin-service API divalidasi via middleware yang mengecek session cookie + role admin.

### Dashboard Admin (BI/Analytics)

Metrics utama (dihitung langsung dari tabel dasar saat dashboard dibuka):

- Total proyek per status (aktif, completed, cancelled), conversion funnel (BRD -> PRD -> development)
- Revenue: harian, mingguan, bulanan, kumulatif, breakdown per revenue stream (BRD/PRD/project margin)
- Talent utilization rate: rata-rata proyek aktif per talent, distribusi per tier
- Average project completion time vs estimated time
- Dispute rate, resolution time, outcome distribution (funds_to_talent/owner/split)
- New user registrations trend (owner dan talent, per minggu)
- AI usage: total cost per hari/minggu, cost per model, rata-rata tokens per interaction
- Matching performance: success rate, average time-to-match, exploration vs exploitation ratio
- Platform health: active services, error rate, latency P95 (dari OpenObserve metrics)

Charts dan visualisasi:

- Line chart: revenue trend, user growth, project volume over time
- Bar chart: proyek per kategori, talent distribusi per skill
- Funnel chart: conversion rate per state machine stage
- Heatmap: waktu aktivitas user (jam/hari), popular skill combinations
- Pie chart: revenue breakdown, dispute causes

Data export: CSV/PDF untuk semua dashboard views. Scheduled weekly report ke admin email masih rencana — tidak ada job-nya di scheduled-jobs.ts dan pg-boss belum dipakai

### Manajemen User

- List semua user (owner dan talent) dengan filter dan search
- Detail profil user, riwayat proyek, rating internal
- Suspend/ban user dengan alasan
- Verify talent manual (override CV parsing result)
- Reset password, update role
- Lihat tier internal talent, distribusi proyek per talent/tier

### Manajemen Proyek

- List semua proyek dengan filter per status, team_size (single/team)
- Detail proyek: timeline, milestones per talent, work packages, transactions per talent, chat history
- Intervensi: reassign talent, ubah status, adjust pricing
- Proyek yang terlambat (overdue alert)

### Manajemen Keuangan

- Transaction log lengkap
- Escrow balance
- Payout history ke talent
- Revenue report (harian, mingguan, bulanan)
- Refund management

### Manajemen Dispute

- List dispute aktif
- Review bukti dari kedua pihak
- Mediasi tools (chat admin-user)
- Keputusan dan pencairan dana

### Sistem dan Konfigurasi

- Platform settings (matching weights, exploration rate, auto-release timer). Bracket fee ditampilkan read-only karena dikunci di pricing.ts

CATATAN KODE: lima kontrol di halaman settings menulis ke `platform_settings` dan
tidak ada engine yang membacanya. `matching_weights`, `exploration_rate`,
`auto_release_days`, `free_revision_rounds`, dan `max_team_size` disimpan lewat
admin-service lalu dibaca kembali ke form, jadi konsol menampilkan nilai yang
tersimpan. Tapi yang dipakai saat berjalan adalah konstanta hasil kompilasi dari
`packages/shared/src/constants.ts`: `MATCHING_WEIGHTS` dan `EXPLORATION_RATE` di
matching.service.ts, `AUTO_RELEASE_DAYS` di auto-release-sweep.ts,
`FREE_MILESTONE_REVISIONS` di milestone.service.ts, `MAX_TEAM_SIZE` di
projects.ts. Grep `platform_settings` di seluruh apps/ dan packages/ hanya
menemukan admin-service, UI admin, schema, dan seed — nol pembaca di
project-service, payment-service, notification-service, maupun ai-service.

Lebih buruk daripada diam: `dashboard.go` menulis baris `admin_audit_logs`
bertipe `config.update` dengan nilai barunya, jadi jejak audit mencatat perubahan
kebijakan yang tidak pernah berlaku. Bracket fee sudah benar ditangani (read-only
dengan alasan tertulis); kelima kontrol ini belum. Pilihannya dua dan keduanya
keputusan produk: buat engine membaca tabel itu (butuh cache, fallback saat baris
tidak ada, dan invalidasi lintas replika), atau jadikan read-only seperti bracket
fee dan katakan pada operator bahwa lima tuas ini setara kode.
- AI model configuration (model selection, temperature, max tokens)
- Audit log semua aksi admin

## Tech Stack

### Frontend

- Runtime: Bun 1.3.x (package manager dan bundler)
- Framework: React 19 dengan TypeScript (strict mode)
- Build Tool: Vite 8 (Rolldown-based unified Rust bundler, 10-30x faster builds) dengan plugin @tailwindcss/vite dan @tanstack/router-plugin/vite (import: TanStackRouterVite)
- Routing: TanStack Router v1 (file-based routing, type-safe params/search, auto code splitting)
- Data Fetching: TanStack Query v5 (server state, caching, background refetch, optimistic update)
- Owner State: Zustand v5 (minimal boilerplate, bisa persist ke localStorage). Breaking change v5: selectors yang return array/object baru tiap render bisa cause infinite loop — gunakan `useShallow` dari `zustand/shallow` untuk wrap selectors tersebut
- Styling: Tailwind CSS v4 (utility-first, zero runtime, CSS variables untuk design tokens)
- UI Components: komponen hand-rolled di src/components/ui (button, card, modal, tabs, badge, input, toast, dll) pakai React + Tailwind, aksesibilitas manual. Belum ada @radix-ui / components.json (bukan shadcn/Radix)
- Form: React useState (multi-step wizard) + Zod untuk validasi. React Hook Form / @hookform/resolvers belum dipakai
- Chat/AI UI: custom hooks (useScopingChat, useChatMessages di src/hooks) di atas fetch + useState; streaming AI scoping via fetch (SSE) ke /api/v1/ai. Vercel AI SDK / @ai-sdk/react belum dipakai
- Internationalization: react-i18next + i18next (multi-language Indonesian/English)
- Gantt Chart: SVAR React Gantt (@svar-ui/react-gantt v2.4+, MIT license, TypeScript, drag-and-drop, task dependencies)
- Icons: Lucide React (tree-shakeable, konsisten dengan shadcn)
- Date: date-fns (tree-shakeable, immutable)
- BRD/PRD Preview: dirender sebagai komponen React/HTML di apps/web (brd.tsx, prd.tsx) — tidak ada PDF viewer/dependency PDF di frontend. @react-pdf/renderer hanya dipakai server-side (Project Service) untuk generate PDF yang di-download
- PDF Generation: @react-pdf/renderer (server-side, renderToBuffer di Project Service untuk BRD/PRD export dan invoices; template React di apps/project-service/src/templates). Typst tidak dipakai

Struktur folder frontend:

```
apps/web/
  src/
    routes/              # file-based routes (TanStack Router)
      _authenticated/    # layout route untuk halaman yang butuh login
      _public/           # layout route untuk halaman publik
    components/
      ui/                # reusable UI components (badge, button, input, card, tabs, modal, toast, skeleton, empty-state, error-boundary)
      layout/            # toast-container
    lib/
      api.ts             # API client: plain fetch wrapper (apiFetch) atas string URL. hono/client tidak dipakai — paket `hono` bukan dependency apps/web, jadi tidak ada hc() maupun AppType (belum type-safe RPC)
      i18n.ts            # i18next initialization
      constants.ts       # config, enum values
      utils.ts           # helper functions
    locales/
      id/                # Bahasa Indonesia translations
        common.json
        auth.json
        project.json
        talent.json
        chat.json
        document.json
        matching.json
        payment.json
        errors.json
      en/                # English translations
        common.json
        auth.json
        project.json
        talent.json
        chat.json
        document.json
        matching.json
        payment.json
        errors.json
    stores/              # Zustand stores
    hooks/               # custom React hooks
    types/               # shared TypeScript types
```

### Backend (Microservices)

Arsitektur microservice dengan setiap service sebagai Hono app terpisah dalam monorepo. Setiap service punya tanggung jawab spesifik dan berkomunikasi via NATS message broker untuk async events dan REST untuk sync calls.

Service-service utama:

**API Gateway (Traefik v3)**:

- Reverse proxy dan load balancer
- Routing request ke service yang tepat
- SSL termination, rate limiting global
- Health check endpoints
- Auto-discovery via Docker labels

**Auth Service (Hono + Better Auth)**:

- Runtime: Bun
- Framework: Hono v4
- Auth: Better Auth v1.5+ (session-based, Drizzle adapter, RBAC, cookie cache, Hono integration)
- Login: email+password dan Google OAuth (socialProviders.google built-in di Better Auth)
- Session token di httpOnly + Secure + SameSite=Lax cookie
- Password hashing: scrypt (Better Auth built-in default — node:crypto scrypt, @noble/hashes fallback)
- Session cookie cache: enabled, maxAge 5 minutes (reduce DB lookups per request)
- RBAC: 2 roles di main app (owner, talent). Admin terpisah di apps/admin (port 5174) dengan admin-service API yang memvalidasi session+role via middleware
- Hono middleware pattern: extract session di middleware, set user/session ke Hono context variables (c.set("user", session.user))
- Route handler: auth.handler(c.req.raw) untuk semua /api/v1/auth/\* routes
- Endpoint: `/api/v1/auth/*`

**Project Service (Hono)**:

- Runtime: Bun
- Lifecycle management: CRUD proyek, state machine via XState v5 (18 project states, type-safe transitions, visual editor di stately.ai, built-in persistence API untuk DB snapshots)
- Work package management: create from PRD, assign talents, track per-package status
- Team formation: coordinate multi-talent matching, track team completeness
- Milestone management: create, update status, file attachments, per-talent dan integration milestones
- Time tracking: log entries per task/milestone per talent
- Gantt data: task dependencies, scheduling, cross-talent dependencies
- Escrow logic: hold, release, auto-release timer, per-talent escrow split
- Endpoint: `/api/v1/projects/*`, `/api/v1/work-packages/*`, `/api/v1/milestones/*`, `/api/v1/time-logs/*`

**AI Service (Python FastAPI)**:

- Runtime: Python 3.12+ dengan UV (package manager, lebih cepat dari pip/poetry)
- Framework: FastAPI
- LLM: `z-ai/glm-5.3` lewat OpenRouter di `https://openrouter.ai/api/v1/chat/completions` (Bearer key, API bentuk OpenAI). Tidak ada SDK vendor; `httpx.AsyncClient` dipakai bersama satu proses, bukan dibuat per panggilan. Embedding lewat endpoint yang sama, jadi satu key untuk keduanya
- Chatbot: glm-5.3 via prompt engineering (fine-tuning belum diaktifkan)
- Structured Output: GLM TIDAK punya response_schema. `response_format` hanya menerima `text` atau `json_object`, jadi `generate_structured` mengirim JSON Schema di system prompt lalu memvalidasinya dengan Pydantic. Jalur itu sudah ada sebelumnya sebagai fallback Gemini; sekarang ia jalur utama
- Thinking: GLM-5.3 selalu bernalar dan penalarannya tidak ikut di-stream. OpenRouter membacanya lewat `reasoning: {effort}`, BUKAN pasangan `thinking.type` plus `reasoning_effort` milik Z.ai. Service mengunci effort ke `low`; dikirim dengan nama lama, model bernalar di default-nya sendiri dan memakan budget output untuk sesuatu yang tidak pernah ditampilkan, tanpa error apa pun yang memberi tahu
- Temperature: rentang GLM adalah [0.0, 1.0], separuh rentang Gemini. Semua call site ada di 0.1 sampai 0.7 jadi tidak ada yang perlu diskalakan, tapi nilai baru di atas 1.0 akan ditolak, bukan di-clamp
- BRD/PRD Generation: glm-5.3 via JSON mode (generate_json), lalu di-normalisasi dan divalidasi di route (PRD termasuk team composition, work package decomposition, dependency analysis)
- CV Parsing: pypdfium2 (PDF), python-docx (DOCX), python-pptx (PPTX) untuk ekstraksi teks + glm-5.3 structured extraction, dengan fallback regex/Aho-Corasick bila LLM gagal
- ML Matching: CatBoost (Yandex, Apache 2.0, native categorical feature handling — superior untuk skill/domain/tier features tanpa manual encoding) dengan LightGBM sebagai benchmark comparison, experiment tracking via MLflow (Fase 6 — belum diimplementasikan; matching aktif masih rule-based di project-service)
- RAG: pgvector untuk similarity search, embedding voyage-4-large (lihat di bawah), hybrid search (BM25 + vector di-fuse via RRF). Cross-encoder reranking belum diimplementasikan
- Endpoint: `/api/v1/ai/*`

CATATAN KODE: satu provider, satu env var. `OPENROUTER_API_KEY` membawa chat
dan embedding sekaligus; `ZAI_API_KEY`, `LLM_API_KEY`, dan `VOYAGE_API_KEY`
sudah tidak dibaca di mana pun. Riwayat sebelumnya adalah dua vendor terpisah,
karena Z.ai memang tidak menerbitkan endpoint embedding sama sekali.

Provider DINYATAKAN, bukan diserahkan ke default, dan ini bagian yang paling
mudah dilewatkan. Satu model id dilayani banyak provider dengan kecepatan
berbeda. Diukur atas 36 sampel yang diselang-seling dengan prompt yang sama,
membiarkan OpenRouter memilih memberi first-token P95 11,65 detik lawan 3,29
detik langsung ke Z.ai, karena BaseTen, Inceptron, dan Together masing-masing
melayani sebagian trafik dan yang paling lambat menentukan ekornya. Dipin
dengan fallback dimatikan: BaseTen 1,83 detik atas 12 sampel tanpa error,
Inceptron 1,40 detik tapi gagal 4 dari 12. Karena itu `PROVIDER_ORDER` di
`llm.py` adalah BaseTen lalu Inceptron, dengan fallback tetap HIDUP: pin keras
menukar ekor panjang dengan satu titik kegagalan, yaitu kebalikan dari alasan
trafik dilewatkan router.

Angka itu juga memperbaiki catatan lama di bagian Performance Requirements.
P95 first-token yang tercatat 2,00 detik dan gagal memenuhi anggaran 1 detik
diukur langsung ke Z.ai; lewat BaseTen ia 1,83 detik. Masih di atas anggaran,
dan penyebabnya tetap struktural — GLM-5.3 selalu bernalar dan penalarannya
tidak di-stream — tapi ekornya jauh lebih rapat.

Embedding memakai `voyageai/voyage-4-large` pada 1024 dimensi. Yang menentukan
pindah dari gemini-embedding-001 bukan kualitas melainkan panjang input:
Google menerima 2.048 token sedangkan sebuah BRD tidak muat di angka itu, jadi
setiap dokumen dipotong ke bagian pembukanya sebelum diindeks dan sisanya tidak
pernah bisa dicari. voyage menerima 32.000 token. Ini tidak membuat chunking
tidak perlu — satu vektor atas satu dokumen tetap merata-ratakan bagian yang
menjawab query — tapi kerugiannya berhenti terjadi sebelum chunking sempat
dijalankan.

`voyage-4-large` dipilih di atas `voyage-4` meski dua kali lipat per token,
karena pada volume ini selisihnya sekitar satu dolar setahun sementara kualitas
retrieval menggerbangi setiap passage yang dilihat model. Memasangkan model
frontier dengan retriever yang lebih murah tidak menghemat apa pun yang layak.

1024 adalah ukuran yang didukung, satu dari 256/512/1024/2048 di ruang embedding
yang sama, jadi pindah ke 2048 nanti adalah re-embed dan bukan ganti model. 1024
dipilih di atas 2048 karena melipatduakan dimensi juga melipatduakan byte per
baris di pgvector dan waktu build HNSW, untuk selisih MRL yang angka Voyage
sendiri taruh di bawah 3 persen, pada VPS yang sudah memikul 25 service.
Diverifikasi langsung ke API: vektornya kembali sudah unit-length, jadi
normalisasi di `embedding.py` adalah no-op yang benar dan bukan koreksi.

`input_type` disambungkan per pemanggil: `rag.py` meng-embed string pencarian
sebagai `query`, semua pemanggil lain menyimpan `document`. Terbalik berarti
recall turun tanpa error di mana pun.

Menyelfhost model embedding multilingual sempat dipertimbangkan dan ditolak
terhadap kotak ini: VPS punya 2 core dan 8 GB sementara compose produksi
menjalankan 25 service termasuk dua instance Postgres dan Temporal. bge-m3
(1024 dim, MIT, kuat di Bahasa Indonesia) adalah pilihan yang benar kalau ada
core untuk itu, tapi inferensi neural di jalur request scoping akan berebut CPU
dengan Postgres pada setiap pesan. voyage-4 tidak memakai sumber daya VPS sama
sekali.

**Payment Service (Go + Fiber)**:

- Runtime: Go 1.25
- Framework: Fiber v2 (Express-inspired, zero-alloc routing)
- Database: pgx v5 (fastest Go PostgreSQL driver, built-in connection pooling)
- Integrasi: Midtrans atau Xendit
- Transaction management: escrow in/out, refund
- Double-entry bookkeeping: setiap money movement = debit+credit entries yang sum to zero (accounts + ledger_entries tables). Menjamin ledger selalu balanced, audit-proof, reconcilable. Pattern: Stripe Ledger. Go pgx transactions untuk atomic operations
- Idempotency: idempotency_key per transaksi
- Webhook handler dari payment gateway
- Endpoint: `/api/v1/payments/*`
- Escrow HANYA terisi lewat pembayaran Midtrans yang settled. Route
  POST /payments/escrow dihapus karena menerima nominal dari body dan menulis
  ledger tanpa gateway, sehingga owner bisa menambah saldo escrow sendiri

**Notification Service (Go + nats.go)**:

- Runtime: Go 1.25
- NATS client: nats.go v1.39+ (reference NATS JetStream client, best performance)
- Database: pgx v5
- Framework: Fiber v2 (untuk REST endpoints)
- In-app notifications (database + push via Centrifugo)
- Email transaksional via Resend (resend-go SDK)
- Real-time transport: Centrifugo (Go, Apache 2.0, standalone WebSocket server, 1M connections/node, language-agnostic HTTP API, integrates dengan NATS). Backend services publish via Centrifugo Server API (HTTP/gRPC), Centrifugo handles semua WebSocket connections, fan-out, presence tracking, reconnection. Built-in channel permissions, message history, presence detection
- Event listener dari NATS (project.status.changed, payment.completed, dll)
- Go goroutines untuk concurrent event processing — ideal untuk high-volume NATS stream consumption
- Endpoint: `/api/v1/notifications/*`, `/ws/*`

**Admin Service (Go + Fiber)**:

- Runtime: Go 1.25
- Framework: Fiber v2
- Database: pgx v5
- API backend untuk admin panel
- Dashboard analytics queries (query langsung ke tabel dasar)
- User management, project management
- Audit logging
- Platform configuration
- Endpoint: `/api/v1/admin/*`

Shared across services:

- Validation: Zod v4 (7-14x faster dari v3, type instantiations turun dari 25K ke 175. Zod Mini tersedia ~1.9KB gzipped untuk client-side. Schema dishare via monorepo packages/shared)
- ORM: Drizzle ORM (type-safe, SQL-like API, migration via drizzle-kit). Driver: drizzle-orm/postgres-js (postgres.js v3, battle-tested 4+ tahun, full drizzle-kit compatibility). Catatan: bun:sql (native Bun SQL module) lebih cepat ~50% di raw benchmarks tapi masih ada concurrent statement bugs dan drizzle-kit push incompatibility — migrasi ke drizzle-orm/bun-sql saat issues resolved (one-line config change)
- Database: PostgreSQL 17 (satu database bersama, semua tabel di schema `public` — tidak ada pgSchema di packages/db maupun CREATE SCHEMA di migrasi; pemisahan per domain hanya di level file schema Drizzle. Split per service jika ada bottleneck). PG17 features yang dipakai: JSON_TABLE untuk query JSONB columns (cv_parsed_data, preferences, metadata) tanpa manual JSON extraction, faster VACUUM, improved HNSW index performance. pgvector 0.8.2+ (CVE fix). Extensions: pgvector. pg_cron belum dipasang; job terjadwal berjalan di project-service (scheduled-jobs.ts)
- Cache: Valkey (BSD-3, Linux Foundation fork of Redis — Redis 7.4+ moved to RSALv2/SSPLv1, which is not OSI open source). Drop-in over the RESP protocol, so `redis://` URLs and redis clients are unchanged. Dipakai notification-service untuk consumer idempotency (prefix `notif:idem:`, TTL 7 hari, degrade ke no-op kalau REDIS_URL kosong atau ping gagal) dan oleh rate limiter auth-service serta project-service (prefix `rl:`) supaya window-nya dibagi lintas replika. Rate limiter degrade ke hitungan per proses, bukan ke no-op: mematikan limit justru saat dependensi tidak sehat adalah kebalikan dari yang dibutuhkan. Session store TIDAK pakai Valkey (Better Auth menyimpan session di Postgres via drizzleAdapter), dan AI response cache belum ada
- Job Queue: pg-boss DIRENCANAKAN untuk background jobs (document generation, notification sending, ML training) tapi BELUM ada di codebase (tidak di package.json mana pun). Saat ini CV parsing & document generation berjalan sinkron di request; event async lewat NATS + outbox, dan outbox-nya di-drain loop in-process project-service (outbox-worker.ts), bukan pg-boss. Job terjadwal juga in-process (scheduled-jobs.ts), bukan pg_cron
- Logging: Pino via hono-pino (structured JSON logging), shipped ke OpenObserve via OTLP
- Observability: OpenObserve (AGPL-3.0 — OSI-approved; self-hosting tanpa modifikasi tidak memicu kewajiban disclosure. Single Rust binary, terukur ~70MB idle) — unified logs + traces + metrics dalam satu platform. Menggantikan Loki + Jaeger + Prometheus + Grafana (4 tools → 1). OTLP-native, S3/R2 compatible storage backend. Services kirim OTLP langsung ke OpenObserve (`:5080/api/{org}`, Basic auth) — tidak perlu Collector sebagai perantara. UI built-in untuk log search, trace visualization, metrics dashboards
- Telemetry: OpenTelemetry SDK + OpenTelemetry Collector (vendor-neutral, OTLP export ke OpenObserve)
- Connection Pooling: PgBouncer (transaction mode, ~10MB RAM) — multiplexes service connections ke PostgreSQL. Best practice untuk microservice architecture dengan shared database, mencegah connection exhaustion saat scaling replicas
- Message Broker: NATS with JetStream (persistent messaging, exactly-once delivery, message deduplication). Client library: @nats-io/transport-node + @nats-io/jetstream (modular packages)

### AI/ML Architecture

4 konsep AI/ML yang diimplementasikan:

**1. AI as a Service (Z.ai GLM)**:

- Inferensi LLM ke OpenRouter (`openrouter.ai/api/v1`) lewat httpx, bukan SDK vendor. Model `z-ai/glm-5.3`, dengan preferensi provider yang dinyatakan dan fallback hidup
- Semua fungsi (chatbot, BRD, PRD, CV parsing, spec parsing) memakai glm-5.3
- Structured output: schema dikirim di prompt dan divalidasi Pydantic, karena GLM hanya punya response_format json_object; JSON mode (generate_json) untuk BRD/PRD; fallback JSON extraction
- Cost/latency di-log ke tabel ai_interactions + OTLP traces ke OpenObserve
- TensorZero sudah tidak ada. Container-nya tidak lagi muncul di docker-compose.yml maupun docker-compose.prod.yml, dan tidak pernah berada di jalur inferensi waktu masih ada. Upstream juga sudah diarsipkan 2026-06-12
- Langfuse tidak dipakai — v3 mewajibkan Postgres + ClickHouse + Redis + S3 + worker container terpisah, dengan minimum resmi 16 GiB

**2. Fine-tuned LLM (Project Scoping Chatbot)**:

- Base model: glm-5.3 (Z.ai), saat ini via prompt engineering; fine-tuning belum diaktifkan
- Training data: conversation logs dari project scoping yang sukses (setelah 50+ proyek)
- Format: JSONL dengan system/user/assistant messages
- Fine-tuning via OpenAI API (bukan self-hosted training)
- Tujuan: chatbot lebih fokus dan konsisten dalam menggali kebutuhan proyek digital
- Sebelum data cukup: pakai prompt engineering dengan few-shot examples
- Evaluasi: completeness score accuracy, user satisfaction rating

**3. ML Model (Talent-Project Matching)**:

- Model: CatBoost (Yandex, Apache 2.0) di Python AI Service — native categorical feature handling tanpa manual one-hot encoding, superior untuk BYTZ matching features (skills, domain, tier, category semua categorical). LightGBM sebagai benchmark comparison
- Features: skill vector (TF-IDF), rating history, completion rate, response time, project complexity, owner satisfaction, domain expertise, tier (categorical native)
- Training: batch retrain mingguan via scheduled job (Fase 6 — belum ada; pg-boss belum dipakai)
- Experiment tracking: MLflow (self-hosted, Docker container) — track hyperparameters, metrics, model versions, dataset snapshots
- Model registry: MLflow model registry, promote model ke "production" stage setelah evaluation pass
- Serving: FastAPI endpoint, response < 100ms
- Fallback: rule-based weighted scoring jika ML service down
- Evaluation: A/B test rule-based vs ML, track match success rate + fairness metrics (Gini coefficient)
- LLM Evaluation: DeepEval (50+ metrics, pytest native, DAG deterministic scoring) + Ragas (RAG-specific: Context Precision, Context Recall, Faithfulness) — keduanya integrate sebagai MLflow third-party scorers. DeepEval untuk chatbot quality (Knowledge Retention, Conversation Completeness, hallucination detection), Ragas untuk RAG pipeline tuning

**4. RAG (Retrieval Augmented Generation)**:

- Vector store: pgvector extension di PostgreSQL (tidak perlu database terpisah)

CATATAN KODE: Qdrant dan valkey-search dievaluasi sebagai vector store terpisah
dan ditolak, dan alasan utamanya keamanan, bukan memori. Arm vektor di
`hybrid_search` membawa predikat tenant yang mengJOIN tabel `projects`:

```sql
AND project_id IN (SELECT id FROM projects WHERE owner_id =
    (SELECT owner_id FROM projects WHERE id = %s))
```

Itu access control, dan docstring di atasnya mencatat bahwa versi tanpa predikat
ini pernah membocorkan BRD setiap owner ke prompt scoping owner lain. Memindahkan
vektor ke store terpisah menghapus JOIN itu dan menyisakan dua pilihan yang
sama-sama buruk: menyalin `owner_id` ke payload Qdrant dan menjaganya tetap
sinkron, yang mengubah bug sinkronisasi menjadi kebocoran lintas tenant, atau
mengambil top-K tanpa filter lalu memfilter di Python, yang adalah post-filtering
dan mengembalikan kosong untuk owner yang bukan pengguna terbesar platform.

Skalanya juga belum menuntut apa pun. Pada 1024 dimensi, 20.000 vektor (kira-kira
10.000 proyek) adalah 82 MB mentah dan sekitar 160 MB dengan HNSW. Qdrant
menyebut minimum produksinya sendiri 12 vCPU dan 32 GB, sementara kotak ini 2
core dan 8 GB dengan 25 service. valkey-search menahan vektor di RAM permanen,
dan Valkey di sini justru didesain degrade ke no-op saat `REDIS_URL` kosong, jadi
ia cache dan bukan store of record. pgvector menaruh vektor di baris yang sama
dengan dokumennya, jadi satu transaksi, tanpa dual-write dan tanpa job
rekonsiliasi. Tinjau ulang di sekitar 1 juta vektor.
- Embedding model: `voyageai/voyage-4-large` pada 1024 dimensi via `output_dimension`, jendela input 32.000 token, `input_type` query/document. Lewat OpenRouter, key yang sama dengan inferensi
- Data yang di-embed: BRD/PRD yang sudah diapprove, project descriptions, skill descriptions
- Index: HNSW (Hierarchical Navigable Small World) untuk fast approximate nearest neighbor. BUKAN IVFFlat (HNSW lebih akurat dan tidak butuh training step)
- HNSW parameters: m=16, ef_construction=200 (good balance accuracy vs build time)
- Use case: chatbot mengambil konteks dari proyek serupa sebelumnya untuk improve scoping quality
- Query pipeline (3-stage retrieval):
  1. BM25 search via PostgreSQL `tsvector` + `ts_rank` (keyword/lexical match)
  2. Vector search via pgvector cosine similarity (semantic match)
  3. Cross-encoder reranking via sentence-transformers (Python, di AI Service) — rerank top-20 candidates dari BM25+vector, +5-15% retrieval accuracy. Model: mixedbread-ai/mxbai-rerank-large-v2 (Apache 2.0, Qwen-2.5 architecture, outperforms Cohere/Voyage on BEIR benchmarks)
  - RRF: `score = sum(1 / (k + rank_i))` dengan k=60 untuk merge BM25+vector sebelum cross-encoder rerank
  - Pipeline: BM25 (top-20) + Vector (top-20) → RRF merge → return top-4. Cross-encoder rerank belum ada
- Chunking strategy: section-aware, di tabel `document_chunks` (satu baris per
  section, dengan `document_id`, `document_type`, `project_id`, `section_title`,
  `section_order`, `content`, `embedding`). Kedua arm `hybrid_search` membaca
  tabel itu untuk brd/prd; `skills` tidak ikut karena nama skill tidak punya
  section. Pemotongan mengikuti struktur dokumen, bukan hitungan karakter:
  potongan berukuran tetap akan memotong di tengah requirement dan jatuh di
  tempat berbeda untuk tiap dokumen, yang justru dicegah oleh adanya heading.
  Tiga bentuk diperlakukan berbeda, dan tiap pilihan soal apa yang bisa
  dicocokkan query: list `{title, content}` jadi satu chunk per item karena
  `functional_requirements` adalah bagian yang paling sering ditanya dan
  menaruh delapan fitur dalam satu chunk mengulang masalah perataan satu
  tingkat lebih dalam; list string tetap satu chunk karena satu objective
  terlalu pendek untuk jadi target retrieval; angka digabung jadi satu chunk
  `estimates` karena empat baris berisi satu integer tidak pernah terambil oleh
  query bahasa alami dan hanya mengencerkan kandidat.
  `project_id` sengaja didenormalisasi ke chunk. Predikat tenant di arm vektor
  adalah access control, bukan filter, dan pencarian tanpa scope pernah
  menyisipkan BRD setiap owner ke prompt scoping owner lain. Mengambil owner
  lewat join di tiap baris kandidat menaruh pengecekan itu di belakang sesuatu
  yang bisa hilang diam-diam.
  Tulis berarti ganti, bukan tambah: DELETE lalu INSERT dalam satu transaksi.
  Penulis sebelumnya adalah UPDATE berkunci document id dan tidak bisa
  menduplikasi apa pun; chunk adalah baris, jadi redelivery JetStream tanpa
  DELETE akan menggandakan setiap section dan salinannya ikut bersaing di
  kandidat yang sama.
  Kolom `embedding` di brd_documents dan prd_documents masih ada tapi tidak
  dibaca lagi. Semuanya NULL, tapi menghapus kolom yang masih disebut SQL
  container yang sedang berjalan adalah urutan dua-deploy yang dokumen ini
  jelaskan sendiri, bukan bersih-bersih gratis
- Threshold: cosine similarity > 0.5, final top 4 results setelah reranking

**Document Parsing Pipeline** (bagian dari CV Parser, di AI Service Python):

- pypdfium2 (PDF), python-docx (DOCX), dan python-pptx (PPTX) sebagai document parsing engine per format
  - Multi-format: satu extractor per format (pypdfium2 untuk PDF text-based, python-docx, python-pptx)
  - Belum ada layout analysis maupun OCR untuk scanned PDF (fallback: decode teks)
  - Output: plain text yang diteruskan ke structured extraction (GLM json_object + validasi Pydantic)
  - Semua library open source di pyproject.toml
- Language: Indonesian + English (multi-language support built-in)
- Pre-processing: deteksi format dari ekstensi/mime, ekstraksi teks per format (pypdfium2/python-docx/python-pptx)
- Post-processing: clean up parsing artifacts, normalize whitespace, merge fragmented sections
- Confidence scoring: jika parsed content terlalu sedikit (<100 kata), minta user upload ulang
- Fallback: jika ekstraksi teks atau LLM gagal, endpoint mengembalikan 502 agar talent bisa re-parse (belum ada queue pg-boss)
- File upload: presigned URL pattern — browser upload langsung ke R2/MinIO, backend hanya generate signed URL dan validasi metadata

### Monorepo Structure

```
bytz/
  apps/
    web/                 # Frontend React app (owner + talent views, port 5173)
    admin/               # Admin panel React app (admin only, port 5174, separate login)
    gateway/             # Traefik config
    auth-service/        # Auth Service (Hono + Better Auth)
    project-service/     # Project Service (Hono)
    ai-service/          # AI Service (Python FastAPI)
    payment-service/     # Payment Service (Go + Fiber)
    notification-service/# Notification Service (Hono)
    admin-service/       # Admin Service (Hono + Refine API)
  packages/
    shared/              # Shared Zod schemas, types, constants, enums, error codes
    db/                  # Drizzle schema, owner, migrations, seed
    nats-events/         # NATS event type definitions, publisher/subscriber helpers, outbox
    logger/              # Pino config, structured logging, correlation ID middleware
    config/              # Zod-based env validation, service config loader
    ui-kit/              # formatter dan design token untuk web + admin
    go-observability/    # sumber kanonik OTLP + trace context, digenerate ke tiap Go service
  biome.json             # Biome config (linter + formatter)
  turbo.json             # Turborepo config
  package.json           # Root workspace config (Bun workspaces)
  bun.lockb              # Bun lockfile
  docker-compose.yml     # All services + PostgreSQL 17 + PgBouncer + Valkey 9 + NATS + MinIO + OpenObserve + Traefik + Centrifugo + Temporal
  docker-compose.prod.yml  # Production overrides (secrets via env vars / .env; Infisical belum di-deploy)
  .env.example           # Template environment variables
```

Package manager: Bun workspaces (Bun 1.3.x)
Monorepo tool: Turborepo (build orchestration, caching, parallel task execution)

### Infrastructure (Production)

Semua pilihan berdasarkan: ada free tier atau murah, open source friendly, cocok untuk startup.

- Container Orchestration: Docker Compose, Kubernetes (k3s) untuk scale
- API Gateway: Traefik v3 di dev (auto-discovery, Let's Encrypt SSL, Docker native), tapi PROD memakai nginx. CATATAN KODE: `docker-compose.yml` menjalankan service `traefik` dengan `apps/gateway/traefik.yml` dan `dynamic.yml`; `docker-compose.prod.yml` menjalankan service `api-gateway` yang dibangun dari `apps/gateway/Dockerfile.api-gateway` dengan `nginx-api-gateway.conf`, dan tidak menjalankan Traefik sama sekali. Dua reverse proxy berbeda mengerjakan pekerjaan yang sama di dua environment, yang berarti routing rule, header, timeout, dan rate limit ditulis dua kali dan hanya satu yang teruji di tempat yang penting. Ini pelanggaran dev/prod parity (12-factor #10, terdaftar di bagian ini juga). Memilih salah satu adalah keputusan infrastruktur dengan dua konsumen hidup, jadi dicatat di sini alih-alih diputuskan sepihak
- Hosting: Dokploy (Apache 2.0, self-hosted PaaS, native Docker Compose support, deploy via API dari GitHub Actions, Let's Encrypt SSL) di VPS (Hetzner/Contabo)
- Database: Neon PostgreSQL (serverless, branching per PR, free tier 0.5GB) + pgvector extension
- Connection Pooling: PgBouncer (transaction mode, ~10MB RAM, ISC license)
- Redis: Upstash (serverless Redis, free tier 10k commands/hari)
- Message Broker: NATS (self-hosted di container, lightweight)
- Real-time Transport: Centrifugo (self-hosted Docker container, Go, Apache 2.0)
- Workflow Orchestration: Temporal (MIT license, self-hosted Docker container, TypeScript SDK). Durable workflow execution untuk complex multi-service sagas (escrow → milestone → payment → notification), auto-retry, visual debugging UI
- File Storage: docker-compose.prod.yml currently runs self-hosted MinIO (S3_ENDPOINT: http://minio:9000), not Cloudflare R2. MinIO's community edition was archived 2026-04-25: no releases, no reviewed patches, no official binaries, so a future CVE is ours to find and fix. The code is S3-compatible and the move to R2 is a config change (S3_ENDPOINT, credentials). Uploaded CVs contain personal data, which is the reason to prioritise it. Upload via presigned URLs (browser straight to storage)
- Domain dan DNS: Cloudflare (free)
- Email: Resend (free tier 3.000 email/bulan)
- Payment Gateway: Midtrans atau Xendit (VA, QRIS, bank transfer, GoPay, OVO, Dana, ShopeePay)
- Secret Management: Infisical (self-hosted, open source, Docker container). Centralized secret management untuk semua services. Rotasi otomatis, audit trail, environment-based (dev/staging/prod). Menggantikan .env files di production
- Error Tracking: Sentry (free tier 5k events/bulan)
- Uptime Monitoring: Uptime Kuma (MIT license, self-hosted, ~80MB RAM, unlimited monitors) untuk internal service monitoring + Better Stack (free tier 5 monitors) untuk external/public endpoint monitoring
- Observability: OpenObserve (AGPL-3.0, OSI-approved. Single Rust binary, terukur ~70MB idle) — unified logs + traces + metrics. Menggantikan Loki + Jaeger + Prometheus + Grafana (4 tools → 1). Catatan: cache memory dan disk di-size dari resource HOST, bukan cgroup limit — wajib set ZO_MEMORY_CACHE_MAX_SIZE dan ZO_DISK_CACHE_MAX_SIZE di VPS
- Telemetry Pipeline: OpenTelemetry Collector (vendor-neutral OTLP export ke OpenObserve)
- Feature Flags: belum dipakai. Flagsmith sempat dijalankan (2 container, ~384MB di prod) tapi tidak pernah dipanggil dari kode mana pun dan tidak ada fitur di roadmap yang mengonsumsinya, jadi dihapus (YAGNI). A/B matching rule-based vs ML via MLflow. Tambahkan kembali kalau ada consumer nyata
- CI/CD: GitHub Actions (free untuk public repo, 2000 menit/bulan untuk private)
- Analytics: Umami (MIT, self-hosted, privacy-friendly, lightweight)
- AI Gateway: OpenRouter, sebagai layanan, bukan container. TensorZero sempat di-deploy tapi tidak pernah membawa satu pun panggilan inferensi dan upstream diarsipkan 2026-06-12 setelah perusahaannya bubar, jadi container-nya sudah dihapus dari kedua compose file. Yang berbeda kali ini: OpenRouter benar-benar berada di jalur inferensi, dan yang dibeli darinya adalah harga per call yang dilaporkan, failover lintas provider, dan satu key untuk chat plus embedding
- Local LLM Development: belum ada Ollama. Dev dan prod sama-sama memanggil OpenRouter dengan OPENROUTER_API_KEY
- LLM Observability: tabel ai_interactions (model, token, latency, cost per panggilan) plus OTLP trace ke OpenObserve, tanpa container tambahan. `cost_usd` sekarang diisi dari `usage.cost` yang dilaporkan OpenRouter, bukan dari perkalian token dengan tabel tarif; tabel tarif tinggal sebagai fallback saat response tidak membawa harga. Ini menghapus satu kelas bug, bukan satu instance: tarif yang dipelihara tangan pernah menetap di angka gemini-2.5-flash selama berbulan-bulan setelah inferensi pindah ke GLM. Yang tetap tidak bisa dijawab dashboard OpenRouter adalah biaya per proyek dan per owner, karena ia tidak tahu proyek ini ada; itu hanya ada di ai_interactions lewat project_id dan user_id. Langfuse dievaluasi dan ditolak: v3 butuh 6 container dengan minimum resmi 16 GiB, tidak muat di VPS 8GB

### Development Tools

- Linter + Formatter: Biome 2.x (Rust-based, menggantikan ESLint + Prettier, 10-100x lebih cepat)
- Git Hooks: Lefthook (MIT, Go binary, parallel execution, native monorepo support, YAML config — menjalankan biome check --no-errors-on-unmatched --staged pada file *.{js,ts,tsx,jsx,json} sebelum commit (lint gate, stage_fixed: true))
- Testing: Vitest v4 (unit dan integration test, compatible dengan Vite 8). Breaking change v4: test options sekarang argument kedua (bukan ketiga): `test('name', { retry: 2 }, () => {})`
- E2E Testing: tidak ada. `@playwright/test` dan `playwright-bdd` sempat terpasang sebagai devDependency tanpa satu pun test, config, atau import, dan `bun run test:e2e` gagal dengan "Unexpected module status 3" karena playwright tidak menemukan apa pun untuk dijalankan. Keduanya dihapus (YAGNI, presedennya sama dengan Flagsmith). BDD tetap ada dan berjalan, lewat 12 file `.feature` di bawah Vitest/pytest/godog — bukan lewat Playwright
- API Testing: tidak ada. Bruno pernah disebut di sini beserta "collections disimpan di repo", padahal tidak ada satu pun file `.bru`. Yang benar-benar melatih endpoint adalah 28 suite integrasi project-service yang mengirim HTTP request ke Postgres sungguhan
- Contract Testing: tidak ada. Pact tidak terpasang di package.json, go.mod, maupun pyproject.toml mana pun, dan tidak ada pact file. Yang menjaga kontrak hari ini cuma Zod schema bersama plus `tsc --noEmit`, dan itu berhenti di batas Go dan Python. Detailnya di bagian Contract Tests
- Load Testing: tidak ada. k6 disebut di sini dengan lisensi dan deskripsi enginenya, padahal tidak ada script k6, tidak ada import `k6/http`, dan tidak ada entri di manifest mana pun. Angka di bagian Performance Requirements karenanya adalah target, bukan hasil ukur — tidak ada yang pernah membangkitkan beban untuk memverifikasinya
- Security Scanning: tiga scanner di job yang sama, ketiganya fail-on-finding. Trivy (Apache 2.0, Aqua Security) untuk lockfile termasuk Cargo.lock yang di-vendor di node_modules, Grype (Apache 2.0, Anchore) untuk pohon sumber dengan node_modules dikecualikan lewat `.grype.yaml`, dan osv-scanner untuk bun.lock/go.mod/uv.lock dengan jumlah package per lockfile. Pengecualian ditulis per advisory ID di `osv-scanner.toml` beserta alasan dan tanggal tinjau, bukan lewat filter severity. Detail pembagian tugasnya di bagian CI/CD Pipeline
- Local Services: Docker Compose (PostgreSQL 17 + PgBouncer + Valkey 9 + NATS + MinIO + OpenObserve + Traefik + Centrifugo + Temporal + Uptime Kuma)

### Deployment Strategy

- Docker Compose single-host deployment via Dokploy (self-hosted PaaS) di VPS, satu Compose service dari docker-compose.prod.yml
- Rolling updates via `docker compose up -d --no-deps --build <service>` untuk per-service zero-downtime updates
- Database migrations: run sebelum deploy (backward-compatible only, additive — add columns, jangan rename/drop), jangan di-couple dengan container startup
- Blue-green deployment: via Docker Compose profiles. Two sets of containers (blue/green), Traefik switches routing via Docker labels setelah health check pass. Rollback instant (< 1 detik, switch Traefik routing kembali). Butuh ~1.5x resources karena kedua stacks jalan bersamaan saat switchover
- Scale: migrate ke Kubernetes (k3s) untuk auto-scaling, rolling updates, pod health management

## Arsitektur Microservice

### Prinsip Desain

- Bounded Context: setiap service punya domain yang jelas dan tidak overlap
- Database per Service (logical): shared PostgreSQL, satu schema `public`. Pemisahan domain hanya konvensi di level file (packages/db/src/schema/auth.ts, project.ts, payment.ts, ai.ts, admin.ts) — bukan PostgreSQL schema, jadi tidak ada batas yang ditegakkan database. Migrasi ke schema atau database terpisah jika ada bottleneck
- API Gateway Pattern: semua request dari frontend lewat Traefik, di-route ke service yang tepat
- Event-Driven: state changes di-publish ke NATS JetStream (persistent, exactly-once delivery). JetStream menjamin message tidak hilang jika consumer down — messages di-replay saat consumer reconnect. Deduplication via msgID built-in
- Circuit Breaker: jika service downstream gagal, fallback gracefully. Library: Cockatiel (MIT, 1.07M downloads/week, composable resilience — retry + circuit breaker + timeout + bulkhead in single wrap(), native TypeScript, inspired by .NET Polly). Config: threshold 5 failures, resetTimeout 30s, halfOpenMax 3
- Saga Pattern: untuk transaksi yang span multiple services (misal: payment -> project status -> notification). Orchestration via Temporal (MIT license, TypeScript SDK) — durable workflow execution, auto-retry, visual debugging. Complex flows (escrow release, team formation, dispute resolution) didefinisikan sebagai Temporal workflows. Simple event fan-out (notifications, logging) tetap via NATS choreography

### Service Map dan Komunikasi

```
[Frontend] -> [Traefik API Gateway]
                  |
    +-------------+-------------+-------------+-------------+
    |             |             |             |             |
[Auth Svc]  [Project Svc]  [AI Svc]  [Payment Svc]  [Notification Svc]  [Admin Svc]
    |             |             |             |             |                |
    +------+------+------+------+------+------+------+------+------+--------+
           |                    |              |
      [PostgreSQL]         [NATS Bus]     [Centrifugo] -> [Clients WS]
      [PgBouncer]          [Temporal]     [MinIO/R2]
      [Redis]              [OpenObserve]
```

Komunikasi synchronous (REST via plain fetch):

- Frontend -> Service: semua user-facing API calls via `apiFetch` di src/lib/api.ts — fetch biasa dengan string URL, tipe response dideklarasikan manual di call site. Belum type-safe RPC
- Service -> Service: helper `serviceFetch` (apps/project-service/src/lib/http/service-fetch.ts) — fetch biasa ke `${env.X_SERVICE_URL}/...` dengan header X-Service-Auth, timeout, dan retry. Tipe request/response ditulis manual per client (payment-client.ts, document-generation.ts)
- hono/client (hc + AppType) direncanakan tapi belum dipakai di mana pun

Komunikasi asynchronous (NATS):

- project.status.changed -> Notification Service kirim email/push
- payment.completed -> Project Service update milestone status
- talent.registered -> AI Service trigger CV parsing
- project.completed -> AI Service update embeddings dan retrain ML model

### NATS JetStream Stream Configuration

Streams diorganisasi per domain untuk isolasi dan retention policy yang berbeda:

```
Stream: PROJECT_EVENTS
  Subjects: project.>, application.>, contract.>, work_package.>, review.>, dispute.>, time_log.>
  Retention: limits (max 10GB, max 30 days)
  Storage: file
  Replicas: 1 (single-host), 3 (production cluster)
  Deduplication window: 2 minutes (msgID-based)

Stream: PAYMENT_EVENTS
  Subjects: payment.>
  Retention: limits (max 5GB, max 90 days — longer for audit)
  Storage: file
  MaxDeliver: 5 (more retries for payment events)

Stream: TALENT_EVENTS
  Subjects: talent.>, talent_placement.>
  Retention: limits (max 5GB, max 30 days)
  Storage: file

Stream: MILESTONE_EVENTS
  Subjects: milestone.>
  Retention: limits (max 5GB, max 30 days)
  Storage: file

Stream: CHAT_EVENTS
  Subjects: chat.>
  Retention: limits (max 10GB, max 7 days — high volume, short retention)
  Storage: file

Stream: AI_EVENTS
  Subjects: ai.>
  Retention: limits (max 5GB, max 14 days)
  Storage: file

Stream: SYSTEM_EVENTS
  Subjects: notification.>, admin.>
  Retention: limits (max 2GB, max 14 days)
  Storage: file

Stream: DLQ
  Subjects: dlq.>
  Retention: limits (max 1GB, max 90 days — keep failed events longer)
  Storage: file
```

Consumer patterns:

- Durable consumers per service per stream (named, survive restarts)
- AckWait: 30s (time for consumer to process before redelivery)
- MaxDeliver: 3 (default, 5 for payment events)
- DeliverPolicy: "all" for new consumers, "last" for idempotent catch-up

### NATS Event Schema

Semua event mengikuti format konsisten:

```typescript
type NATSEvent<T> = {
  id: string; // UUID v7
  type: string; // event name (dot-separated)
  source: string; // service name
  timestamp: string; // ISO 8601
  data: T; // event-specific payload
};
```

Event-event utama (exhaustive catalog):

Project lifecycle:

- project.created, project.status.changed, project.completed
- project.cancelled, project.disputed, project.on_hold, project.resumed
- project.team.forming, project.team.talent_assigned, project.team.talent_replaced, project.team.complete, project.team.escalated

Payment:

- payment.escrow.created, payment.released, payment.refunded, payment.partial_refund
- payment.revision_fee.charged, payment.talent_placement_fee.charged
- payment.gateway.webhook_received (dari Midtrans/Xendit)
- payment.settled — ditulis ke outbox di dalam transaksi webhook yang sama dengan perubahan status transaksi, lalu dikonsumsi project-service (settlement-consumer.ts) ke PaymentSettlementService. Ini jalur pengiriman yang harus andal: callback HTTP ke project-service dicoba sekali tanpa retry, dan guard status monotonik di webhook membuat redelivery Midtrans short-circuit sebelum sempat memanggilnya lagi, sehingga callback yang gagal berarti owner sudah bayar tapi dokumennya tetap terkunci. Callback HTTP tetap ada sebagai optimasi latency, dan karena setiap cabang settle idempoten, keduanya berjalan bersamaan tidak masalah

Talent:

- talent.registered, talent.verified, talent.suspended, talent.unsuspended
- talent.assignment.accepted, talent.assignment.declined
- talent.availability_changed, talent.inactive_warning, talent.abandon_penalized

Application & Work Package:

- application.created, application.status.pending, application.status.withdrawn
- work_package.created, work_package.status_changed

Contract & Dispute:

- contract.created, contract.signed, contract.fully_executed
- dispute.created, dispute.status_changed, dispute.resolved, dispute.phase.direct, dispute.phase.mediation, dispute.phase.binding

Review, Time Log & Talent Placement:

- review.created
- time_log.created, time_log.stopped
- talent_placement.requested, talent_placement.in_discussion, talent_placement.accepted, talent_placement.declined, talent_placement.completed

Milestone:

- milestone.submitted, milestone.approved, milestone.rejected
- milestone.revision_requested, milestone.auto_released
- milestone.overdue, milestone.due_soon (7 hari sebelum due_date)
- milestone.dependency.blocked (ketika satu talent blocking talent lain)

Chat & AI:

- chat.message.sent (untuk trigger AI response di scoping)
- chat.bypass_detected (percakapan mencurigakan, potential disintermediation)
- ai.brd.generated, ai.prd.generated, ai.cv.parsed
- ai.matching.completed sudah dihapus. Subject ini tidak punya publisher maupun consumer: emitter-nya dulu endpoint ai-service `/match-talents` yang sendiri sudah dihapus karena tidak pernah dipanggil, dan matching rule-based hidup di project-service tanpa menerbitkan event apa pun. Konstanta di packages/nats-events, entri di `knowinglyUnhandled` notification-service, dan assertion di subjects.test.ts semuanya sudah dibersihkan, dan ada test yang menjaga subject itu tidak kembali

System:

- notification.send (generic notification trigger)
- admin.action.performed (admin melakukan aksi intervensi)

### Observability

OpenTelemetry SDK di setiap service (auto-instrumentation untuk HTTP, database, NATS):

- Traces: distributed tracing lintas service, visualisasi di OpenObserve trace explorer
- Metrics: request rate, error rate, latency per service, export via OTLP ke OpenObserve
- Logs: structured JSON via Pino → OpenTelemetry Collector → OpenObserve. Correlation ID dari trace context
- Unified dashboard: OpenObserve menyediakan single pane of glass — klik dari trace span langsung ke log terkait

Health check endpoint di setiap service: GET /health -> { status: "ok", service: "project-service", uptime: 12345 }

Readiness probe: GET /ready -> { status: "ready" } (return 503 jika database/NATS belum connected). Dipakai Docker/K8s untuk routing traffic hanya ke instance yang siap.

### Microservice Patterns (Must-Have)

**Outbox Pattern** (reliable event publishing):

- Problem: dual-write — database commit sukses tapi NATS publish gagal (atau sebaliknya) → data inconsistency
- Solution: tulis event ke `outbox_events` table dalam transaction yang sama dengan business data. Background worker poll table dan publish ke NATS. Mark event sebagai published setelah NATS acknowledge
- Table: outbox_events (id, aggregate_type, aggregate_id, event_type, payload JSONB, published boolean default false, created_at)
- Worker: BUKAN pg-boss. Loop in-process di project-service (apps/project-service/src/services/outbox-worker.ts) — `while (running)` dengan sleep 1 detik, batch max 100 event per putaran, hanya ambil baris `published = false AND retry_count < 3`, dan yang habis retry dipindah ke `dead_letter_events`. Setiap event diklaim satu per satu lewat `SELECT ... FOR UPDATE SKIP LOCKED` (outbox-worker.ts) di dalam transaksi yang sama dengan penandaan `published`, jadi menjalankan lebih dari satu replika aman: tidak ada event yang dobel-publish maupun hilang. Kandidat diurutkan `(created_at, id)` karena created_at sendiri tidak punya tiebreak. Yang masih berlaku: outbox hanya jalan selama proses project-service hidup, dan urutan publish antar replika tidak dijamin karena tiap event diklaim independen
- Catatan: meskipun NATS JetStream sudah provide reliable delivery, outbox pattern tetap diperlukan untuk menjamin atomicity antara database write dan event publish (dual-write problem). JetStream menjamin message delivery SETELAH publish, outbox menjamin event PASTI di-publish

**Idempotent Consumer + Dead Letter Queue (DLQ)**:

- NATS JetStream sudah provide at-least-once delivery dan message deduplication (via msgID). Tapi consumer-side idempotency tetap perlu
- Hanya notification-service yang menyimpan processed event ID di Valkey (prefix `notif:idem:`, TTL 7 hari), dan itu degrade ke no-op kalau REDIS_URL kosong atau ping gagal. Consumer lain idempoten lewat database: invoice-consumer di project-service short-circuit via `invoice.service.findByMilestone`, ai-service nats_consumer idempoten di level upsert embedding
- Sebelum process event, cek apakah event ID sudah ada → skip jika sudah
- JetStream consumer: gunakan durable consumer (named) supaya message tidak hilang saat consumer restart
- msg.nak() untuk negative acknowledge (trigger retry), msg.ack() setelah berhasil process
- Jika processing gagal 3 kali (JetStream MaxDeliver config), kirim ke DLQ subject (misal: `dlq.payment.released`) untuk manual review
- Admin panel: halaman DLQ viewer untuk melihat dan re-process failed events

**Inter-Service Authentication**:

- Service-to-service calls (sync REST) menggunakan shared secret via header: `X-Service-Auth: <shared-jwt>`
- JWT di-sign dengan secret yang hanya diketahui services (bukan user JWT)
- Middleware di setiap service: validasi X-Service-Auth header untuk internal endpoints
- Internal endpoints prefix: `/internal/...` — tidak di-route oleh Traefik ke public

**API Versioning**:

- URL-based: `/api/v1/projects`, `/api/v1/auth`
- Versioning sejak Fase 1 supaya tidak breaking change di masa depan
- Breaking changes → version baru (`v2`), version lama di-maintain minimal 6 bulan
- Non-breaking changes (tambah field opsional) langsung di version existing

**OpenAPI Documentation** (di-serve via Scalar, dua pendekatan berbeda):

- Dua service expose docs: auth-service di `/api/v1/auth/docs` dan project-service di `/api/v1/projects/docs`, UI-nya Scalar API Reference (@scalar/hono-api-reference, MIT, OpenAPI 3.1 native, built-in dark mode). ai-service pakai default FastAPI (Swagger UI di `/docs`, spec auto-generated dari Pydantic). Service Go (payment, notification, admin) tidak expose docs sama sekali
- `@hono/zod-openapi` TIDAK dipakai di service mana pun — tidak ada di dependency mana pun
- auth-service: spec OpenAPI 3.1 ditulis tangan sebagai JSON literal di index.ts. Tiga belas path, jadi masih terkelola. Dijaga `openapi-parity.test.ts` yang membandingkannya dengan `app.routes`, jadi drift gagal di CI, bukan ditemukan pembaca
- project-service: path DI-DERIVE dari `app.routes` lewat `deriveOpenApiPaths` (src/lib/openapi.ts). Sebelumnya `paths: {}` disajikan sebagai kontrak sementara 93 route ter-mount, yang lebih buruk daripada tidak ada spec. Menulis tangan 93 path akan menyimpang dalam satu sprint, jadi diturunkan dari tabel route Hono sendiri
- Yang di-derive hanya yang memang diketahui tabel route: method, path, dan path parameter. Request body, response payload, dan status code TIDAK diemit karena tidak derivable — schema karangan lebih buruk daripada schema yang absen, karena pembaca jadi memercayainya alih-alih membuka handler
- Security ikut di-derive dari konstanta yang sama yang dibaca middleware (`SESSION_PREFIX`, `PUBLIC_ROUTES`, `SERVICE_AUTH_ROUTES`), sehingga gate dan dokumentasinya tidak bisa berbeda
- Assertion parity route bersifat tautologis karena spec diturunkan dari sumber yang sama — itu memang tujuannya. Yang benar-benar menjaga adalah batas bawah jumlah path yang terdokumentasi: derivation yang rusak menjatuhkannya

**Correlation ID Propagation**:

- Setiap incoming request generate UUID v7 sebagai `X-Request-ID` header (jika belum ada)
- Propagate `X-Request-ID` ke semua downstream service calls (REST dan NATS)
- Pino logger include `requestId` di setiap log entry
- OpenTelemetry trace context juga carry correlation ID
- Memudahkan tracing request flow lintas service di OpenObserve trace explorer

**Standardized Error Codes**:

- Format: `{SERVICE}_{CATEGORY}_{SPECIFIC}` (misal: `PROJECT_VALIDATION_INVALID_STATUS`, `PAYMENT_ESCROW_INSUFFICIENT_FUNDS`)
- Catalog: didefinisikan di packages/shared/errors.ts, setiap error punya code, HTTP status, dan i18n message key
- Setiap service import dan extend dari shared catalog
- Frontend mapping: error code → user-friendly message via i18n

**Config Validation at Startup**:

- Setiap service punya Zod schema untuk environment variables
- Validasi dijalankan saat service start — fail fast jika config tidak valid
- Contoh: `const envSchema = z.object({ DATABASE_URL: z.string().url(), NATS_URL: z.string(), ... })`
- Prevent runtime errors akibat missing/invalid config

**Graceful Shutdown**:

- Setiap service handle SIGTERM: stop accepting new requests, finish in-flight requests (max 30 detik), close database/NATS connections, exit
- Outbox worker: stop polling, wait for the in-flight batch to finish (pg-boss belum dipakai)
- WebSocket connections: send close frame, wait for owner disconnect
- Docker stop timeout: 30 detik (match graceful shutdown timeout)

**Temporal Workflows** (durable orchestration untuk complex multi-service sagas):

- Complex flows didefinisikan sebagai Temporal workflows (TypeScript SDK):
  - Milestone approval: validate → release escrow → update project → send notification → generate invoice
  - Team formation: match talents → wait for acceptance → handle decline/timeout → replace → form team
  - Dispute resolution: open dispute → freeze escrow → mediation → binding decision → release/refund
  - Auto-release: timer 14 hari → check owner response → release escrow ke talent
- Setiap step adalah independently retryable activity, crash-safe (Temporal replays dari checkpoint terakhir)
- Visual debugging: Temporal Web UI menampilkan setiap workflow execution, step, retry, dan error
- Simple event fan-out (notifications, logging, analytics) tetap via NATS choreography — Temporal hanya untuk orchestrated multi-step flows
- Temporal Server: self-hosted Docker container (frontend + matching + history + worker services), menggunakan shared PostgreSQL

CATATAN KODE: dari tiga workflow yang ada, hanya DUA yang tersambung.
`milestoneAutoRelease` dimulai dari `routes/milestones.ts` dan `disputeResolution`
dari `routes/disputes.ts`, keduanya lengkap dengan sinyalnya. `teamFormation`
tidak: `startTeamFormationWorkflow` dan `signalTeamComplete` di
`lib/team-formation-workflow.ts` hanya dipanggil oleh `temporal-seams.test.ts`,
tidak ada satu pun call site produksi. Sinyal `talentAccepted` dan
`talentDeclined` didefinisikan dan di-`setHandler` di dalam workflow-nya, tapi
tidak ada yang mengirimnya, sehingga handler accepted kosong dan `declinedCount`
tidak pernah lebih dari nol.

Akibatnya bukan sekadar kode mati. Batas 14 hari team formation beserta
eskalasinya — yang dijanjikan bagian Pencocokan Talent-Owner di dokumen ini —
hanya ada di dalam workflow itu. `scheduled-jobs.ts` menjalankan tiga job
(penalti, auto-release, embedding backfill) dan tidak satupun menyentuh team
formation, dan tidak ada referensi ke `escalateTeamFormation` di luar workflow
dan test-nya. Jadi proyek bisa duduk di `team_forming` selamanya tanpa ada yang
naik ke owner. Ini fitur yang belum tersambung, bukan kode untuk dihapus, dan
memperbaikinya berarti memanggil `startTeamFormationWorkflow` saat proyek masuk
`team_forming` plus mengirim sinyal dari handler accept/decline di
`routes/matching.ts`.

Ada juga cacat kecil di `teamFormation.ts`: `outcome: final.updated ? 'complete'
: 'complete'` mengevaluasi `final.updated` lalu membuang hasilnya, karena kedua
cabangnya sama.

**Shared Packages** (packages/ directory):

- `packages/shared`: Zod schemas, TypeScript types, constants, enums, error codes
- `packages/db`: Drizzle schema, owner, migrations, seed
- `packages/nats-events`: NATS event type definitions, publisher/subscriber helpers, outbox utilities
- `packages/logger`: Pino configuration, structured logging helpers, correlation ID middleware
- `packages/config`: Zod-based env validation, service config loader
- `packages/ui-kit`: formatter dan design token yang dipakai apps/web dan apps/admin. Sengaja sempit: `cn`, formatter Rupiah dan tanggal, plus blok `@theme` berisi brand token. Kedua app menyimpan `lib/utils.ts` sebagai barrel tipis yang me-re-export hanya yang dipakai app itu, supaya call site lama tidak berubah dan deteksi unused export tetap berarti per app
- `packages/go-observability`: BUKAN package Bun dan bukan Go module. Isinya sumber kanonik untuk OTLP bootstrap dan helper trace context ketiga Go service, plus `generate.ts` yang menyalinnya ke tiap service dengan header `DO NOT EDIT`. Go module bersama sudah dievaluasi dan ditolak: ketiga Dockerfile memakai `context: ./apps/<svc>`, jadi target `replace` di luar context menggagalkan `go mod download` dan file `go.work` tidak pernah ikut ter-copy ke image

Tidak ada `packages/testing`, dan fixture tetap dibangun inline per test file. Yang dishare hanya koneksinya: `packages/db` mengekspor `./testing` berisi harness integration (migrate, truncate, dan penolakan database yang namanya tidak berakhiran `_test`). Itu tinggal di `packages/db` karena di sanalah schema dan migrasi hidup, bukan di package baru yang isinya satu file.

Kedua frontend punya harness route sendiri, `apps/web/src/lib/testing/harness.tsx` dan `apps/admin/src/lib/testing/harness.tsx`, dan sengaja tidak digabung: web me-mount lewat `RouterProvider` sungguhan karena route-nya memanggil `Link` dan `useParams`, sedangkan admin mem-mock router per file lalu me-render componentnya langsung. Keduanya ada di `lib/`, bukan di `src/routes/`, karena generator TanStack Router akan menuliskan apa pun di sana ke `routeTree.gen.ts` sebagai route. Yang dishare admin adalah bagian yang pernah salah sepuluh kali: `Route.options.component` di bawah `autoCodeSplitting` adalah wrapper lazy yang membawa `preload()`, dan memanggilnya menukar property itu dengan component hasil resolve — jadi panggilan kedua dan seterusnya tidak menemukan `preload` lagi. Sepuluh file menuliskannya tanpa syarat, masing-masing lewat satu double cast, dan satu bump `@tanstack/router-plugin` membuat setiap file lulus test pertamanya lalu gagal sisanya.

Tidak ada `packages/ui` berisi komponen, dan itu keputusan yang sudah diukur, bukan kelalaian: `apps/web/src/components/ui` punya 8 komponen, `apps/admin/src/components/ui` punya 7, dan tidak ada nama yang beririsan. Marketplace publik dan admin console memang butuh vocabulary berbeda. Yang benar-benar terduplikasi cuma formatter dan token, dan itu yang masuk `packages/ui-kit`.

Web dulu punya 12. Badge, Button, Card, dan Input dihapus karena tidak ada satu pun importer di luar test-nya sendiri: route menulis markup-nya sendiri, jadi keempatnya 553 baris dan 31 test yang menguji sesuatu yang tidak dipakai siapa pun. Modal ada di daftar yang sama tapi TIDAK dihapus, dan alasannya cacat bukan selera. Tiga route menulis dialog `fixed inset-0 z-50` sendiri; dua tanpa focus management sama sekali, dan satu menyatakan `aria-modal="true"` — yang memberi tahu assistive technology bahwa sisa halaman inert — sambil membiarkan Tab keluar begitu saja. Modal mengerjakan yang dijanjikan atribut itu (Escape, Tab trap, focus awal, focus dikembalikan), jadi ketiganya sekarang memakainya. Sebelum menambah komponen baru ke direktori itu, tambahkan bersama call site pertamanya.

Format Rupiah ringkas melipat ke juta sampai atas, jadi satu miliar tampil `Rp 2.500 jt`. Admin panel dulu memakai `Rp 2.5M` dan web tidak pernah memakai M sama sekali. Menyeragamkan ke M berarti memperkenalkannya di halaman yang menampilkan pengeluaran kumulatif owner dan penghasilan kumulatif talenta, dan M yang terbaca sebagai juta alih-alih miliar adalah salah baca seribu kali lipat atas uang orang. `jt` selalu berarti juta. Kolom yang lebih lebar adalah harga dari angka yang tidak bisa disalahbaca.

### CI/CD Pipeline (GitHub Actions)

```yaml
# Trigger: push ke main, PR ke main. Branch fitur TIDAK ter-scan sampai PR
#          dibuka, jadi gate apa pun di sini baru berlaku di tujuan, bukan di
#          pekerjaan yang sedang berjalan.
# Semua job memakai `bun-version: 1.3.9` (cocok dengan field packageManager,
#          bukan `latest`) dan `bun install --frozen-lockfile`. Sebelumnya
#          keduanya longgar, dan itu bukan detail: bun mana yang me-resolve
#          menentukan isi bun.lock, sedangkan install tanpa --frozen-lockfile
#          tidak pernah menegakkan lock yang di-commit. Kombinasi itu yang
#          membuat entri lock bersarang basi (anymatch/picomatch@2.3.1,
#          tsx/esbuild@0.27.4) bertahan melewati security scan yang hijau.
# Jobs:
# 1. lint-and-type-check: biome check + tsc --noEmit, lalu lima gate:
#    a. Pricing table drift: generate-pricing.ts --check, memastikan salinan Go
#       tabel fee tidak menyimpang dari packages/shared/src/pricing.ts
#    b. Go observability drift: packages/go-observability/generate.ts --check
#    c. Architecture conformance: bun run arch (dependency-cruiser)
#    d. Temporal workflow bundle: check-workflow-bundle.ts memanggil
#       bundleWorkflowCode, satu-satunya hal di CI yang menjalankan webpack
#       atas src/workflows. Tanpa ini, workflow yang tidak bisa dibundle lolos
#       tsc, build, dan seluruh test, lalu menghentikan worker escrow release
#    e. Go formatting: gofmt -l, karena Biome hanya menutupi TypeScript
# 2. test-unit: vitest run (parallel per service, Turborepo change detection — hanya test yang affected)
# 3. test-go + test-python: go vet lalu go test (payment/notification/admin) dan uv run pytest (ai-service). Tidak ada job E2E: Playwright sudah dihapus karena tidak punya test
# 4. security-scan: tiga scanner, dan ketiganya menggagalkan build. Mereka
#    tidak redundan karena melihat hal berbeda:
#    a. Trivy (fs, CRITICAL/HIGH, ignore-unfixed) membaca go.mod, bun.lock,
#       uv.lock DAN Cargo.lock — termasuk Cargo.lock yang di-vendor di dalam
#       node_modules, yang cuma dia yang lihat (quinn-proto di
#       @temporalio/core-bridge ketahuan dari sini)
#    b. Grype (severity-cutoff high) membaca pohon sumber. .grype.yaml
#       mengecualikan node_modules supaya ia tidak menilai binary build tool
#    c. osv-scanner membaca bun.lock, go.mod dan uv.lock dalam satu pass dan
#       mencetak jumlah package per lockfile, jadi parser yang tidak bisa
#       membaca sebuah lockfile muncul sebagai nol, bukan sebagai lulus. Ia
#       paling teliti dari ketiganya: 22 grup advisory saat Trivy melihat 3
#    Temuan yang tidak punya versi tujuan hidup di osv-scanner.toml sebagai
#    [[IgnoredVulns]] dengan alasan dan tanggal tinjau, bukan sebagai filter
#    severity. Gate yang selalu merah adalah gate yang berhenti dibaca, tapi
#    menurunkan ambangnya menghapus sinyal untuk semua temuan sekaligus.
#    Konfigurasi root berlaku untuk seluruh pohon, termasuk apps/*/go.mod
# 5. build: docker build per service (multi-stage build, hanya rebuild service yang berubah)
# 6. deploy: POST /api/compose.deploy ke Dokploy (hanya di main branch). Tidak ada
#    registry push: docker-compose.prod.yml pakai build:, jadi Dokploy build sendiri
#    di host. Butuh secrets DOKPLOY_URL, DOKPLOY_API_KEY, DOKPLOY_COMPOSE_ID
```

CATATAN KODE: gate `needs: [build-ts, build-go, build-docker]` di job deploy
saat ini TIDAK menahan apa pun, karena Dokploy juga auto-deploy sendiri lewat
webhook GitHub-nya pada setiap push ke main. Keduanya berjalan paralel dan
webhook itu tidak tahu apa-apa soal Actions.

Ini terbukti, bukan dugaan. Push 2026-09-03 memecah build image admin
(`vite.config.ts` mengimpor `../../vitest.shared` yang tidak ikut disalin
Dockerfile), yang berarti `build-docker` gagal dan job deploy tidak mungkin
jalan. Dokploy tetap membangun dan tetap gagal di host. Artinya setiap push
ke main dikirim ke produksi terlepas dari hasil test, tiga security scanner,
dan apakah image-nya bisa dibangun sama sekali.

Memperbaikinya bukan sekadar mematikan auto-deploy: kalau ketiga secret
DOKPLOY_* belum diisi di GitHub, mematikannya menghapus satu-satunya jalur
deploy yang tersisa. Urutannya pastikan secret ada dulu, baru matikan
auto-deploy, sehingga job deploy di CI menjadi satu-satunya pemicu seperti
yang dimaksud workflow-nya.

Turborepo change detection: jika hanya `apps/web/` berubah, hanya build dan test frontend. Jika `packages/db/` berubah, rebuild semua services yang depend on it.

### Docker Multi-Stage Builds

```dockerfile
# Pattern per TypeScript service:
# Stage 1: install (bun install --frozen-lockfile)
# Stage 2: build (bun run build, tree-shake)
# Stage 3: production (copy hanya built artifacts + node_modules production)
# Result: image ~100-200MB instead of ~1GB

# Pattern untuk AI Service (Python):
# Stage 1: install (uv sync --frozen)
# Stage 2: production (copy venv + app code)
# (belum ada model download di build time — CV parsing pakai pypdfium2/python-docx/python-pptx, tanpa Docling/mxbai-rerank)
```

CATATAN KODE: `bun build` MENSUBSTITUSI `process.env.NODE_ENV` yang ditulis
dengan notasi titik pada saat bundling, dan kedua service TypeScript di-bundle
di stage yang tidak pernah menyetel NODE_ENV (hanya stage runner yang
menyetelnya). Akibatnya `const isProduction = process.env.NODE_ENV ===
'production'` ter-compile menjadi literal `false` dan tetap `false` apa pun isi
environment container. Terbukti di bundle yang ter-deploy: `isProduction2 =
false`, dan `process.env.NODE_ENV` muncul nol kali.

Satu konstanta itu mematikan empat hal sekaligus di produksi:

- `useSecureCookies` false, jadi cookie session tidak membawa atribut `Secure`
  di atas HTTPS
- `trustedOrigins` jatuh ke cabang development yang hanya berisi `CORS_ORIGIN`,
  sehingga `admin.kerjacus.id` dan `www.kerjacus.id` menjawab 403 dan admin
  panel sama sekali tidak bisa login
- `requireEmailVerification` false, jadi verifikasi email tidak pernah berlaku
- yang terburuk, ternary penjaga `devCode` ikut dilipat, sehingga
  `devCode: code` menjadi tanpa syarat dan endpoint pengirim OTP mengembalikan
  OTP-nya sendiri di response body

Notasi bracket TIDAK disubstitusi. Diverifikasi pada bun 1.3.9: bentuk titik
menjadi `var dotted = false`, sedangkan `process.env["NODE_ENV"]` bertahan
sebagai lookup sungguhan. Karena itu ada `isProduction()` di
`@kerjacus/config`, `scripts/check-runtime-env.ts` menggagalkan build kalau ada
pembacaan bentuk titik di path yang di-bundle, dan kedua Dockerfile sekarang
menyetel NODE_ENV sebelum langkah bundle.

Tidak ada test yang bisa menangkap ini. Vitest tidak mem-bundle, jadi NODE_ENV
tidak pernah di-inline saat test dan suite production-hardening yang sudah ada
lulus terhadap perilaku yang tidak dimiliki artefaknya. Itu sebabnya gate-nya
membaca SOURCE, bukan perilaku: cacatnya hanya ada setelah bundling.

Satu hal sengaja tidak ikut menyala. Memperbaiki ini membuat
`requireEmailVerification` menjadi true, sementara `RESEND_API_KEY` kosong di
produksi dan `sendEmail` degrade ke console.log, jadi semua akun akan terkunci
di belakang email yang tidak pernah terkirim: 26 akun yang ada semuanya
`email_verified = false`. Sekarang ia bergantung pada apakah pengiriman email
benar-benar terkonfigurasi, dan memperingatkan saat start kalau produksi
berjalan tanpanya. Isi `RESEND_API_KEY` untuk menyalakannya, dan backfill akun
lama dulu sebelum itu.

### Database Migration Strategy

- Development: `drizzle-kit generate` → `drizzle-kit migrate` (auto dari schema changes)
- Production: migrations dijalankan sebagai init container / startup script sebelum service start
- Zero-downtime: semua migrations harus backward-compatible (add column, bukan rename/drop)
- Breaking schema changes: split ke 2 deploy — (1) add new, (2) migrate data, (3) drop old
- Migration files di-commit ke repo (packages/db/migrations/)

### Backup Strategy

- pgBackRest untuk PostgreSQL backup (atau Neon built-in jika pakai Neon)
- Schedule: full backup weekly, incremental daily, WAL archiving continuous
- Retention: 30 hari point-in-time recovery
- Test restore monthly (automated via CI/CD job)
- S3/R2 sebagai backup storage destination

## Database Architecture

### Prinsip Desain Database

- OLTP (Online Transaction Processing): database ini untuk operasional, bukan analytics
- Normalisasi 3NF (Third Normal Form) sebagai standar. Denormalisasi hanya jika ada bottleneck performa yang terbukti lewat profiling. Jika ada tabel yang redundan, pastikan sudah melewati BCNF check
- UUID v7 sebagai primary key (sortable by time, tidak bocorkan urutan data). Pakai library uuidv7, BUKAN crypto.randomUUID() yang menghasilkan v4 (random, buruk untuk B-tree index locality)
- Semua timestamp pakai timestamptz (with timezone), disimpan dalam UTC
- Soft delete (deleted_at column) untuk: users, projects, transactions. Catatan: brd_documents/prd_documents belum punya deleted_at (lifecycle dokumen dikelola via kolom status)
- Hard delete untuk: chat_messages yang sudah expire, temporary data
- JSONB column untuk data semi-structured (AI response raw, metadata fleksibel)
- Index strategy: foreign key, kolom yang sering di-WHERE (status, created_at), composite index untuk query yang sering digabung
- Index yang sudah terpasang: idx_projects_browse (created_at DESC, partial: deleted_at IS NULL AND visibility IN (public_summary, public_detail) AND status IN (matching, team_forming, matched, in_progress, review, completed)), idx_projects_owner, idx_project_assignments_talent_status, idx_talent_profiles_eligible, idx_time_logs_talent_started, idx_time_logs_task, idx_notifications_user_unread, idx_notifications_user_created, idx_transactions_status_type_created, idx_ai_interactions_created, idx_ai_interactions_model_created, idx_reviews_reviewee_type, idx_revision_requests_milestone, idx_brd_documents_content_fts dan idx_prd_documents_content_fts (GIN atas to_tsvector, harus sama persis dengan ekspresi di rag.py), idx_document_chunks_content_fts dan document_chunks_embedding_hnsw_idx (arm BM25 dan arm vektor untuk retrieval per section, dan planner sudah diverifikasi memakai HNSW-nya), idx_user_name_trgm, idx_user_email_trgm, idx_projects_title_trgm (GIN pg_trgm untuk admin search yang memakai ILIKE dengan wildcard di depan)
- Catatan idx_projects_browse: kolom pengurut harus di depan. Versi lama memimpin dengan (status, visibility) dan kedua route browse memfilter keduanya dengan IN-list, dan btree scan atas ScalarArrayOpExpr tidak mempertahankan urutan kolom berikutnya, jadi Sort atas seluruh baris tetap jalan sebelum LIMIT
- Unique index: chat_conversations_scoping_unique (satu thread ai_scoping per proyek), contracts_assignment_type_unique, talent_placement_live_unique (partial, status bukan declined), revision_requests_fee_transaction_unique (partial), reviews_project_reviewer_reviewee_unique, uq_project_assignments_wp_live, uq_accounts_owner, uq_accounts_owner_platform, uq_project_invoices_milestone_audience
- skills_embedding_hnsw_idx sudah di-drop di migrasi 0028. Tidak ada query yang mencari skill lewat jarak vektor: hybrid_search hanya pernah dipanggil dengan brd_documents, dan skill matching memuat embedding ke JS lalu menghitung cosine di sana. Index itu ditulis ulang setiap update skill dan tidak pernah dibaca
- Semua migrasi yang membuat index atau ALTER TABLE diawali `SET lock_timeout` dan `SET statement_timeout`. CONCURRENTLY tidak tersedia karena drizzle membungkus tiap file migrasi dalam satu transaksi (pg-core/dialect.cjs) dan Postgres menolak CONCURRENTLY di dalam transaksi. Timeout tidak menghapus lock, hanya membatasinya, supaya migrasi yang akan mengantre di belakang write gagal cepat dan bisa diulang di window yang tenang
- pgvector extension untuk embedding storage (RAG)
- Pemisahan domain per file schema Drizzle (auth.ts, project.ts, payment.ts, ai.ts, admin.ts), semua tabel tetap di schema `public`
- Table partitioning strategy (implement ketika data cukup besar, tapi design schema yang partition-friendly dari awal):
  - `chat_messages`: range partition by created_at (monthly). Paling cepat grow karena setiap proyek bisa ratusan pesan
  - `time_logs`: range partition by created_at (monthly). High-volume dari time tracking
  - `ai_interactions`: range partition by created_at (monthly). Setiap AI call di-log
  - Tabel lain: pertimbangkan partition jika > 10M rows
  - Partition pruning: query yang include WHERE created_at > X otomatis hanya scan partition relevan
- Data retention policies:
  - chat_messages: retain 2 tahun, archive ke cold storage setelahnya
  - ai_interactions: retain 1 tahun (untuk cost tracking), aggregate stats disimpan permanent
  - time_logs: retain 3 tahun (legal/audit requirement)
  - audit_logs: retain 5 tahun (compliance)
  - Implement via pg_cron job yang move old data ke archive table / delete

### Tabel Utama dan Relasi

#### Auth Domain

users

- id (UUID v7, PK)
- email (unique)
- name
- phone (unique, nullable — null sampai user OAuth menambahkan nomor via PATCH /me; format +62 diikuti 9-13 digit saat diisi, untuk mencegah multi-account abuse)
- phone_verified (boolean, default false, diverifikasi via OTP 6 digit)
- role (text, default owner — nilai: owner, talent, admin. Enum user_role di kode mencakup admin, tapi kolom user.role disimpan sebagai text bebas (bukan pgEnum); sign-up main app hanya menerima owner/talent)
- avatar_url
- is_verified
- locale (enum: id, en, default: id)
- created_at, updated_at, deleted_at

phone_verifications (OTP verification untuk nomor telepon)

- id (UUID v7, PK)
- user_id (FK -> users)
- phone (varchar 20)
- code (varchar 6, OTP code)
- expires_at (timestamptz, 5 menit dari pembuatan)
- verified (boolean, default false)
- attempts (integer, default 0, max 5)
- created_at

talent_profiles (1:1 dengan users yang role = talent)

- id (UUID v7, PK)
- user_id (FK -> users, unique)
- bio
- years_of_experience
- tier (enum: junior, mid, senior) -- INTERNAL ONLY, tidak ditampilkan ke talent/owner
- education_university
- education_major
- education_year
- cv_file_url
- cv_parsed_data (JSONB, hasil parsing CV)
- portfolio_links (JSONB, array of {platform, url})
- hourly_rate_expectation
- location (varchar 255, nullable)
- availability_status (enum: available, busy, unavailable)
- verification_status (enum: unverified, cv_parsing, verified, suspended) -- unverified -> cv_parsing (saat parsing berjalan) -> verified (setelah CV berhasil diparsing). `cv_parsing` sempat menjadi state yang tidak pernah bisa dimasuki: enum, tipe shared, union frontend, label i18n, dan warna badge semuanya sudah ada, tapi `verificationFromParse` hanya mengembalikan unverified atau verified dan tidak ada satu pun penulis. Sekarang ditulis oleh `claimCvParse` (src/lib/cv-verification.ts) lewat conditional UPDATE, sehingga penandaan state sekaligus menjadi kunci konkurensi: /parse-cv dan /reparse-cv dulu tanpa guard sama sekali, jadi dua tab berarti dua panggilan model berbayar atas file yang sama. Claim diambil sebelum panggilan, dilepas saat gagal, dan pelepasannya mengembalikan status yang ditimpa — outage AI tidak mengatakan apa pun tentang CV dan tidak boleh mencabut status verified seorang talenta. Claim yang lebih tua dari dua kali timeout parse bisa direbut, tanpa itu satu proses yang mati akan mengunci talenta selamanya
- domain_expertise (JSONB, array of string: ["fintech", "e-commerce", "healthcare", "education", "logistics", "saas"])
- total_projects_completed
- total_projects_active
- average_rating
- pemerataan_penalty (float, default 0, akumulasi penalti dari abandon/inaktif — ditambahkan ke formula pemerataan_skor: `1 / (1 + proyek_aktif * 2 + total_proyek_selesai * 0.1 + pemerataan_penalty)`)
- created_at, updated_at

Catatan `pemerataan_skor`: dihitung real-time dari formula di atas menggunakan kolom talent_profiles (total_projects_completed, total_projects_active, pemerataan_penalty). Tidak disimpan sebagai kolom terpisah karena selalu derived.

Catatan `health_score`: dihitung real-time per proyek dari komponen timeline/milestone/communication/budget. Tidak disimpan di database — dihitung on-demand saat admin dashboard atau project detail di-load. Jika performa jadi issue, cache di Redis (TTL 5 menit).

talent_assessments (hasil vetting — hanya CV parsing, tanpa skill assessment atau probation)

- id (UUID v7, PK)
- talent_id (FK -> talent_profiles)
- stage (enum: cv_parsing) -- saat ini satu stage. Tetap pakai enum (bukan boolean) untuk extensibility jika nanti ditambahkan stage lain (portfolio_review, skill_test, dll) tanpa migration breaking
- status (enum: pending, in_progress, passed, failed)
- score (float, nullable)
- reviewer_id (FK -> users, nullable, untuk manual override oleh admin)
- notes (text, nullable)
- completed_at
- created_at

talent_penalties (tracking suspend/penalty)

- id (UUID v7, PK)
- talent_id (FK -> talent_profiles)
- type (enum: warning, rating_penalty, suspension, ban)
- reason (text)
- related_project_id (text, nullable — saat ini bukan FK, tidak ada .references() ke projects)
- issued_by (FK -> users, admin)
- appeal_status (enum: none, pending, accepted, rejected)
- appeal_note (text, nullable)
- expires_at (timestamptz, nullable, untuk temporary suspension)
- created_at

talent_skills (many-to-many)

- talent_id (FK -> talent_profiles)
- skill_id (FK -> skills)
- proficiency_level (enum: beginner, intermediate, advanced, expert)
- is_primary (boolean)
- PK: (talent_id, skill_id)

skills (master data)

- id (UUID v7, PK)
- name (unique)
- category (enum: frontend, backend, mobile, design, data, devops, other)
- aliases (JSONB, array of string untuk fuzzy matching, misal: ["ReactJS", "React.js", "React"])
- embedding (vector(1024), pgvector, untuk semantic skill matching)

#### Project Domain

projects

- id (UUID v7, PK)
- owner_id (FK -> users)
- title
- description
- category (enum: web_app, mobile_app, ui_ux_design, data_ai, other_digital)
- status (enum: draft, scoping, brd_generated, brd_approved, brd_purchased, prd_generated, prd_approved, prd_purchased, matching, team_forming, matched, in_progress, partially_active, review, completed, cancelled, disputed, on_hold)
- budget_min, budget_max (integer, dalam Rupiah)
- estimated_timeline_days
- team_size (integer, default 1, dihitung AI dari PRD)
- final_price (integer, yang dibayar owner — derivation: sum(work_packages.amount))
- platform_fee (integer, bagian platform — derivation: final_price − talent_payout)
- talent_payout (integer, total yang diterima semua talent — derivation: round(final_price × talentShare bracket), dibagi pro rata ke work_packages.talent_payout. Constraint: final_price = talent_payout + platform_fee)
- preferences (JSONB: {almamater, min_experience, required_skills} — required_skills disimpan sebagai string names, di-resolve ke skills table saat matching via fuzzy pipeline)
- project_type (enum project_type: individual, company, default individual)
- company_name, company_role (nullable — untuk project_type company)
- progress (integer, default 0)
- completeness_score (integer, default 0)
- document_file_url, document_type (varchar 10, nullable)
- visibility (enum project_visibility: private, public_summary, public_detail, default public_summary)
- created_at, updated_at, deleted_at

project_status_logs (audit trail)

- id (UUID v7, PK)
- project_id (FK -> projects)
- from_status
- to_status
- changed_by (FK -> users)
- reason (text, opsional)
- created_at

chat_conversations

- id (UUID v7, PK)
- project_id (FK -> projects)
- type (enum: ai_scoping, owner_talent, team_group, talent_talent, admin_mediation)
- created_at
- Untuk team project: owner_talent = private chat owner-talent per talent, team_group = group chat semua talent + owner, talent_talent = inter-talent koordinasi, admin_mediation = dispute resolution chat (admin + kedua pihak)

chat_participants (join table — siapa saja yang ada di conversation)

- id (UUID v7, PK)
- conversation_id (FK -> chat_conversations)
- user_id (FK -> users)
- joined_at (timestamptz)
- role (enum: member, moderator) — moderator = admin/platform
- UNIQUE: (conversation_id, user_id)

Kolom `left_at` sudah dihapus di migrasi 0033. Tidak ada satu pun penulis di
seluruh kode, empat pembaca yang semuanya mengabaikannya, dan sebuah komentar di
chat.ts yang mengaku memfilter peserta aktif padahal query-nya tidak. Membangun
"leave" dengan benar berarti membuat endpoint penghapusan peserta plus model
otorisasi siapa boleh menghapus siapa, tanpa UI dan tanpa caller, yang dilarang
aturan YAGNI di dokumen ini. Memfilter sebagian juga lebih buruk daripada tidak
sama sekali: peserta yang keluar jadi tidak bisa melihat daftar percakapan tapi
masih bisa mengirim pesan dan memegang subscription Centrifugo. Menambahkannya
kembali adalah migrasi, jadi jangan menambahkannya spekulatif.

Catatan tentang aturan migrasi additive-only di atas: aturan itu melindungi
rolling deploy, di mana versi lama masih melayani trafik. Drop di 0033 aman
karena setiap pembacaan memakai select berkolom eksplisit dan insert-nya tidak
pernah menyebut kolom itu, jadi tidak ada versi ter-deploy yang mengirim SQL
yang menyebutkannya. Diverifikasi, bukan diasumsikan.

chat_messages

- id (UUID v7, PK)
- conversation_id (FK -> chat_conversations)
- sender_type (enum: user, ai, system)
- sender_id (FK -> users, nullable untuk AI/system)
- content (text)
- metadata (JSONB, untuk AI: model, tokens used, completeness_score)
- created_at

project_activities (unified activity feed per proyek)

- id (UUID v7, PK)
- project_id (FK -> projects)
- user_id (FK -> users, nullable untuk system events)
- type (enum: message_sent, milestone_submitted, milestone_approved, milestone_rejected, revision_requested, payment_made, payment_released, file_uploaded, status_changed, talent_assigned, talent_replaced, talent_declined, team_formed, review_posted, dispute_opened, dispute_resolved, project_on_hold, project_resumed)
- title (string, ringkasan aktivitas)
- metadata (JSONB, detail tambahan sesuai type)
- created_at

brd_documents

- id (UUID v7, PK)
- project_id (FK -> projects, unique)
- content (JSONB, structured BRD data)
- version (integer, untuk track revisi). Versi 0 berarti RESERVASI, bukan dokumen: jatah generasi gratis dulu dibaca, dibandingkan dengan limit, lalu ditulis setelah model menjawab, sehingga dua submit bersamaan sama-sama lolos pengecekan dan sama-sama menagih model tanpa meninggalkan baris duplikat yang bisa disadari. Sekarang jatah diklaim lewat conditional UPDATE atas versi yang dibaca, atau INSERT ON CONFLICT DO NOTHING kalau baris belum ada, dan default kolom yang bernilai 1 membuat 0 tidak mungkin dimiliki dokumen sungguhan. Klaim diambil SEBELUM panggilan model karena document-generation.ts sudah menjanjikan owner bahwa generasi gagal tidak memotong kuota, jadi setiap kegagalan mengembalikannya, dan pelepasan hanya membungkus panggilan model — apa pun setelahnya berjalan di atas generasi yang sudah dibayar. Sebelas pembacaan dokumen di projects.ts memfilter `version > 0`, dan reservasi tidak terlihat konsumen lain: embedding backfill memfilter `status = 'approved'`, sedangkan payment-service menilai reservasi seharga 0 yang sudah ditolak guard `amount <= 0` miliknya persis seperti baris yang tidak ada
- status (enum: draft, review, approved, paid)
- price (integer, harga BRD)
- paid_at (timestamptz, nullable — paid unlock: download tanpa watermark, revisi sampai 9x)
- embedding (vector(1024), pgvector, untuk RAG similarity search)
- created_at, updated_at

prd_documents

- id (UUID v7, PK)
- project_id (FK -> projects, unique)
- content (JSONB, structured PRD data termasuk team_composition: {team_size, work_packages: [{title, required_skills, estimated_hours, amount}], task_decomposition, dependencies})
- version (integer)
- status (enum: draft, review, approved, paid)
- price (integer, harga PRD)
- paid_at (timestamptz, nullable — paid unlock: download tanpa watermark, revisi sampai 9x)
- embedding (vector(1024), pgvector)
- created_at, updated_at

document_chunks (satu baris per section BRD/PRD, unit yang dipakai retrieval)

- id (UUID v7, PK)
- document_id (id baris brd_documents atau prd_documents; sengaja bukan FK karena satu kolom menunjuk dua tabel)
- document_type (enum document_chunk_type: brd, prd)
- project_id (FK -> projects — didenormalisasi dari dokumen induknya supaya predikat tenant di hybrid_search tidak butuh join)
- section_title (misal: "executive summary", "functional requirements: Escrow")
- section_order (integer, kontigu dari 0, separuh dari unique index bersama document_id)
- content (text, teks section yang di-embed dan dicari BM25)
- embedding (vector(1024), pgvector)
- created_at
- UNIQUE: (document_id, section_order)
- Kolom `embedding` di brd_documents dan prd_documents adalah pendahulunya dan sudah tidak dibaca. Detail pemotongan dan alasannya di bagian RAG

project_applications

- id (UUID v7, PK)
- project_id (FK -> projects)
- talent_id (FK -> talent_profiles)
- status (enum: pending, accepted, rejected, withdrawn). Saat owner menerima lamaran, satu baris project_assignments ikut dibuat dalam transaksi yang sama
- cover_note (text, pesan dari talent)
- recommendation_score (float, dari algoritma matching)
- created_at, updated_at
- UNIQUE: (project_id, talent_id)

work_packages (pembagian tugas per talent dalam team project)

- id (UUID v7, PK)
- project_id (FK -> projects)
- title (misal: "Frontend Development", "Backend API", "UI/UX Design")
- description
- order_index (integer)
- required_skills (JSONB, array of skill names yang dibutuhkan)
- estimated_hours (float)
- amount (integer, nominal harga work package ini)
- talent_payout (integer, yang diterima talent untuk work package ini)
- status (enum: unassigned, pending_acceptance, assigned, declined, in_progress, completed, terminated)
- created_at, updated_at
- Kolom status ini adalah gerbang team formation, bukan pembukuan: matching menawarkan posisi `WHERE status IN ('unassigned')`, applications memilih package bebasnya dari ('unassigned','declined'), dan `allPackagesStaffed` menghitung nilai-nilai ini untuk mempromosikan proyek ke matched. `PATCH /work-packages/:id/status` dulu membaca baris, mengecek keberadaannya, lalu menulis atas id saja, sehingga bisa menimpa `assigned` yang baru saja di-commit sebuah penerimaan talenta. Sekarang di-CAS pada status yang dibaca, dan penulis kalah mendapat 409 — yang sekaligus mematikan event kedua yang saling bertentangan. Penulis lain (matching confirm, applications accept) menulis atas id saja tapi terjaga secara transitif: keduanya meng-INSERT project_assignments berstatus 'active' SEBELUM update status di transaksi yang sama, dan `uq_project_assignments_wp_live` menggagalkan insert kedua sehingga seluruh transaksinya di-rollback
- pending_acceptance: talent sudah direkomendasikan, menunggu accept/decline
- declined: talent menolak, platform cari pengganti (status kembali ke unassigned setelah replacement ditemukan)
- Untuk single talent project: 1 work package yang mencakup seluruh proyek

project_assignments (satu per talent per proyek, bisa multiple per proyek untuk team)

- id (UUID v7, PK)
- project_id (FK -> projects)
- talent_id (FK -> talent_profiles)
- work_package_id (FK -> work_packages)
- application_id (FK -> project_applications, nullable — untuk team project, talent bisa di-assign langsung tanpa apply)
- role_label (string, misal: "Frontend Developer", "Backend Developer", "UI/UX Designer")
- acceptance_status (enum: pending, accepted, declined) — tracking talent acceptance sebelum proyek dimulai
- status (enum: active, completed, terminated, replaced)
- started_at, completed_at
- created_at
- Keunikan 'satu talent aktif per work_package' dijaga di dua lapis: validasi aplikasi saat matching confirm DAN partial unique index `uq_project_assignments_wp_live` di database — (project_id, work_package_id) WHERE status IN ('active','completed')

contracts (NDA dan IP agreement per talent per proyek)

- id (UUID v7, PK)
- project_id (FK -> projects)
- assignment_id (FK -> project_assignments)
- type (enum: standard_nda, ip_transfer)
- content (JSONB, generated contract data)
- signed_by_owner (boolean, default false)
- signed_by_talent (boolean, default false)
- signed_at (timestamptz, nullable)
- created_at
- Untuk team project: satu kontrak per talent (bukan unique per project)

disputes (dispute resolution tracking)

- id (UUID v7, PK)
- project_id (FK -> projects)
- work_package_id (FK -> work_packages, nullable — untuk team project, dispute bisa per work package)
- initiated_by (FK -> users)
- against_user_id (FK -> users)
- reason (text)
- evidence_urls (JSONB, array of file URLs)
- status (enum: open, under_review, mediation, resolved, escalated) — maps to 3-step process: open (Step 1 direct resolution), under_review/mediation (Step 2 admin mediation), escalated (Step 3 binding decision), resolved (final)
- resolution (text, nullable, keputusan final)
- resolution_type (enum: funds_to_talent, funds_to_owner, split, nullable)
- resolved_by (FK -> users, nullable, admin yang resolve)
- resolved_at (timestamptz, nullable)
- created_at, updated_at

milestones

- id (UUID v7, PK)
- project_id (FK -> projects)
- work_package_id (FK -> work_packages, nullable — null jika single talent atau milestone integrasi)
- assigned_talent_id (FK -> talent_profiles, nullable — null jika milestone integrasi yang butuh multiple talent)
- title
- description
- milestone_type (enum: individual, integration) — individual: satu talent, integration: butuh submit dari multiple talent
- order_index (integer, urutan milestone)
- amount (integer, nominal pencairan untuk milestone ini)
- status (enum: pending, in_progress, submitted, revision_requested, approved, rejected)
- revision_count (integer, default 0, max 2 sebelum biaya tambahan)
- due_date
- submitted_at (timestamptz, untuk mulai hitung 14 hari auto-release)
- completed_at
- metadata (JSONB, nullable — untuk deliverable checklist: `{ deliverables: [{ title, type, expected, submitted_url, status }] }`)
- created_at, updated_at

milestone_files (attachment per milestone submission)

- id (UUID v7, PK)
- milestone_id (FK -> milestones)
- file_name (string)
- file_url (string, S3 path)
- file_size (integer, bytes)
- mime_type (string)
- uploaded_by (FK -> users)
- created_at

milestone_comments (comment thread per milestone)

- id (UUID v7, PK)
- milestone_id (FK -> milestones)
- user_id (FK -> users)
- content (text)
- created_at, updated_at

revision_requests (tracking revisi per milestone — baik yang gratis maupun berbayar)

- id (UUID v7, PK)
- milestone_id (FK -> milestones)
- requested_by (FK -> users, owner yang request)
- description (text, detail revisi yang diminta)
- severity (enum: minor, moderate, major)
- is_paid (boolean, default false — true jika sudah melewati 2 revisi gratis)
- fee_amount (integer, nullable — biaya jika is_paid = true)
- fee_transaction_id (FK -> transactions, nullable — referensi pembayaran revisi)
- status (enum: pending, accepted, in_progress, completed, declined)
- talent_response (text, nullable — alasan jika declined)
- requested_at (timestamptz)
- completed_at (timestamptz, nullable)
- created_at

tasks (sub-item dari milestone, untuk Gantt chart)

- id (UUID v7, PK)
- milestone_id (FK -> milestones)
- assigned_talent_id (FK -> talent_profiles, nullable — inherit dari milestone jika individual, explicit jika integration milestone)
- title
- description
- order_index (integer)
- status (enum: pending, in_progress, completed)
- estimated_hours (float)
- actual_hours (float, dari time tracking)
- start_date
- end_date
- created_at, updated_at

task_dependencies (untuk Gantt chart)

- id (UUID v7, PK)
- task_id (FK -> tasks)
- depends_on_task_id (FK -> tasks)
- type (enum: finish_to_start, start_to_start, finish_to_finish)
- UNIQUE: (task_id, depends_on_task_id)

work_package_dependencies (DAG dependency antar work packages, di-generate AI dari PRD)

- id (UUID v7, PK)
- work_package_id (FK -> work_packages)
- depends_on_work_package_id (FK -> work_packages)
- type (enum: finish_to_start, start_to_start, finish_to_finish) — finish_to_start paling umum (misal: backend selesai sebelum frontend integrasi). Catatan: memakai enum `dependency_type` yang sama dengan task_dependencies
- UNIQUE: (work_package_id, depends_on_work_package_id)
- Validasi: no cycles (DAG check saat create)

time_logs (time tracking)

- id (UUID v7, PK)
- task_id (FK -> tasks)
- talent_id (FK -> talent_profiles)
- started_at (timestamptz)
- ended_at (timestamptz, nullable jika timer masih jalan)
- duration_minutes (integer, computed on save)
- description (text, opsional)
- created_at

#### Payment Domain

transactions

- id (UUID v7, PK)
- project_id (FK -> projects)
- work_package_id (FK -> work_packages, nullable — untuk tracking escrow per work package di team project)
- milestone_id (FK -> milestones, nullable)
- talent_id (FK -> talent_profiles, nullable — untuk tracking pembayaran per talent di team project)
- type (enum: escrow_in, escrow_release, brd_payment, prd_payment, refund, partial_refund, revision_fee, talent_placement_fee)
- amount (integer)
- status (enum: pending, processing, completed, failed, refunded)
- payment_method
- payment_gateway_ref (string, reference dari payment gateway)
- idempotency_key (unique, untuk mencegah double payment)
- created_at, updated_at, deleted_at

transaction_events (audit trail, append-only, jangan pernah UPDATE atau DELETE)

- id (UUID v7, PK)
- transaction_id (FK -> transactions)
- event_type (enum: escrow_created, milestone_submitted, milestone_approved, funds_released, refund_initiated, dispute_opened, dispute_resolved)
- previous_status
- new_status
- amount (nullable, jika event melibatkan perubahan nominal)
- metadata (JSONB, detail tambahan)
- performed_by (FK -> users)
- created_at

accounts (double-entry bookkeeping — setiap entity yang terlibat dalam transaksi punya account)

- id (UUID v7, PK)
- owner_type (enum: platform, owner, talent, escrow) — tipe pemilik account
- owner_id (UUID v7, nullable — FK ke users/talent_profiles, null untuk platform account)
- account_type (enum: asset, liability, revenue, expense)
- name (string, misal: "Owner Escrow - Project X", "Talent Payout - Talent Y", "Platform Revenue")
- balance (integer, default 0, dalam Rupiah — updated via trigger atau application logic, selalu = sum(debit) - sum(credit) dari ledger_entries)
- currency (string, default: "IDR")
- created_at, updated_at

ledger_entries (append-only, setiap transaksi = 2+ entries yang sum to zero)

- id (UUID v7, PK)
- transaction_id (FK -> transactions — referensi ke transaksi bisnis yang memicu entry ini)
- account_id (FK -> accounts)
- entry_type (enum: debit, credit)
- amount (integer, CHECK amount > 0 — selalu positif, tipe ditentukan oleh entry_type)
- description (text, misal: "Escrow deposit for milestone 1", "Platform fee for project X")
- metadata (JSONB, nullable — detail tambahan: project_id, milestone_id, talent_id)
- created_at
- Index: (account_id, created_at) untuk balance calculation dan audit trail
- Index: (transaction_id) untuk menghubungkan semua entries dalam satu transaksi
- Constraint: untuk setiap transaction_id, sum(debit amounts) HARUS = sum(credit amounts) — enforced di application layer via db.transaction()

Contoh flow escrow (konvensi runtime: debit menaikkan balance akun, credit menurunkan):

1. Owner bayar escrow gross Rp 10jt (webhook Midtrans settled): DEBIT escrow account proyek Rp 10jt, CREDIT owner account Rp 10jt
2. Milestone gross Rp 10jt di-approve, satu transaksi release dengan 3 ledger legs: CREDIT escrow Rp 10jt, DEBIT talent_payout_account sebesar talent share (Rp 7,15jt pada bracket <= Rp 10 juta yang memberi talenta 71,5%), DEBIT platform_revenue_account sebesar fee (Rp 2,85jt)
   Setiap transaksi: sum(debit) = sum(credit), ledger selalu balanced. Fee dihitung project-service (computeMilestoneFee: rasio work_package.talent_payout/amount, fallback rasio proyek) dan dikirim sebagai feeAmount ke /payments/release; payload event payment.released memuat amount (net talent), grossAmount, feeAmount

talent_placement_requests (tracking talent placement / direct hire requests)

- id (UUID v7, PK)
- project_id (FK -> projects — proyek asal yang menghubungkan owner dan talent)
- owner_id (FK -> users)
- talent_id (FK -> talent_profiles)
- status (enum: requested, in_discussion, accepted, declined, completed)
- estimated_annual_salary (integer, nullable — estimasi gaji tahunan untuk kalkulasi fee)
- conversion_fee_percentage (float — 10-15% berdasarkan durasi hubungan kerja)
- conversion_fee_amount (integer, nullable — dihitung dari salary \* percentage)
- transaction_id (FK -> transactions, nullable — referensi pembayaran fee)
- notes (text, nullable)
- created_at, updated_at

project_invoices (auto-generated invoice PDF per milestone)

- id (UUID v7, PK)
- project_id (FK -> projects)
- milestone_id (FK -> milestones)
- invoice_number (string, sequential per project, satu nomor per milestone dipakai bersama ketiga copy)
- pdf_url (string, PDF di-generate @react-pdf/renderer)
- audience (enum: owner | talent | admin — owner lihat gross, talent lihat payout, hanya admin lihat platform fee)
- generated_at (timestamptz)
- UNIQUE (milestone_id, audience)

#### Shared Domain

reviews (INTERNAL ONLY — rating dan review tidak ditampilkan ke owner lain atau talent lain, hanya untuk AI matching dan admin monitoring)

- id (UUID v7, PK)
- project_id (FK -> projects)
- reviewer_id (FK -> users)
- reviewee_id (FK -> users)
- rating (integer, 1-5)
- comment (text)
- type (enum: owner_to_talent, talent_to_owner)
- is_visible_to_reviewee (boolean, default true) -- talent bisa lihat rating sendiri untuk self-improvement
- is_public_testimonial (boolean, default false — opt-in untuk testimonial landing page)
- created_at

notifications

- id (UUID v7, PK)
- user_id (FK -> users)
- type (enum: project_match, application_update, milestone_update, payment, dispute, team_formation, assignment_offer, system)
- title
- message
- link (string, deep link ke halaman terkait)
- is_read (boolean, default false)
- created_at

user_notification_preferences (preferensi channel notifikasi per user)

- id (UUID v7, PK)
- user_id (FK -> users, unique)
- email_notifications (boolean, default true)
- project_updates (boolean, default true)
- payment_alerts (boolean, default true)
- created_at, updated_at

#### AI Domain

ai_interactions (log semua AI calls untuk analytics dan improvement)

- id (UUID v7, PK)
- project_id (FK -> projects, nullable)
- user_id (FK -> users, nullable)
- interaction_type (enum: chatbot, brd_generation, prd_generation, cv_parsing, matching, embedding)
- model (string, misal: "gpt-4o-mini-ft-bytz-v1")
- prompt_tokens (integer)
- completion_tokens (integer)
- latency_ms (integer)
- cost_usd (decimal)
- status (enum: success, error, timeout)
- created_at

#### Admin Domain

admin_audit_logs

- id (UUID v7, PK)
- admin_id (FK -> users)
- action (string, misal: "user.suspend", "project.reassign", "config.update")
- target_type (string, misal: "user", "project", "config")
- target_id (UUID v7)
- details (JSONB, before/after values)
- created_at

platform_settings

- id (UUID v7, PK)
- key (string, unique)
- value (JSONB)
- description (text)
- updated_by (FK -> users)
- updated_at

#### Infrastructure Domain

outbox_events (Outbox Pattern — reliable event publishing ke NATS)

- id (UUID v7, PK)
- aggregate_type (string, misal: "project", "payment", "talent")
- aggregate_id (UUID v7, referensi ke entity yang trigger event)
- event_type (string, misal: "project.status.changed")
- payload (JSONB, event data)
- published (boolean, default false)
- published_at (timestamptz, nullable)
- retry_count (integer, default 0)
- error_message (text, nullable — jika publish gagal)
- created_at
- Index: (published, created_at) untuk efficient polling

dead_letter_events (DLQ — events yang gagal diproses setelah max retry)

- id (UUID v7, PK)
- original_event_id (string, referensi ke event NATS asli)
- event_type (string)
- payload (JSONB)
- consumer_service (string, service yang gagal process)
- error_message (text)
- retry_count (integer)
- reprocessed (boolean, default false)
- reprocessed_at (timestamptz, nullable)
- created_at

#### Analytics Domain

CATATAN KODE: materialized view di bawah ini BELUM ADA. Migrasi 0000 sempat
membuatnya sebagai tabel biasa, lalu dihapus di migrasi 0014. Tidak ada
REFRESH MATERIALIZED VIEW maupun jadwal pg_cron di repo. Dashboard admin
melakukan query langsung ke tabel dasar (admin-service/internal/store/
dashboard.go). Bagian ini bertahan sebagai rancangan untuk saat volume data
membuat query langsung terlalu lambat.

Materialized views untuk dashboard BI, di-refresh via pg_cron setiap 5 menit:

mv_project_overview (agregasi proyek)

- total_projects_by_status (JSONB: {draft: N, scoping: N, ...})
- conversion_funnel (JSONB: {brd_generated: N, prd_generated: N, in_progress: N, completed: N})
- avg_completion_days (float)
- total_revenue (integer)
- revenue_this_month (integer)
- refreshed_at (timestamptz)

mv_revenue_daily (revenue harian)

- date (date)
- brd_revenue (integer)
- prd_revenue (integer)
- project_margin_revenue (integer)
- revision_fee_revenue (integer)
- total_revenue (integer)
- project_count (integer)
- refreshed_at (timestamptz)

mv_worker_stats (statistik talent)

- total_workers (integer)
- workers_by_tier (JSONB: {junior: N, mid: N, senior: N})
- avg_projects_per_worker (float)
- avg_rating (float)
- utilization_rate (float, persentase talent yang punya proyek aktif)
- distribution_gini (float, Gini coefficient untuk fairness tracking)
- refreshed_at (timestamptz)

mv_matching_metrics (performa matching)

- avg_time_to_match_hours (float)
- match_success_rate (float)
- exploration_ratio (float)
- total_matches_this_month (integer)
- refreshed_at (timestamptz)

mv_ai_cost (biaya AI)

- date (date)
- model (string)
- total_requests (integer)
- total_tokens (integer)
- total_cost_usd (decimal)
- avg_latency_ms (integer)
- refreshed_at (timestamptz)

pg_cron schedule: `SELECT cron.schedule('refresh-mv', '*/5 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_project_overview; REFRESH MATERIALIZED VIEW CONCURRENTLY mv_revenue_daily; ...')`

## Internationalization (i18n)

### Setup

- Library: react-i18next + i18next + i18next-browser-languagedetector. Resource JSON per namespace di-import langsung (bundled) di src/lib/i18n.ts, bukan di-fetch runtime — i18next-http-backend belum dipakai
- Default language: Bahasa Indonesia (id)
- Supported languages: id, en
- Detection order: localStorage -> navigator -> fallback (id)
- Translation files: JSON per namespace per language (/locales/{lng}/{ns}.json)

### Namespaces

- common: button labels, navigation, generic UI text
- auth: login, register, OAuth, session, password reset
- project: project-related text (form labels, status names, flow descriptions)
- talent: talent-related text (profile, dashboard, CV parsing, time tracking)
- chat: chatbot UI, chat owner-talent, group chat, system messages
- document: BRD/PRD viewer, editor, generation status
- matching: talent recommendation, team formation, anonymous profil
- payment: payment-related text (invoice, escrow, transaction)
- admin: admin panel text
- errors: error messages

### Konvensi

- Key format: snake_case (misal: project.create_new, common.submit_button)
- Interpolation: {{variable}} untuk dynamic values
- Pluralization: ICU MessageFormat
- Bahasa Indonesia sebagai primary, English sebagai secondary
- Semua user-facing text HARUS melalui t() function, tidak boleh hardcode string di komponen
- Language switcher di header, preference disimpan di localStorage dan user profile (locale column)

## Prinsip UI/UX Design

### Design Laws yang Diterapkan

Jakob's Law: User menghabiskan sebagian besar waktu di platform lain. Jangan buat UI yang terlalu unik sampai membingungkan. Pakai pattern yang sudah familiar: sidebar navigation, card-based listing, modal untuk aksi penting. Referensi layout dari Upwork dan Toptal yang sudah dikenal user.

Hick's Law: Kurangi pilihan yang ditampilkan bersamaan. Form pengajuan proyek dipecah jadi multi-step (wizard), bukan satu form panjang. Dashboard hanya tampilkan metrik dan aksi yang paling relevan per role.

Fitts's Law: Tombol aksi utama (Submit, Apply, Approve) harus besar dan mudah dijangkau. Pada mobile, letakkan di area jempol (bottom of screen). Jarak antar tombol yang berbahaya (Delete, Cancel) harus cukup jauh dari tombol utama.

Miller's Law: Kelompokkan informasi dalam chunk 5-7 item. Daftar fitur di BRD dikelompokkan per modul. Skill tags di profil talent dikelompokkan per kategori.

Von Restorff Effect: Elemen yang paling penting harus berbeda secara visual. CTA (Call to Action) pakai warna primary yang kontras. Badge "Proyek Baru" atau "Cocok untuk Anda" di listing proyek. Status urgent pakai warna merah.

Doherty Threshold: Response time harus di bawah 400ms untuk interaksi biasa. Untuk operasi yang lebih lama (AI generation), tampilkan streaming response atau progress indicator yang informatif.

Gestalt Principles:

- Proximity: Elemen yang berhubungan diletakkan berdekatan. Form fields yang terkait dikelompokkan dalam satu section. Card project mengelompokkan: judul+deskripsi, budget+timeline, skills+status
- Similarity: Elemen dengan fungsi sama punya style konsisten (semua card punya layout sama, semua button punya style konsisten per variant)
- Closure: User melengkapi shape/pattern yang tidak lengkap. Pakai progress bar dan step indicator di wizard form supaya user "ingin menyelesaikan"
- Continuity: Elemen yang diatur dalam garis atau kurva dipersepsikan sebagai grup. Timeline dan Gantt chart memanfaatkan ini
- Figure-Ground: Elemen utama (foreground) harus jelas terpisah dari background. Modal overlay dengan backdrop blur, active card dengan shadow lebih kuat

Aesthetic-Usability Effect: UI yang terlihat rapi dan profesional akan dipersepsikan lebih mudah dipakai. Konsisten dalam spacing, alignment, dan typography.

Zeigarnik Effect: Orang mengingat tugas yang belum selesai lebih baik dari yang sudah. Tampilkan progress bar dan checklist incomplete di dashboard supaya user kembali menyelesaikan (misal: "Profil 70% lengkap", "3 dari 5 milestone selesai").

Peak-End Rule: User menilai pengalaman berdasarkan peak (momen paling intens) dan end (akhir). Pastikan momen key (terima BRD, proyek selesai) punya feedback visual yang memuaskan (confetti, summary card yang clean). Akhir flow (checkout, completion) harus smooth tanpa friction.

Serial Position Effect: User mengingat item pertama dan terakhir dari daftar lebih baik. Letakkan informasi terpenting di awal dan akhir list. Pada navigation, taruh item paling sering dipakai di awal dan akhir menu.

Postel's Law (Robustness Principle): Terima input yang liberal, beri output yang konservatif. Form harus toleran terhadap format input (phone number dengan/tanpa +62, budget dengan/tanpa "Rp"). Tapi output dari sistem harus selalu konsisten dan terformat rapi.

Pareto Principle (80/20): 80% user hanya pakai 20% fitur. Prioritaskan dan tampilkan fitur yang paling sering dipakai. Advanced features bisa di-hide di dropdown atau settings.

Tesler's Law (Law of Conservation of Complexity): Setiap sistem memiliki kompleksitas minimal yang tidak bisa dihilangkan. Tugas developer adalah memastikan complexity ditanggung oleh sistem, bukan user. Misal: AI menghitung team size dan pricing secara otomatis, user hanya konfirmasi.

Occam's Razor: Jika ada dua solusi UI, pilih yang lebih sederhana. Jangan tambahkan opsi/konfigurasi yang jarang dipakai. Default values harus sudah optimal untuk sebagian besar kasus.

Progressive Disclosure: Tampilkan informasi secara bertahap sesuai kebutuhan. Dashboard awal hanya tampilkan metrik utama, detail di-expand on demand. Form multi-step (wizard) menerapkan ini. BRD/PRD preview collapse section by default, expand on click.

Recognition over Recall: User lebih mudah mengenali daripada mengingat. Gunakan dropdown/select daripada free text untuk pilihan yang terbatas. Tampilkan recent projects, suggested skills, autocomplete.

Cognitive Load Theory: Batasi jumlah informasi yang harus diproses user bersamaan. Chunking: kelompokkan informasi terkait. Signposting: breadcrumb, step indicator, section header yang jelas. External memory: progress disimpan otomatis, user bisa lanjut kapan saja.

F-Pattern & Z-Pattern Layout: Halaman text-heavy (BRD preview, project detail) ikuti F-pattern — informasi penting di kiri atas, heading prominent. Landing page dan halaman marketing ikuti Z-pattern — logo kiri atas, CTA kanan atas, konten zigzag ke bawah.

### Four-State UI Pattern

Setiap komponen yang fetch data HARUS handle 4 state:

1. **Empty state**: data belum ada (first time user). Tampilkan ilustrasi + CTA yang jelas. Contoh: "Belum ada proyek. Buat proyek pertamamu!"
2. **Loading state**: data sedang di-fetch. Skeleton loader (bukan spinner di tengah kosong)
3. **Error state**: fetch gagal. Error message + retry button. Jangan tampilkan halaman kosong
4. **Partial state**: data sebagian berhasil. Tampilkan yang ada, tandai yang gagal, beri opsi retry per section

### Dark Mode Architecture

Dark mode SUDAH terpasang dan hidup di apps/web, bukan rencana fase berikutnya. `stores/theme.ts` menaruh class `dark` di `document.documentElement`, menyimpan pilihannya di localStorage, dan jatuh ke `prefers-color-scheme` saat belum ada pilihan. Toggle-nya ada di public-header. apps/admin tidak punya toggle: konsol itu dark-first lewat `body` di styles.css-nya.

Dark mode dikerjakan lewat override TOKEN, bukan rule yang menimpa nama class hasil generate Tailwind. Blok `.dark` mendefinisikan ulang `--color-surface`, `--color-on-surface`, `--color-outline`, `--color-outline-dim`, plus lima token brand di bawah. Setiap utility yang membaca token itu ikut berubah, termasuk varian opacity yang belum ditulis siapa pun, karena Tailwind v4 memancarkan `color-mix(in oklab, var(--token) N%, transparent)` di dalam `@supports` untuk tiap `/alpha` (hex statis di luarnya hanya fallback browser lama).

**Token brand, dan kenapa skala palet saja tidak cukup.** `text-primary-600` (372 call site) harus jadi TERANG di dark mode supaya terbaca di atas permukaan gelap, sementara `bg-primary-600` (169 call site) harus jadi varian gelap yang BERBEDA supaya tetap terpisah dari permukaan itu dan tetap membawa teks putih. Keduanya membaca `--color-primary-600` yang sama, jadi tidak ada satu override token yang melayani dua-duanya. Yang memisahkannya adalah lapisan token peran:

| Token | Peran | Light | Dark |
| --- | --- | --- | --- |
| `--color-brand` | fill opaque, konten putih di atasnya | #152e34 | #0d4d4d |
| `--color-brand-hover` | fill itu saat ditekan | #112630 | #0a3f3f |
| `--color-brand-muted` | fill itu, lebih terang | #1d4a54 | #1a5858 |
| `--color-brand-text` | teks dan ikon brand di atas permukaan biasa | #152e34 | #b4edec |
| `--color-brand-accent` | teks redup, border, ring, tint transparan | #1d4a54 | #98d1d0 |

Lima token, bukan satu set peran untuk seluruh palet, karena hanya `primary` yang gelap. Hijau #9fc26e, coral #e59a91, dan cream #f6f3ab sudah terbaca di atas permukaan gelap; lima rule `text-*` yang tersisa di `.dark` menaikkannya satu tingkat sebagai penghalusan, bukan perbaikan, dan tetap berupa rule class karena token yang sama juga memberi makan `bg-success-600` yang membawa teks putih.

Yang TIDAK ikut pindah ke token peran, dan itu disengaja: scrim modal (`bg-primary-900/40`, `bg-primary-800/70`), sidebar (`bg-primary-800`), dan konten di atas fill brand (`text-primary-100`, `text-primary-200`, `border-primary-200`). Semuanya sudah benar di kedua tema, jadi memberinya token peran berarti membuat pembeda yang tidak punya keadaan kedua untuk dibedakan.

- `@custom-variant dark (&:where(.dark, .dark *))` dideklarasikan, jadi varian `dark:` bekerja dengan toggle berbasis class. Dipakai kalau yang berbeda antar tema adalah ALPHA-nya, bukan warnanya — token tidak bisa mengubah `/30` menjadi `/10`
- apps/admin TIDAK memakai token brand ini dan tidak perlu: konsol itu dark-first tanpa toggle, jadi tidak ada keadaan kedua. 508 call site palet di sana sengaja dibiarkan
- BUKAN shadcn/Radix. Bagian ini dulu menyebut "shadcn/ui sudah support `.dark` class toggle" padahal komponen di repo ini hand-rolled dan tidak ada `components.json` maupun `@radix-ui` di dependency mana pun
- Pertimbangkan OKLCH color space untuk dark mode palette (perceptually uniform — L=0.25 untuk background, L=0.85 untuk text menghasilkan consistent brightness across hues, unlike HSL). Browser support sudah solid (Chrome 111+, Firefox 113+, Safari 15.4+). Saat ini masih hex

### Color Palette

Base: Dark teal + natural tone palette yang menyampaikan kepercayaan, profesionalisme, dan kesan organik/approachable. Kombinasi dark teal sebagai anchor dengan warm accent (coral, cream) menciptakan visual hierarchy yang kuat sekaligus friendly.

Brand colors: #152e34, #3b526a, #f6f3ab, #9fc26e, #e59a91, #5e677d

Color mapping ke semantic roles (mengikuti UI/UX principles):

```
Primary (Dark Teal) — trust, professionalism, CTA buttons, active states:
  50:  #e8f0f1
  100: #c5d8dc
  200: #9ebcc3
  300: #6d9ba5
  400: #467a87
  500: #1d4a54  <- primary default (derived from #152e34, lighter for better contrast)
  600: #152e34  <- primary hover/pressed (brand anchor color)
  700: #112630
  800: #0d1e28
  900: #091419

Neutral (Slate Blue) — text, borders, backgrounds, derived from #3b526a and #5e677d:
  50:  #f4f5f7  <- background utama
  100: #e8eaed  <- background card/section
  200: #d1d5db  <- border
  300: #b0b7c3  <- disabled state
  400: #8891a0  <- placeholder text (#5e677d lightened)
  500: #5e677d  <- secondary text (brand gray)
  600: #3b526a  <- body text (brand slate blue)
  700: #2e4256
  800: #1f2e3d  <- heading text
  900: #131c27  <- darkest text

Semantic Colors (using brand greens, corals, and cream for consistency):
  Success:  #9fc26e (brand green) / #7fa84e (darker green for hover)
  Warning:  #f6f3ab (brand cream-yellow) / #e8e47a (darker cream for contrast)
  Error:    #e59a91 (brand coral) / #d47367 (darker coral for hover)
  Info:     #3b526a (slate blue, reuse neutral-600) / #2e4256 (darker)

Accent:
  Green:    #9fc26e (brand green) / #7fa84e (untuk talent-related UI, success indicators)
  Coral:    #e59a91 (brand coral) / #d47367 (untuk notifications, important badges)
  Cream:    #f6f3ab (brand cream) / #e8e47a (untuk highlights, badges, soft emphasis)
```

Semua warna ini didefinisikan sebagai CSS variables di Tailwind config, supaya konsisten dan mudah diubah.

Contrast ratio minimal 4.5:1 untuk text (WCAG AA). Body text (#3b526a) di atas white (#FFFFFF) = ratio 5.8:1 (pass). Heading text (#1f2e3d) di atas white = ratio 12.1:1 (pass).

WCAG AA compliance notes:

- Primary #1d4a54 pada white background: ratio 8.2:1 — PASS untuk semua text sizes
- Primary #152e34 pada white background: ratio 12.5:1 — PASS, excellent contrast
- Body text #3b526a pada white: ratio 5.8:1 — PASS
- Error coral #e59a91 pada white: ratio 2.4:1 — hanya untuk large text, filled buttons, atau decorative. Gunakan #d47367 (3.8:1) atau text di atas coral bg harus putih
- Warning cream #f6f3ab: hanya untuk background/badges, BUKAN text (contrast terlalu rendah). Text di atas cream harus #152e34 atau #3b526a
- Success green #9fc26e: hanya untuk background/icons. Text di atas green bg harus #152e34
- Focus ring: gunakan primary-500 (#1d4a54) untuk outline indicator

### Typography

- Font Family: Inter (gratis, open source, bagus untuk UI, support Latin extended untuk Bahasa Indonesia)
- Fallback: Noto Sans (fallback untuk karakter yang tidak ada di Inter), system-ui, -apple-system, sans-serif
- Scale (mengikuti Tailwind default, base 16px):
  - text-xs: 12px (caption, metadata kecil)
  - text-sm: 14px (secondary text, form label)
  - text-base: 16px (body text)
  - text-lg: 18px (lead text, card title)
  - text-xl: 20px (section title)
  - text-2xl: 24px (page title)
  - text-3xl: 30px (hero heading)
- Line height: 1.5 untuk body, 1.25 untuk heading
- Font weight: 400 (regular), 500 (medium untuk label), 600 (semibold untuk heading), 700 (bold untuk emphasis)

### Spacing dan Layout

- Grid system: 8px base unit. Semua spacing kelipatan 8 (8, 16, 24, 32, 40, 48, 64)
- Container max-width: 1280px (xl breakpoint)
- Responsive breakpoints (Tailwind default):
  - sm: 640px (mobile landscape)
  - md: 768px (tablet)
  - lg: 1024px (laptop)
  - xl: 1280px (desktop)
  - 2xl: 1536px (wide screen)
- Sidebar width: 256px (desktop), collapsible di mobile
- Content area padding: 24px (mobile), 32px (desktop)
- Card padding: 16px (mobile), 24px (desktop)
- Card gap: 16px (grid gap antar card)
- Touch target minimum: 44x44px (mobile)

### Layout Pattern per Halaman

Landing Page: Full-width hero, feature cards grid, testimonial (from /api/v1/reviews/public), CTA, platform success metrics (from /api/v1/projects/stats). Public project browsing di /projects (tanpa login). Public project detail di /project-detail/:id (tanpa login, bisa lihat semua info tapi apply/submit butuh login)
Dashboard (Owner): Two-panel (sidebar + main). Summary cards di atas (active projects, pending actions, total spent, overall progress percentage), project list di bawah (grid view default + list view toggle), Gantt chart view per proyek. Owner analytics: total investment, milestone completion rate, average project duration, spending trend chart
Dashboard (Talent): Two-panel (sidebar + main). Available projects feed (grid + list toggle), active projects sidebar, time tracker widget. Proactive match notifications: "New project matching your skills"
Dashboard (Admin): Three-panel (sidebar + list + detail). Sidebar navigation, list panel (users/disputes/transactions), detail panel slide-in dari kanan. Admin frequently switches between items sehingga 3-panel mengurangi navigation cost
Project Detail: Two-panel (info kiri, actions kanan) di desktop, single column di mobile. Tabs: Overview, Milestones, Gantt, Time Log, Chat, Documents, Team, Financials (invoices per milestone). Collapsible detail panel (2.5-panel) untuk quick preview tanpa navigasi
Chat/Scoping: Full-height chat panel kiri, project summary panel kanan (desktop). Completeness progress bar (0-100) di atas chat. Full-screen chat di mobile
Form (Multi-step): Centered card layout, step indicator di atas, navigation buttons di bawah. Category-specific smart templates (e-commerce punya pre-filled options berbeda dari mobile app)
Admin Panel: Three-panel layout. Data tables, detail panels slide-in, form modals. DLQ viewer, dispute mediation tools

## Aksesibilitas (WCAG 2.1 AA)

Standar minimum yang harus dipenuhi:

Perceivable:

- Semua gambar punya alt text. Gambar dekoratif: alt=""
- Warna bukan satu-satunya cara menyampaikan informasi (selalu pakai icon atau teks juga)
- Contrast ratio minimal 4.5:1 untuk teks normal, 3:1 untuk teks besar (18px+)
- Teks bisa di-resize sampai 200% tanpa kehilangan konten (pakai rem, bukan px untuk font size)

Operable:

- Semua fungsi bisa diakses via keyboard (Tab, Enter, Space, Arrow, Escape)
- Tidak ada keyboard trap (user selalu bisa Tab keluar)
- Focus indicator yang jelas di semua elemen interaktif: focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
- Skip-to-content link sebagai elemen focusable pertama
- Saat modal dibuka: focus pindah ke elemen pertama di dalam modal. Saat ditutup: focus kembali ke trigger

Understandable:

- Bahasa dideklarasikan: html lang="id" (atau "en" sesuai user preference)
- Form label selalu visible (bukan hanya placeholder)
- Error message spesifik dan menyarankan koreksi
- Navigasi konsisten di semua halaman

Robust:

- HTML semantik (heading berurutan, landmark regions: nav, main, aside)
- ARIA labels di mana semantik native tidak cukup
- aria-live="polite" untuk konten dinamis (toast notification, chat messages)
- aria-busy="true" untuk loading states

Touch target minimum: 44x44px pada mobile untuk semua elemen interaktif.

Motion & Contrast Preferences:

- `@media (prefers-reduced-motion: reduce)`: disable semua transition, animation, dan auto-scrolling. Gantt chart: disable smooth scrolling, use instant jumps. Chat: disable typing indicator animation. Skeleton loaders: use static placeholder instead of shimmer
- `@media (prefers-contrast: more)`: increase border width (1px → 2px), increase text contrast (use neutral-900 for all body text), add visible outlines to all interactive elements, increase focus ring width
- Implementation: CSS custom properties yang di-override via media queries di `:root`

Screen Reader Optimization untuk Complex Components:

- Gantt Chart: provide `aria-label` per task bar ("Task: Backend API, 60% complete, due March 20"), `role="img"` on chart container with `aria-describedby` linking to text summary table. Alternative: hidden data table that screen readers can navigate
- Kanban Board: `role="region"` per column, `aria-label="In Progress - 3 items"`, drag-and-drop harus punya keyboard alternative (arrow keys + Enter to move between columns)
- Milestone Progress: `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`

shadcn/ui yang built on Radix UI sudah menangani keyboard navigation, focus management, dan ARIA attributes untuk komponen seperti dialog, dropdown, tabs, dll.

### Tailwind CSS v4 Design Tokens

```css
@import "tailwindcss";

@theme {
  --color-primary-50: #e8f0f1;
  --color-primary-100: #c5d8dc;
  --color-primary-200: #9ebcc3;
  --color-primary-300: #6d9ba5;
  --color-primary-400: #467a87;
  --color-primary-500: #1d4a54;
  --color-primary-600: #152e34;
  --color-primary-700: #112630;
  --color-primary-800: #0d1e28;
  --color-primary-900: #091419;

  --color-neutral-50: #f4f5f7;
  --color-neutral-100: #e8eaed;
  --color-neutral-200: #d1d5db;
  --color-neutral-300: #b0b7c3;
  --color-neutral-400: #8891a0;
  --color-neutral-500: #5e677d;
  --color-neutral-600: #3b526a;
  --color-neutral-700: #2e4256;
  --color-neutral-800: #1f2e3d;
  --color-neutral-900: #131c27;

  --color-success-500: #9fc26e;
  --color-success-600: #7fa84e;
  --color-error-500: #e59a91;
  --color-error-600: #d47367;
  --color-warning-500: #f6f3ab;
  --color-warning-600: #e8e47a;
  --color-info-500: #3b526a;
  --color-info-600: #2e4256;

  --color-accent-green-500: #9fc26e;
  --color-accent-green-600: #7fa84e;
  --color-accent-coral-500: #e59a91;
  --color-accent-coral-600: #d47367;
  --color-accent-cream-500: #f6f3ab;
  --color-accent-cream-600: #e8e47a;

  --font-sans: "Inter", "Noto Sans", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
}
```

shadcn/ui CSS variables (HSL format) didefinisikan di :root dan .dark sesuai palette di atas.

## Software Engineering Principles

### SOLID

- Single Responsibility: setiap service, setiap module, setiap function punya satu alasan untuk berubah
- Open/Closed: gunakan plugin pattern (Better Auth plugins, Hono middleware) untuk extend tanpa modify
- Liskov Substitution: interface/type yang konsisten, semua service response ikuti format yang sama
- Interface Segregation: owner frontend hanya import type yang dibutuhkan dari packages/shared
- Dependency Inversion: service layer depend pada interface (repository pattern), bukan concrete database implementation

### Clean Architecture Layers

Per microservice:

```
Route Handler (HTTP layer) -> Service (Business Logic) -> Repository (Data Access)
```

- Route handler: parse request, validate input (Zod), call service, return response
- Service: business logic murni, tidak tahu HTTP, tidak tahu database implementation
- Repository: Drizzle queries, database-specific logic

Layering ini ditegakkan mesin, bukan konvensi. `bun run arch` menjalankan
dependency-cruiser atas apps/project-service dan apps/web dengan config di
`.dependency-cruiser.cjs` masing-masing, dan CI menggagalkan build kalau ada
pelanggaran. Aturan yang berlaku sebagai error:

- Tidak ada modul yang boleh berada dalam cycle
- `repositories/` tidak boleh mengimpor `routes/`, `middleware/`, atau `services/`
- `services/` tidak boleh mengimpor `routes/` maupun `hono`
- `lib/` tidak boleh mengimpor layer di atasnya
- `routes/` tidak boleh mengimpor `@kerjacus/db` kecuali file itu terdaftar namanya di config

Daftar pengecualian route-to-db memuat tujuh belas file yang disebut satu per
satu, bukan warning selimut. Warning yang menyala sejak hari ia ditulis adalah
angkat bahu yang tidak bisa ditindaklanjuti. Daftar bernama adalah catatan
utang: menghapus satu nama berarti maju, menambah satu nama butuh alasan di PR.
`health.ts` permanen di daftar itu karena probe `SELECT 1`-nya tidak memiliki
domain data.

Catatan menjalankan alatnya: jangan pakai `npx dependency-cruiser` telanjang di
project TypeScript. Sandbox npx tidak menyediakan `typescript`, jadi alatnya
melaporkan "0 modules cruised" beserta tanda centang, yang berarti tidak ada
yang dianalisis, bukan tidak ada yang salah. Selalu baca jumlah modulnya, bukan
verdict-nya. Karena itu dependency-cruiser dipasang sebagai devDependency repo.

### Domain-Driven Design (Bounded Contexts)

Bounded contexts sesuai microservice:

- Auth Context: user identity, authentication, authorization, session
- Project Context: project lifecycle, milestones, tasks, time tracking, Gantt data
- AI Context: LLM interactions, embeddings, ML models, OCR
- Payment Context: escrow, transactions, refunds, payment gateway
- Notification Context: delivery channels (email, push, in-app)
- Admin Context: platform management, audit, analytics

Setiap context punya aggregate root dan value objects sendiri. Komunikasi antar context via events (NATS), bukan direct database access.

### 12-Factor App

1. Codebase: satu repo (monorepo), multiple deploys
2. Dependencies: eksplisit via package.json dan requirements.txt
3. Config: environment variables, tidak hardcode
4. Backing Services: database, Redis, NATS sebagai attached resources
5. Build, Release, Run: CI/CD pipeline terpisah (build -> Docker image -> deploy)
6. Processes: stateless services (session di Postgres via Better Auth, files di S3). Rate limiter sudah menghitung di Valkey, jadi window-nya dibagi lintas replika; Map in-memory tinggal jalur fallback saat store tidak terjangkau
7. Port Binding: setiap service export HTTP via port binding
8. Concurrency: horizontal scaling per service
9. Disposability: fast startup, graceful shutdown
10. Dev/Prod Parity: Docker Compose lokal mirror production
11. Logs: stdout/stderr, Pino structured JSON
12. Admin Processes: migration, seed sebagai one-off commands

### Data Architecture

OLTP Focus: Semua service databases optimized untuk transactional workloads (banyak INSERT, UPDATE, SELECT by PK/FK). Bukan untuk analytics heavy (OLAP).

Normalisasi: 3NF sebagai standar. Setiap non-key attribute depend on the key, the whole key, and nothing but the key. BCNF dicek untuk tabel yang punya multiple candidate keys. Denormalisasi hanya setelah profiling membuktikan ada performance issue.

Index Strategy:

- Primary key (UUID v7, B-tree): otomatis
- Foreign key: index semua FK column
- Status columns: index untuk filter (WHERE status = ...)
- created_at: index untuk sorting dan range queries
- Composite indexes:
  - (project_id, status): project queries by status
  - (talent_id, skill_id): talent skill lookups
  - (user_id, is_read): notification reads
  - (conversation_id, created_at): chat message pagination (critical for performance)
  - (talent_id, proficiency_level, is_primary): talent skill matching queries
  - (project_id, talent_id, status) ON project_assignments: active assignment lookups
- Partial indexes:
  - project_assignments WHERE status = 'active': only index active assignments (smaller index, faster queries)
  - outbox_events WHERE published = false: only index unpublished events for polling
  - milestones WHERE status IN ('pending', 'in_progress', 'submitted'): only active milestones
- pgvector HNSW: untuk embedding columns (cosine distance)

Database Constraints (beyond FK/PK):

CATATAN KODE: dua belas CHECK constraint sudah terpasang lewat migrasi 0029
(`money_and_range_checks`), semuanya ditambahkan `NOT VALID`. Artinya baris baru
dan baris yang di-update dicek langsung oleh database, sementara baris lama
belum divalidasi, jadi migrasi tidak mengunci tabel dan tidak bisa menggagalkan
deploy karena data lama. Untuk memvalidasi riwayat, jalankan
`ALTER TABLE <t> VALIDATE CONSTRAINT <c>` per constraint setelah SELECT
pengecekannya kosong.

Yang sudah terpasang: work_packages (amount, estimated_hours, talent_payout
dalam batas amount), milestones (amount, revision_count), projects (rentang
budget dan invariant final_price = talent_payout + platform_fee), transactions
(amount), ledger_entries (amount), reviews (rating 1 sampai 5), time_logs
(urutan started_at/ended_at dan duration_minutes).

Sebelum ini semua invariant hanya dijaga Zod di jalur HTTP, sehingga penulis
non-HTTP melewatinya: migrasi 0023 menulis ledger lewat SQL mentah, seed menulis
langsung, dan time_logs.duration_minutes diambil apa adanya dari client.

- work_packages.amount: CHECK (amount > 0) — prevent zero/negative pricing
- work_packages.estimated_hours: CHECK (estimated_hours > 0)
- milestones.amount: CHECK (amount >= 0) — allow zero for non-paid milestones
- milestones.revision_count: CHECK (revision_count >= 0)
- projects.budget_min, budget_max: CHECK (budget_min >= 0 AND budget_max >= budget_min)
- transactions.amount: CHECK (amount > 0)
- reviews.rating: CHECK (rating >= 1 AND rating <= 5)
- time_logs: CHECK (ended_at IS NULL OR ended_at > started_at)

### Arsitektur Data Lengkap

Tahap 1 (Foundation, seiring Development Fase 1): Shared PostgreSQL, satu schema `public`, pemisahan domain hanya per file schema Drizzle. Materialized views untuk dashboard metrics, di-refresh via pg_cron setiap 5 menit. CATATAN KODE: materialized view dan pg_cron belum ada — dashboard admin query langsung ke tabel dasar (lihat Analytics Domain). Views yang di-materialized: project_summary_stats (jumlah proyek per status, revenue kumulatif), worker_utilization_stats (proyek aktif per talent, rating rata-rata, distribusi tier), financial_summary (escrow balance, total payout, revenue harian/mingguan/bulanan), matching_performance (match success rate, average time-to-match)

Tahap 2 (Read Replica, seiring Development Fase 5): Read replica PostgreSQL untuk semua dashboard dan reporting queries (admin dashboard, owner progress view, talent analytics). Write ke primary, read dari replica. Connection routing via application-level logic (Drizzle multiple clients: dbWrite, dbRead). Latency replica: < 1 detik asynchronous replication

Tahap 3 (CQRS, setelah traffic signifikan): Command Query Responsibility Segregation untuk domain yang high-read. Write model (normalized 3NF) di primary database. Read model (denormalized views) di replica, dibangun dari NATS events. Contoh: project detail page baca dari denormalized read model (gabungan projects + milestones + assignments + work_packages dalam satu query), command (update status, approve milestone) tetap ke write model. Sinkronisasi: event-driven via NATS, eventual consistency (< 2 detik)

Tahap 4 (Analytics/BI, setelah data cukup): Dedicated analytics database (ClickHouse atau PostgreSQL read replica khusus analytics). ETL pipeline via pg_cron + custom scripts: extract dari operational DB, transform (aggregate, clean), load ke analytics DB. Tabel analytics: daily_project_metrics, weekly_revenue_report, worker_performance_trends, matching_effectiveness, ai_cost_analysis. Dashboard BI admin: OpenObserve dashboards connect ke analytics DB, custom charts di admin panel via Refine

### Business Intelligence (Admin)

Dashboard analytics yang dibangun bertahap:

Materialized Views (Tahap 1, refresh via pg_cron):

- mv_project_overview: total proyek per status, conversion rate (BRD -> PRD -> development), rata-rata waktu per fase
- mv_revenue_daily: revenue harian/mingguan/bulanan, breakdown per revenue stream (BRD/PRD/project margin)
- mv_worker_stats: distribusi proyek per talent, per tier, rata-rata rating, utilization rate
- mv_matching_metrics: match success rate, rata-rata waktu matching, exploration vs exploitation ratio
- mv_ai_cost: total cost per model per hari, rata-rata tokens per interaction, cost per project

Custom Analytics Queries (Tahap 2+):

- Cohort analysis: retention rate owner dan talent per bulan registrasi
- Funnel analysis: drop-off rate di setiap state machine transition
- Talent performance trends: rating trajectory, completion rate over time
- Revenue forecasting: berdasarkan proyek aktif dan pipeline
- Dispute analysis: penyebab dispute terbanyak, rata-rata resolution time, outcome distribution

Export dan Reporting:

- CSV/PDF export untuk semua dashboard data
- Scheduled reports: kirim weekly summary ke admin email (rencana — belum ada job-nya, pg-boss belum dipakai)
- Data retention: raw data sesuai retention policy, aggregate data disimpan permanen

## Aturan Penulisan Kode

### Umum

- Tulis kode yang konkret, ringkas, jelas, dan langsung ke tujuan
- Tidak bertele-tele, tidak redundan, tidak mengulang hal yang sama
- Ikuti semua best practice: SOLID, DRY, KISS, YAGNI
- Komentar maksimal 5 kata per section/function/class, hanya jika logikanya tidak self-evident
- Jangan pakai emoji atau simbol dekoratif di kode atau komentar
- Bahasa di kode dan komentar: English
- Bahasa di konten user-facing (UI text, error message): melalui i18n (t() function), tidak hardcode
- Semua user-facing string HARUS di-wrap dengan t() untuk internationalization

### TypeScript

- Strict mode always on (strict: true di tsconfig)
- Prefer type over interface, kecuali butuh declaration merging
- Jangan pakai any, pakai unknown jika tipe belum jelas lalu narrow dengan type guard
- Gunakan Zod schema sebagai single source of truth untuk validasi, lalu derive TypeScript type dengan z.infer
- Prefer named export, bukan default export
- Prefer function declaration untuk top-level, arrow function untuk callbacks
- Gunakan barrel exports (index.ts) per feature module
- Enum diganti dengan as const object + type helper
- Prefer readonly untuk array/object yang tidak boleh dimutasi
- Discriminated union untuk state management (type: "loading" | "error" | "success")

### React

- Functional component only
- Custom hook untuk logic yang reusable (prefix use)
- Pisahkan komponen besar jadi komponen kecil (single responsibility)
- Jangan prop drill lebih dari 2 level, pakai Zustand atau context
- Code splitting otomatis via TanStack Router file-based routes (autoCodeSplitting: true)
- Form pakai `useState` plus Zod untuk validasi. React Hook Form TIDAK terpasang di package.json mana pun; baris ini dulu menyuruh memakainya
- Styling lewat utility Tailwind di `className`, termasuk nilai arbitrary seperti `h-[600px]` dan `max-h-[120px]`. Yang boleh jadi CSS hanya yang tidak punya utility: `@theme` dan `@custom-variant` (itu memang konfigurasi Tailwind v4), `@keyframes` yang ditunjuk token `--animate-*`, pseudo-element scrollbar, override selimut `prefers-reduced-motion`, dan `mesh-bg` yang ::before-nya menumpuk dua radial gradient dan berbeda antara light dan dark
- Di apps/web pakai token peran untuk warna brand, bukan slot palet: `bg-brand` dan `hover:bg-brand-hover` untuk fill, `text-brand-text` untuk teks brand, `border-brand-accent` dan `bg-brand-accent/10` untuk border dan tint. `text-primary-600` dan kerabatnya masih ada di palet dan masih valid, tapi memakainya berarti warna itu tidak ikut berpindah saat tema berganti
- `style={{}}` hanya untuk nilai yang baru diketahui saat runtime: lebar progress bar, warna per talenta, background image dari SVG yang dibangkitkan. Nilai statis di `style` adalah utility yang lupa ditulis
- Data fetching selalu via TanStack Query, jangan fetch di useEffect
- Loading state: skeleton loader (bukan spinner di tengah halaman kosong)
- Error state: error boundary per section (bukan seluruh halaman crash)
- Optimistic update untuk aksi yang sering (like, apply, read notification)
- Memoization (useMemo, useCallback) hanya jika terbukti ada performance issue, bukan by default
- Semua text pakai useTranslation() hook dari react-i18next

### Hono Backend

- Setiap route group di file terpisah (auth.routes.ts, project.routes.ts, dll)
- Business logic di service layer, bukan di route handler
- Route handler hanya: parse input, panggil service, return response
- Error handling terpusat via middleware (jangan try-catch di setiap handler)
- Semua input divalidasi dengan Zod sebelum masuk service (pakai @hono/zod-validator)
- OpenAPI docs: @scalar/hono-api-reference di `/api/v1/{service}/docs` (auth-service dan project-service saja). auth-service menulis spec-nya tangan, project-service men-derive path dari `app.routes` — detail dan alasannya di bagian OpenAPI Documentation. @hono/zod-openapi belum dipakai, jadi tidak ada spec yang di-generate dari Zod schema
- Response format konsisten: { success: boolean, data?: T, error?: { code: string, message: string } }
- Pagination format: { items: T[], total: number, page: number, pageSize: number }
- Batas pagination hanya ditulis di satu tempat, `MAX_PAGE` dan `MAX_PAGE_SIZE` di packages/shared/src/schemas.ts, dan sepuluh call site di routes meng-`extend` atau memakai langsung `paginationSchema` alih-alih menyatakannya ulang. Offset adalah hasil kali page dan pageSize, jadi meng-cap pageSize saja meninggalkan offset tanpa batas: satu `?page=100000000` membuat Postgres menelusuri sebanyak itu entri index untuk mengembalikan array kosong. Lima route dulu melewati Zod dan membaca query string lewat `Number()` telanjang, yang menaruh LIMIT pilihan penyerang langsung ke SQL dan mengubah `?page=abc` menjadi OFFSET NaN. Salah satunya, GET /projects/public, tidak butuh session sama sekali, jadi `?pageSize=1000000` mengembalikan seluruh tabel yang bisa dijelajahi ke pemanggil anonim
- Keyset pagination dipertimbangkan dan ditolak: kedua jalur paging-dalam sudah dilayani index (`idx_projects_browse`, `idx_chat_messages_conv_created`), jadi yang mahal bukan offset-nya melainkan input tanpa batas. Keyset juga mengubah response shape semua list endpoint dan menghapus lompat-ke-halaman yang dipakai tabel admin. `pagination-bounds.test.ts` menggagalkan salinan berikutnya
- Rate limiting: 100 req/menit untuk endpoint biasa, 10 req/menit untuk AI-intensive
- API versioning: URL-based `/api/v1/{service}/...` (misal: /api/v1/projects, /api/v1/auth, /api/v1/payments)
- Correlation ID: setiap request generate/propagate `X-Request-ID` header, include di log dan downstream calls

### Database dan Drizzle

- UUID v7 sebagai primary key via uuidv7 library (BUKAN crypto.randomUUID())
- Timestamp pakai timestamptz, disimpan UTC, convert di frontend
- Soft delete (deleted_at column) untuk data penting
- Index pada: foreign key, status, created_at, composite index untuk query yang sering
- Migration selalu via drizzle-kit generate lalu drizzle-kit migrate, jangan alter database manual
- Schema split per domain (auth.schema.ts, projects.schema.ts, payments.schema.ts) di packages/db
- Query builder untuk complex queries, .query API untuk simple relations
- Transaction (db.transaction) untuk operasi yang harus atomic (payment, status change)

### AI Integration

- Chatbot streaming: AI service (Python FastAPI) memakai Z.ai chat completions stream=true + Server-Sent Events; project-service (Hono) mem-proxy; frontend membaca SSE via fetch (bukan Vercel AI SDK)
- Structured output: GLM tidak punya response_schema, hanya response_format json_object. Schema dikirim di system prompt lalu divalidasi Pydantic di generate_structured; validasi/normalisasi tambahan di TypeScript. generateObject()/AI SDK belum dipakai
- Catatan: zodResponseFormat sudah deprecated, JANGAN gunakan
- LLM calls ke OpenRouter (`openrouter.ai/api/v1/chat/completions`) lewat httpx dengan Bearer key, tanpa SDK vendor. Embedding lewat `/embeddings` di base URL yang sama dan key yang sama
- Retry: 3 kali dengan exponential backoff + jitter (base 1s, factor 2x, max 8s, jitter ±500ms random) untuk API call yang gagal. Jitter mencegah thundering herd saat service recover
- Circuit breaker (Cockatiel): composable resilience — retry + circuit breaker + timeout + bulkhead in single wrap(). Config: threshold 5 failures, resetTimeout 30s, halfOpenMax 3, return fallback error ke user
- Cache: rencana simpan hash(prompt + parameters) -> response di Valkey, TTL 1 jam untuk estimasi harga. BELUM diimplementasikan — tidak ada cache AI response di mana pun
- Timeout: 30 detik untuk chatbot response, 60 detik untuk BRD/PRD generation
- Log: semua AI interaction disimpan di ai_interactions table (prompt tokens, completion tokens, model, latency, cost) + OTLP traces ke OpenObserve
- Cost control: set max_tokens per request, kunci reasoning_effort ke low, monitor lewat agregasi ai_interactions

### Security

- Input sanitization di semua user-facing endpoint (DOMPurify untuk HTML content)
- Rate limiting per IP (middleware sendiri di src/middleware/rate-limit.ts, auth-service dan project-service), dihitung di Valkey lewat client bawaan Bun sehingga window-nya dibagi lintas replika. Fallback ke Map in-memory per proses saat store tidak terjangkau

CATATAN KODE: kunci limiter-nya pernah salah dan itu memutus login di produksi.
`clientIp` membaca `X-Real-IP`, sementara request melewati tiga proxy
(Cloudflare, proxy Dokploy, lalu gateway service) dan setiap hop menulis ulang
header itu dari `$remote_addr` miliknya sendiri. Terukur di sistem yang sedang
berjalan: auth-service menerima 10.0.1.224, 10.0.1.65, dan 10.0.1.67 — semuanya
alamat container. Jadi batas ketat sepuluh request per menit dibagi oleh
seluruh pengunjung, dan trafik normal menghabiskannya sebelum ada yang sampai
ke form login.

Pemilihan kunci sekarang ada di `packages/shared/src/client-ip.ts`, satu tempat
untuk kedua service karena keduanya dulu punya salinan sendiri dan salinannya
sudah menyimpang. Urutannya `CF-Connecting-IP` dulu (ditulis sekali di edge
Cloudflare dan tidak ditimpa hop berikutnya), lalu `X-Real-IP`, lalu hop paling
kanan `X-Forwarded-For`. Alamat privat DITOLAK di setiap kandidat: nilai
loopback atau RFC 1918 berarti header itu menggambarkan proxy, bukan pemanggil,
dan memakainya menggabungkan pemanggil yang tidak berhubungan. Kalau tidak ada
kandidat yang tersisa, request tetap dihitung di bawah kunci penanda DAN
dicatat sekali per menit, supaya salah konfigurasi terlihat alih-alih diam-diam
mengunci semua orang.

Mempercayai `CF-Connecting-IP` hanya sahih selama Cloudflare satu-satunya
ingress. Request yang mendarat langsung di origin bisa mengarang header itu,
jadi firewall origin wajib menolak apa pun yang bukan Cloudflare. Itu setelan
infrastruktur, bukan sesuatu yang bisa ditegakkan kode.

Batas ketat juga dipersempit. Dulu ia menutup seluruh `/api/v1/auth/*`, yang
ikut menyapu `get-session`. Frontend memanggil itu di setiap page load, jadi
jatah sepuluh per menit habis untuk pengecekan sesi. Sekarang hanya jalur
kredensial (`CREDENTIAL_PATHS` di index.ts).
- CORS hanya untuk domain yang diizinkan (frontend domain saja)
- CSRF protection via SameSite cookie + Origin header check
- File upload: presigned URL pattern (browser upload langsung ke R2/MinIO, bypass backend). Validasi MIME type via magic bytes (bukan hanya extension), max 5MB untuk CV, max 10MB untuk attachment. Generate random filename (UUID) untuk mencegah path traversal. Backend hanya generate signed URL dengan expiry dan validasi metadata setelah upload complete
- Password hashing: scrypt (via Better Auth, default built-in — node:crypto scrypt)
- Auth: session-based via Better Auth, session token di httpOnly + Secure + SameSite=Lax cookie
- Google OAuth: via Better Auth socialProviders.google (clientId + clientSecret dari Google Cloud Console)
- Semua environment variable di .env, tidak boleh hardcode secrets
- SQL injection prevention otomatis via Drizzle ORM parameterized queries
- XSS prevention: React auto-escapes by default, jangan pakai dangerouslySetInnerHTML
- Payment idempotency: setiap transaksi punya idempotency_key, cek sebelum process
- Inter-service communication: internal network only (Docker network), tidak exposed ke public

### Error Handling Pattern

Backend error hierarchy:

```
AppError (base)
  ValidationError (400) - input tidak valid
  AuthError (401) - belum login
  ForbiddenError (403) - tidak punya akses
  NotFoundError (404) - resource tidak ditemukan
  ConflictError (409) - duplikat atau state conflict
  RateLimitError (429) - terlalu banyak request
  ExternalServiceError (502) - AI service/payment gateway error
  InternalError (500) - unexpected error
```

Error middleware menangkap semua error, log detail ke console, return format konsisten ke owner.

Untuk external service (AI, payment gateway):

- Retry dengan exponential backoff
- Circuit breaker jika service down terus-menerus
- Fallback message ke user: "Sedang ada gangguan, coba lagi dalam beberapa menit" (via i18n)
- Jangan expose error detail dari external service ke user

## Alur Development

### Urutan Pengerjaan

Fase 1: Foundation

- Init monorepo (Turborepo + Bun workspaces)
- Setup Docker Compose (PostgreSQL 17 + PgBouncer + Valkey 9 + NATS + MinIO + OpenObserve + Traefik + Centrifugo + Temporal + Uptime Kuma)
- Setup packages/shared (Zod schemas, types, constants, error codes)
- Setup packages/db (Drizzle schema semua domain, migrations, seed, pgvector extension, materialized views)
- Setup packages/nats-events (event type definitions, outbox utilities)
- Setup packages/logger (Pino config, correlation ID middleware)
- Setup packages/config (Zod env validation per service)
- Setup Biome, Lefthook
- Setup GitHub Actions CI/CD (lint, test, build via Turborepo change detection)
- Setup Docker multi-stage builds per service
- Setup frontend (Vite 8 + React 19 + TanStack Router + Tailwind v4 + komponen UI hand-rolled + react-i18next + fetch wrapper di lib/api.ts)
- Setup Auth Service (Hono + Better Auth: email+password, Google OAuth, session, RBAC)
- Setup API Gateway (Traefik config + Docker labels)
- Setup XState v5 state machine definitions (project lifecycle, milestone status)
- Setup Temporal workflows (milestone approval, team formation, dispute resolution, auto-release)
- Setup Centrifugo (WebSocket channels, authentication, presence)
- Base layout: sidebar, header, responsive shell, language switcher

Fase 2: Core Owner Flow

- Landing page (public, multi-language, platform success metrics section)
- Form pengajuan proyek (multi-step wizard)
- AI chatbot follow-up (streaming SSE dari Z.ai, di-proxy project-service)
- BRD generation (structured output, preview UI)
- Owner review, revisi via chat, approval BRD
- Payment untuk BRD (integrasi Midtrans/Xendit via Payment Service)

Fase 3: Core Talent Flow

- Registrasi talent (multi-step form, CV upload)
- CV parser (ekstraksi teks pypdfium2/python-docx/python-pptx + glm-5.3 structured extraction, sinkron di request) — satu-satunya vetting stage
- Talent profile page (anonymous public view untuk owner, full private view untuk talent sendiri)
- Dashboard talent: listing proyek yang sesuai skill (semua proyek terlihat, tidak difilter per tier)
- Apply ke proyek
- Notification system (in-app + email via Resend, Notification Service)

Fase 4: Matching, Assignment, dan Project Management

- Algoritma rekomendasi talent (weighted scoring, rule-based dulu)
- PRD generation (termasuk AI team composition dan work package decomposition)
- Work package management (create from PRD, per-talent assignment)
- Pencocokan owner-talent (anonymous profil, platform-mediated, epsilon-greedy pemerataan)
- Multi-talent team formation flow (TEAM_FORMING state, per-position matching)
- Kontrak digital per talent dan escrow setup per work package
- Milestone breakdown per talent dan integration milestones
- Gantt chart (@svar-ui/react-gantt, task dependencies, multi-talent swimlane view)
- Time tracking (timer, manual entry, per talent)

Fase 5: Project Execution, Admin, dan BI

- Project tracking dashboard (milestone progress per talent, aggregate view, Gantt view)
- Owner progress dashboard (investment summary, milestone completion rate, spending trend)
- Project health scoring (auto-calculated, admin alerts)
- Team coordination: group chat, inter-talent chat, dependency alerts
- Milestone submission dan approval (per talent, integration milestones)
- Structured deliverable management (checklist per milestone dari PRD)
- Pencairan dana per milestone per talent
- Auto-generated invoices per milestone (@react-pdf/renderer PDF generation, invoice history dashboard, export CSV/PDF)
- Partial cancellation dan talent replacement flow
- Review dan rating internal (dua arah, per talent untuk team project, internal only)
- Project completion flow (team: semua talent harus selesai)
- Admin panel (Refine: dashboard BI, user management, project management, team management, finance, dispute, DLQ viewer)
- Materialized views untuk dashboard analytics (pg_cron refresh setiap 5 menit)
- Read replica setup untuk dashboard dan reporting queries
- RAG pipeline (embed BRD/PRD, hybrid search BM25 + vector + cross-encoder reranking, improve chatbot context)
- Notification event catalog implementation (semua events terdefinisi di atas)
- Data export: CSV/PDF untuk dashboard, scheduled weekly report ke admin email

Fase 6: ML Enhancement dan Advanced Analytics

- Collect training data dari completed projects
- Fine-tune model chatbot scoping (base saat ini glm-5.3)
- Train CatBoost model untuk talent-project matching (LightGBM sebagai benchmark comparison)
- A/B test rule-based vs ML matching
- Full CQRS implementation (denormalized read model dari NATS events)
- Dedicated analytics database (ClickHouse atau PG replica khusus)
- ETL pipeline untuk advanced analytics
- Continuous improvement loop

### Cara Menjalankan

```bash
# Install dependencies
bun install

# Start local services
docker compose up -d  # PostgreSQL 17 + PgBouncer + Valkey 9 + NATS + MinIO + Traefik + Centrifugo + Temporal. OpenObserve (--profile observability) dan Uptime Kuma (--profile monitoring) opt-in

# Setup database
bun run db:generate   # generate migrations dari schema
bun run db:migrate    # apply migrations
bun run db:seed       # seed data untuk development

# Development (semua service bersamaan via Turborepo)
bun run dev

# Atau jalankan terpisah
bun run dev:web              # frontend di port 5173
bun run dev:auth-service     # auth service di port 3001
bun run dev:project-service  # project service di port 3002
bun run dev:ai-service       # AI service di port 3003 (Python)
bun run dev:payment-service  # payment service di port 3004
bun run dev:notification-service  # notification service di port 3005
bun run dev:admin-service    # admin service di port 3006

# Build
bun run build

# Test
bun run test          # unit + integration + BDD (Vitest)

# Lint dan format
bun run check         # biome check (lint + format)
bun run check:fix     # biome check --write (auto fix)

# Database
bun run db:generate   # generate migration dari perubahan schema
bun run db:migrate    # apply pending migrations
bun run db:studio     # buka Drizzle Studio (database GUI)
```

### Environment Variables

```
# Database (via PgBouncer)
DATABASE_URL=postgresql://bytz:bytz@localhost:6432/bytz
DATABASE_DIRECT_URL=postgresql://bytz:bytz@localhost:5432/bytz  # direct connection for migrations

# Redis
REDIS_URL=redis://localhost:6379

# NATS
NATS_URL=nats://localhost:4222

# Auth
BETTER_AUTH_SECRET=random-secret-min-32-chars
BETTER_AUTH_URL=http://localhost:3001

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# AI. Satu key untuk chat dan embedding, keduanya lewat OpenRouter.
# Inferensi z-ai/glm-5.3, embedding voyageai/voyage-4-large pada 1024 dimensi.
# GLM-5.3 selalu bernalar dan OpenRouter membacanya lewat reasoning.effort,
# yang service kunci ke low karena default-nya memakan budget output.
# Provider dinyatakan di PROVIDER_ORDER (llm.py), bukan diserahkan ke default:
# tanpa itu first-token P95 terukur 11,65 detik lawan 1,83 detik saat dipin.
OPENROUTER_API_KEY=

# Observability (OpenObserve)
# Password policy: 8-128 chars with upper, lower, digit and symbol, or the
# container panics at startup rather than warning.
OPENOBSERVE_USER=root@kerjacus.id
OPENOBSERVE_PASSWORD=KerjaCus#Dev1
# base64("user:password") - services send it as Authorization: Basic <token>.
# Our OTel exporters are HTTP, so the endpoint is :5080/api/{org}, NOT :5081.
OPENOBSERVE_OTLP_TOKEN=
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:5080/api/default
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf

# Storage
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=kerjacus-uploads

# Payment (Midtrans sandbox)
MIDTRANS_SERVER_KEY=SB-Mid-server-...
MIDTRANS_CLIENT_KEY=SB-Mid-owner-...

# Email
RESEND_API_KEY=re_...

OPENOBSERVE_URL=http://localhost:5080

# Real-time Transport
CENTRIFUGO_URL=http://localhost:8000
CENTRIFUGO_API_KEY=centrifugo-api-key
CENTRIFUGO_SECRET=centrifugo-secret

# Workflow Orchestration
TEMPORAL_URL=localhost:7233
TEMPORAL_NAMESPACE=bytz

# Secret Management (production only, dev uses .env)
INFISICAL_TOKEN=st.xxx
INFISICAL_SITE_URL=http://localhost:8070

# Frontend
VITE_API_URL=http://localhost:80
VITE_APP_URL=http://localhost:5173
```

## Catatan Penting

### Bahasa Platform

- UI dan konten user-facing: multi-language via i18n (Bahasa Indonesia default, English tersedia)
- Kode, komentar, variable, function name: English
- Error message ke user: melalui i18n
- Log dan debug message: English
- API response error code: English (snake_case), message: melalui i18n

### Naming Convention

- NATS event subjects: dot-separated lower_case (misal: `milestone.submitted`, `payment.released`)
- Notification template keys: dot-separated with underscore for compound words, prefix `notification.` (misal: `notification.milestone_submitted`). Mapping: NATS subject `milestone.submitted` → template key `notification.milestone_submitted`
- Database enums: lower_case (misal: `brd_generated`, `in_progress`)
- State machine diagrams: UPPER_CASE untuk readability (misal: `BRD_GENERATED`), tapi database stores lower_case
- Error codes: UPPER_CASE with underscore separator (misal: `PROJECT_VALIDATION_INVALID_STATUS`)

### Fitur di Luar Scope Saat Ini

- Subscription atau maintenance bulanan
- Bidang non-digital (sipil, geodesi, geologi, planologi) - arsitektur sudah disiapkan
- Video call atau voice call built-in (in-app video conferencing)
- Mobile app native (web responsive dulu)
- Multi-currency (Rupiah saja)
- Custom ML model training from scratch (fine-tune existing model dulu)
- SSO enterprise (SAML/OIDC) - Google OAuth sudah cukup
- Organization/team accounts untuk B2B clients
- KTP/identity verification untuk talent (e-KTP OCR verification)
- Consolidated monthly invoicing untuk enterprise clients
- Owner qualification/onboarding questionnaire (budget readiness, technical literacy)
- Talent portfolio showcase (visual gallery, live demo links)
- Transparent pricing calculator (public-facing estimation tool sebelum signup)
- Geographic/timezone intelligence (match talent berdasarkan timezone overlap)
(Dark mode sempat terdaftar di sini, tapi sudah terpasang dan hidup di apps/web. Lihat Dark Mode Architecture, termasuk bagian yang belum benar.)

### Software Architecture Decisions

Microservice Architecture: Backend didesain sebagai microservices terpisah dengan bounded context yang jelas. Semua service dijalankan di Docker Compose. Setiap service adalah Hono app independen (kecuali AI Service yang pakai FastAPI/Python). Komunikasi async via NATS, sync via REST melalui Traefik API Gateway.

Kenapa microservice sejak awal: platform perlu extensible ke domain engineering lain di masa depan. Penambahan domain baru (misal: Civil Engineering Service) hanya perlu service baru tanpa mengubah service existing. Juga memungkinkan scaling independen per service (AI Service bisa di-scale terpisah karena resource-intensive).

Clean Architecture layers per service: Route -> Service -> Repository (Drizzle). Route handler tidak boleh langsung query database. Service tidak boleh tahu tentang HTTP request/response.

Event-driven: NATS sebagai message broker untuk decouple operasi antar service. Setiap state change yang relevan di-publish sebagai event.

Saga Pattern: untuk transaksi yang span multiple services (payment -> project status -> notification), menggunakan choreography-based saga via NATS events.

CQRS: Diimplementasikan bertahap. Tahap 1 pakai materialized views untuk dashboard metrics (refresh via pg_cron). Tahap 2 tambahkan read replica untuk read-heavy queries (dashboard, analytics, reporting). Tahap 3 full CQRS dengan denormalized read model dari NATS events. Detail lengkap di bagian Arsitektur Data Lengkap.

## Project Health Scoring

Setiap proyek aktif punya health score (0-100) yang dihitung otomatis. Ditampilkan di admin dashboard dan owner project detail.

### Komponen Health Score

```
health_score = (timeline_score * 0.35) + (milestone_score * 0.30) + (communication_score * 0.20) + (budget_score * 0.15)
```

- **timeline_score** (0-100): berdasarkan perbandingan actual progress vs planned progress di Gantt chart. 100 = on track atau ahead, 0 = sangat terlambat
- **milestone_score** (0-100): persentase milestones yang approved on time. Revision requests dan rejected milestones menurunkan skor
- **communication_score** (0-100): berdasarkan response time rata-rata di chat (talent dan owner). 100 = < 4 jam, 0 = > 72 jam tanpa respons
- **budget_score** (0-100): berdasarkan actual spending vs budget. 100 = on budget, turun jika ada banyak revision fees atau change requests

### Health Status

- 80-100: Healthy (hijau)
- 60-79: At Risk (kuning) — admin gets notification
- 40-59: Critical (oranye) — admin must intervene
- 0-39: Emergency (merah) — admin + owner notified, proyek mungkin perlu di-pause

Team project: health score dihitung per talent (per work package) DAN aggregate. Jika satu talent critical tapi yang lain healthy, overall score turun tapi tidak sepenuhnya red.

## Notification Event Catalog

Setiap notification type memiliki: trigger event, recipients, channel (in-app, email, atau both), dan template.

### Owner Notifications

| Event                            | Channel        | Template Key                         |
| -------------------------------- | -------------- | ------------------------------------ |
| BRD ready for review             | email + in-app | notification.brd_ready               |
| PRD ready for review             | email + in-app | notification.prd_ready               |
| Talent recommended (matching)    | in-app         | notification.worker_matched          |
| Team formation complete          | email + in-app | notification.team_complete           |
| Milestone submitted              | email + in-app | notification.milestone_submitted     |
| Milestone auto-released (14 day) | email + in-app | notification.milestone_auto_released |
| Talent overdue                   | in-app         | notification.worker_overdue          |
| Project completed                | email + in-app | notification.project_completed       |
| Dispute update                   | email + in-app | notification.dispute_update          |
| Payment confirmed                | email          | notification.payment_confirmed       |
| Refund processed                 | email          | notification.refund_processed        |

### Talent Notifications

| Event                           | Channel        | Template Key                    |
| ------------------------------- | -------------- | ------------------------------- |
| New project match (skill-based) | in-app         | notification.new_project_match  |
| Assignment offer (team project) | email + in-app | notification.assignment_offer   |
| Milestone approved              | in-app         | notification.milestone_approved |
| Milestone rejected              | email + in-app | notification.milestone_rejected |
| Revision requested              | email + in-app | notification.revision_requested |
| Payment released                | email          | notification.payment_released   |
| Overdue warning (3 days before) | in-app         | notification.overdue_warning    |
| Dependency blocked              | in-app         | notification.dependency_blocked |
| Review received                 | in-app         | notification.review_received    |

### Admin Notifications

| Event                      | Channel | Template Key                          |
| -------------------------- | ------- | ------------------------------------- |
| New dispute                | in-app  | notification.admin_new_dispute        |
| Project health critical    | in-app  | notification.admin_health_critical    |
| Talent inactive 7 days     | in-app  | notification.admin_worker_inactive    |
| DLQ event failed           | in-app  | notification.admin_dlq_failed         |
| High-value project created | in-app  | notification.admin_high_value_project |

## Structured Deliverable Management

Setiap milestone submission memiliki deliverable checklist yang didefinisikan di PRD:

- PRD AI generate daftar expected deliverables per milestone (misal: "API endpoint documentation", "Unit test coverage > 80%", "Figma design file")
- Talent harus checklist setiap deliverable saat submit milestone
- Owner review berdasarkan checklist (bisa approve partial — "desain OK tapi dokumentasi kurang")
- Deliverable types: code (Git repo/branch), document (PDF/Figma/Google Docs link), file (uploaded artifact), demo (URL)
- File attachments via milestone_files table (sudah ada)
- Deliverable metadata disimpan di milestones.metadata (JSONB): `{ deliverables: [{ title, type, expected, submitted_url, status }] }`

## Performance Requirements

### Response Time Targets

- Page load (initial): < 2 detik (P95)
- API response (CRUD): < 200ms (P95)
- API response (with DB query): < 500ms (P95)
- AI chatbot first token: < 1 detik (P95). TERUKUR DAN TIDAK TERPENUHI, tapi
  angkanya sudah membaik dan sekarang bergantung pada provider mana yang
  melayani. Diukur lagi atas 36 sampel yang diselang-seling: langsung ke Z.ai
  median 1,45s dan P95 3,29s; lewat OpenRouter tanpa preferensi provider
  median 1,55s dan P95 11,65s, karena tiga provider melayani model yang sama
  dan yang paling lambat menentukan ekornya. Dipin ke BaseTen dengan fallback
  dimatikan: median 1,53s, P95 1,83s, maks 1,93s, tanpa satu pun error atas 12
  sampel. Itu konfigurasi yang dipakai sekarang (`PROVIDER_ORDER`, fallback
  tetap hidup), jadi P95 turun dari 3,29s ke sekitar 1,83s.
  Anggaran 1 detik tetap tidak terpenuhi dan penyebabnya tetap struktural,
  bukan tuning: GLM-5.3 selalu bernalar dan penalaran itu tidak ikut di-stream,
  jadi pengguna tidak melihat apa pun sampai fase itu selesai. Effort sudah
  dikunci ke `low`, dan glm-5.3-flash pernah diukur pada sampel yang sama tanpa
  perbaikan berarti. Pilihannya menerima angka ini atau mengubah UX supaya
  penantian itu terlihat; menaikkan anggaran diam-diam bukan jawaban
- AI BRD/PRD generation: < 60 detik (streaming dimulai < 3 detik). Terukur 34,1s
  untuk BRD penuh dengan prompt produksi (16384 max_tokens, 2597 token keluar,
  12 field wajib lengkap), jadi ada margin tapi bukan margin besar
- Search (talent matching): < 500ms (P95)
- File upload (CV, 5MB): < 5 detik
- WebSocket message delivery: < 100ms

### Throughput Targets

- Concurrent users: 500
- API requests: 1000 req/menit
- WebSocket connections: 200 concurrent
- AI requests: 50 req/menit (bottleneck: OpenAI rate limits)
- Background jobs: 100 jobs/menit (target; saat ini outbox worker in-process, batch 100 per detik)

### SLI/SLO Definitions (Production)

- Availability: 99.5% uptime (allows ~3.6 hours downtime/month)
- Error rate: < 1% of requests return 5xx
- Latency P95: < 500ms for API, < 2s for page load
- AI service availability: 99% (depends on upstream OpenAI)
- Payment processing: 99.9% success rate

SLI Monitoring (Prometheus metrics via OpenTelemetry export):

```
# Availability SLI
sum(rate(http_requests_total{status!~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Latency SLI (P95)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))

# Error Rate SLI
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
```

Alerting Rules:

- Error rate > 1% for 5 minutes → warning (Slack/email notification)
- Error rate > 5% for 2 minutes → critical (PagerDuty/immediate action)
- P95 latency > 1s for 10 minutes → warning
- Service down (health check fail) for 1 minute → critical
- DLQ events > 10 in 1 hour → warning (events failing to process)

## Testing Strategy

### Unit Tests (Vitest)

- Coverage target: 100% di semua workspace. Sebelumnya 80% untuk business logic; dinaikkan atas keputusan owner. Yang TIDAK berubah: baris yang dieksekusi tanpa assertion lebih buruk daripada baris yang tidak tercakup, karena ia menaikkan angka sambil menghapus sinyal. Setiap test harus bisa gagal karena alasan nyata, dan cara membuktikannya adalah merusak implementasinya lalu melihat test itu merah
- Baris yang benar-benar tidak terjangkau (cabang defensif atas state yang mustahil) ditandai `/* v8 ignore next */` atau `# pragma: no cover` beserta alasannya, bukan dipaksa dijangkau lewat test yang berkontorsi. Pragma tanpa alasan tertulis sama saja menyembunyikan cabang
- Focus: service layer functions, utility functions, Zod schema validation, state machine transitions
- Mock: external services (AI, payment gateway, NATS). JANGAN mem-mock database — itu yang dulu mendorong separuh suite project-service menjadi assertion atas teks sumber
- Naming: `{module}.test.ts` bersebelahan dengan file sumber; integration memakai `{module}.integration.test.ts`

### Pengukuran coverage

- Definisi coverage ada di `vitest.shared.ts`, dan tiap workspace menyebut sendiri apa yang diinstrumentasi lewat `vitest.config.ts` (atau blok `test` di `vite.config.ts` untuk web dan admin, yang sudah punya plugin dan alias sendiri sehingga config terpisah akan menutupinya)
- `include` HARUS array dengan satu entri per ekstensi. Bentuk brace `src/**/*.{ts,tsx}` nyaris tidak cocok apa pun lewat glob vitest dan melaporkan segelintir statement di sebelah persentase sehat, yaitu kegagalan yang menyamar sebagai kelulusan
- Threshold adalah baseline terukur, jadi ia menjaga regresi hari ini dan dinaikkan seiring test masuk. Jangan pernah menurunkan threshold
- Catatan pengukuran frontend: v8 hanya bisa menghitung statement pada file yang ditransformasi. Komponen yang tidak pernah diimpor test melaporkan nol statement, bukan nol persen, jadi ia tidak terukur alih-alih tidak tercakup. Ini SUDAH diselesaikan untuk apps/web: denominatornya kini 3185 statement, yaitu seluruh app, setelah 24 file yang dulu melaporkan nol benar-benar dieksekusi test. Yang menggerakkan angka frontend hanya satu hal, yaitu menjalankan filenya; tiga perbaikan config di bawah cuma menghentikan pengukuran berbohong soal file mana yang ada, dan tidak menutup satu baris pun
- Setiap file route punya plafon yang tidak bisa dilewati: plugin router (`route-hmr-statement.js`) menempelkan blok `import.meta.hot` TANPA syarat, jadi ia mendarat di web maupun admin. Biayanya persis satu statement, satu function, dan dua branch per file: 35 file route di web (70 branch, 35 function) dan 11 di admin. Cara membedakannya dari branch asli: item HMR selalu mulai di kolom <= 2 karena ia statement top-level yang ditempelkan. 100% per file route mustahil dan threshold 100% akan gagal di hari pertama; menghapusnya adalah opsi plugin atau exclusion coverage, bukan sesuatu yang bisa dicapai test
- Threshold HARUS lolos di kondisi terbebani, bukan di mesin yang sepi, karena CI menjalankan sepuluh workspace sekaligus lewat turbo. Yang stabil hanya BRANCH: identik di tujuh belas run pada kedua frontend, sepi maupun sengaja dibebani. Statement, function, dan lines semuanya bergeser, karena `autoCodeSplitting` menghasilkan dua modul per file route yang memetakan balik ke satu path, dan bagian mana yang dimuat sebuah worker menentukan bagaimana merge-nya mengatribusikan. Bukti paling jelas: `__root.tsx` melaporkan function HMR-nya di baris 40 pada satu run dan baris 123 pada run lain, di file 40 baris. Jadi branch boleh digate ketat; tiga dimensi lain diberi kelonggaran satu poin penuh
- Setiap test yang menyentuh retry, upload, stream, atau me-mount router butuh `testTimeout` eksplisit. Default vitest 5000ms sudah menyebabkan tiga kegagalan berbeda di repo ini: satu test scheduler yang backoff-nya sendiri menghabiskan 3000ms lalu terbaca seperti race selama berjam-jam, test project-service yang melewati serviceFetch, dan `apps/admin/src/main.test.ts` yang diam-diam timeout lalu MEMBAWA SERTA coverage filenya sehingga angka admin naik-turun. Konvensinya `vi.setConfig({ testTimeout: 30_000 })`, dipakai 31 file
- apps/web mematikan `autoCodeSplitting` di bawah vitest (`!process.env.VITEST`). Splitter memindahkan tiap route component ke virtual module `?tsr-split=component` yang hanya dilihat v8 kalau ada test yang memuatnya, jadi route tanpa test melaporkan total:0 covered:0 dan mendapat skor 100% sambil tidak menyumbang apa pun ke rasio: `scoping.tsx` 565 baris terbaca tercakup penuh, dan 23 dari 35 file route ada di keadaan itu. Splitter juga menempelkan blok `import.meta.hot` yang selalu undefined di bawah `vitest run`, yaitu satu function dan dua branch yang permanen tidak tercakup per file. Produksi tetap di-split; yang berubah hanya pengukurannya
- apps/admin TETAP di-split. Mematikannya cuma menambah delapan statement dan denominatornya hanya 41 baris lebih besar (`__root.tsx`), jadi angkanya memang sudah bisa dipercaya. Dulu alasan utamanya lain: mematikannya menggagalkan 240 test, karena sepuluh file test memanggil `preload()` pada `Route.options.component` dan tanpa splitter tidak ada wrapper yang punya method itu. Penghalang itu sudah hilang — `apps/admin/src/lib/testing/harness.tsx` memanggilnya opsional, jadi test-nya jalan di kedua mode. Yang tersisa tinggal untung-ruginya, dan untungnya kecil
- Dua run vitest bersamaan di workspace yang sama saling menghapus agregasi coverage-nya: `.tmp` hidup di dalam `coverage.reportsDirectory`, dan yang gagal adalah tahap merge terakhir, bukan test-nya. Errornya menyebut sendiri ("Something removed the coverage directory"), tapi terbaca seperti suite rusak. Jalan keluarnya flag per-run, BUKAN config: `--coverage.reportsDirectory=/tmp/<unik>`. Jangan menaruhnya di config, karena CI mengunggah artefak dari `apps/*/coverage/`

### Integration Tests (Vitest)

- Harness ada di `packages/db/src/testing.ts`, diekspor sebagai `@kerjacus/db/testing`. `connectTestDatabase()` menjalankan migrasi lalu mengembalikan `{db, truncate, close}`; `hasTestDatabase()` dipakai untuk melewati suite saat database tidak tersedia
- Harness MENOLAK database yang namanya tidak berakhiran `_test`, dicek sebelum statement pertama, karena ia men-truncate semua tabel dan database dev biasanya ada di server yang sama
- Dijalankan lewat `TEST_DATABASE_URL`. CI sudah menyediakan pgvector Postgres untuk job test sejak awal dan tidak ada satu pun test yang menyambung ke sana — itulah sebabnya test repository dan transaksi ditulis sebagai regex atas teks sumber
- Turborepo tidak meneruskan environment variable yang tidak dideklarasikan task, jadi `TEST_DATABASE_URL` ada di `turbo.json` pada task `test` dan `test:coverage`. Tanpa itu suite-nya di-skip sambil melaporkan sukses
- Lokal: `bun run db:test:setup` sekali, lalu `bun run test:integration`
- Test NATS event publishing dan consuming
- Test API endpoints end-to-end per service (HTTP request lalu response)

### BDD dan ATDD (Vitest, pytest-bdd, godog)

Skenario Gherkin ditulis sebagai file `.feature` dan dieksekusi, bukan dibaca manusia saja. Dua belas file, satu runner per bahasa:

- TypeScript: `.feature` berpasangan dengan `.spec.ts` yang berisi step definition, dijalankan Vitest bersama unit test — `apps/project-service/src/features/` (project-lifecycle, milestone-management), `apps/auth-service/src/features/`
- Python: `apps/ai-service/tests/features/` (cv_parsing, ai_endpoints, ai_chat) lewat pytest-bdd
- Go: `apps/{payment,notification,admin}-service/features/` lewat godog

Skenario menulis aturan bisnis dalam kalimat yang bisa diverifikasi pemangku kepentingan non-teknis (ATDD), sementara step definition-nya menegakkan aturan itu terhadap kode nyata.

### E2E Tests

Tidak ada, dan bukan karena terlewat. Playwright pernah terpasang sebagai devDependency (`@playwright/test`, `playwright-bdd`) dengan skrip `test:e2e` di apps/web dan task di turbo.json, tapi tanpa satu pun file test, tanpa `playwright.config.*`, dan tanpa satu pun import di seluruh repo. Menjalankannya crash dengan `Error: Unexpected module status 3` — playwright tidak punya apa pun untuk dieksekusi. Ketiganya dihapus.

E2E sejati butuh seluruh stack hidup (tujuh service, Postgres, NATS, MinIO), jadi biayanya orkestrasi compose di CI, bukan sekadar menulis skenario. Sampai itu diputuskan, lapisan integrasi yang menutupi jalur kritis: 28 suite integrasi project-service menjalankan HTTP request terhadap Postgres nyata, dan skenario BDD di atas menutupi lifecycle proyek serta milestone. Yang belum tertutup adalah jalur lintas-service sesungguhnya (bayar di payment-service lalu dokumen terbuka di project-service) dan browser rendering. Tambahkan Playwright kembali hanya bersama test pertamanya, jangan sebagai dependency kosong lagi.

Temporal worker juga tidak tersentuh CI sama sekali, dan itu lubang tersendiri: target build `apps/project-service` adalah `src/index.ts`, dan `start:temporal` tidak punya job. `Worker.create` mem-bundle kode workflow dengan webpack saat worker start, jadi kegagalan bundling baru muncul saat proses itu dijalankan, bukan saat `tsc --noEmit` atau `bun build` lulus. Workflow yang dibundle di sana adalah escrow release, team formation, dan dispute resolution. Waktu SDK dinaikkan ke 1.22.0 ini diverifikasi manual (bundle terbentuk 1,51MB via webpack 5.109.2, worker mencapai `state: RUNNING` di task queue `project-service` terhadap Temporal compose, lalu STOPPING sampai STOPPED saat dimatikan). Setengah dari itu sekarang otomatis: `apps/project-service/scripts/check-workflow-bundle.ts` memanggil `bundleWorkflowCode`, yang tidak butuh server, dan jalan sebagai gate di lint-and-type-check. Yang tetap manual adalah worker benar-benar connect dan register, karena itu butuh Temporal hidup di CI.

### Contract Tests

Pact tidak terpasang di mana pun — bukan di package.json, go.mod, maupun pyproject.toml — dan tidak ada satu pun pact file. Bagian ini dulu menjelaskannya seolah berjalan di CI.

Yang benar-benar menjaga kontrak hari ini, dan batasnya masing-masing:

- Zod schema di `packages/shared` dipakai bersama service dan frontend, jadi bentuk yang di-import ikut berubah saat schema berubah. Ini menangkap drift lintas service TypeScript saat compile
- `tsc --noEmit` di CI menegakkan itu untuk seluruh monorepo TypeScript
- Yang TIDAK dijaga: batas ke Go dan Python. payment-service, notification-service, admin-service, dan ai-service tidak berbagi tipe dengan pemanggilnya, jadi perubahan bentuk response di sana baru ketahuan saat runtime. Spec OpenAPI juga ditulis tangan sebagai JSON literal, jadi ia bisa menyimpang dari route tanpa ada yang gagal

Consumer-driven contract testing akan menutup celah Go dan Python itu. Selama belum ada, celahnya nyata dan disebutkan di sini supaya tidak disangka tertutup.

## Security Threat Model

### Attack Surface

- **Frontend**: XSS, CSRF, clickjacking, open redirects
- **API**: injection (SQL, NoSQL, command), IDOR, broken auth, rate limit bypass
- **File Upload**: malicious file execution, path traversal, zip bomb
- **Payment**: double spend, escrow manipulation, webhook spoofing
- **AI**: prompt injection (chatbot), data exfiltration via AI responses
- **Infrastructure**: Docker escape, secret exposure, SSRF via internal services

### Mitigation (Already in Place)

- XSS: React auto-escaping + DOMPurify untuk rich content
- CSRF: SameSite=Lax cookie + Origin header check
- SQL Injection: Drizzle parameterized queries
- Auth: session-based via Better Auth, httpOnly cookies
- File Upload: MIME validation via magic bytes, random filenames, S3 storage
- Rate Limiting: per IP via middleware sendiri, dihitung di Valkey supaya dibagi lintas replika
- Secrets: environment variables, never committed to repo

### Additional Mitigations (Implement)

- Content Security Policy (CSP) header: restrict script sources
- Helmet middleware untuk Hono: set security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Payment webhook signature verification: Midtrans menggunakan SHA512 signature (order_id + status_code + gross_amount + server_key), Xendit menggunakan webhook token verification. Verifikasi WAJIB di Payment Service sebelum proses webhook event
- AI prompt injection defense: system prompt hardening, input sanitization before LLM call, output validation
- Regular dependency audit: Trivy + Grype + osv-scanner di CI, ketiganya fail-on-finding. TIDAK ada Dependabot maupun Renovate — tidak ada `.github/dependabot.yml`, tidak ada config renovate, dan tidak ada satu pun referensi di repo. Bagian ini sempat menyebutkannya seolah berjalan. Konsekuensinya nyata dan sudah terukur: tanpa sesuatu yang memantau dependency di antara audit manual, 22 grup advisory menumpuk sejak pass Juli, dan sebagian besar sebenarnya punya versi perbaikan yang sudah masuk rentang semver yang dideklarasikan parent-nya. Scanner memberi tahu bahwa ada yang rusak, bukan mengusulkan perbaikannya
- SSRF protection: internal service endpoints not accessible via API gateway (Traefik routing rules)
