# BYTZ Platform

## Tentang Proyek

BYTZ adalah platform managed marketplace untuk proyek digital di Indonesia. Konsepnya bukan freelancer marketplace biasa seperti Upwork, tapi lebih ke "Virtual Software House" yang terkurasi. Client mengajukan kebutuhan proyek, platform menganalisis dan menghasilkan dokumen bisnis/teknis dengan bantuan AI, lalu mencocokkan dengan worker yang sesuai.

Benchmark utama: Gigster (model managed marketplace), Upwork (open marketplace), Toptal (talent vetting), Projects.co.id (lokal), A.Team (team matching).

Gap yang diisi: Gigster terlalu mahal dan tertutup untuk pasar Indonesia. Upwork terlalu bebas tanpa kurasi. Toptal hanya untuk top 3% talent (eksklusif). BYTZ mengambil posisi di tengah, yaitu terkurasi tapi transparan, dengan harga yang masuk akal untuk pasar UMKM dan startup lokal, plus pemerataan proyek ke semua worker.

Perbedaan utama BYTZ dari kompetitor:

- Vs Gigster: Transparan (client bisa lihat profil worker), harga terjangkau pasar Indonesia, ada opsi beli BRD saja
- Vs Upwork: Platform melakukan kurasi dan quality control, harga sudah ditetapkan sistem (bukan bidding war), ada pemerataan proyek, ada Gantt chart dan time tracking built-in
- Vs Toptal: Tidak eksklusif, semua worker bisa berpartisipasi dengan pemerataan adil (tier internal only, tidak membatasi akses)
- Vs Projects.co.id: AI-powered scoping dan estimasi, dokumen standar (BRD/PRD), escrow terjamin, ML-based matching
- Vs A.Team: Fokus individual worker matching (bukan team), harga lebih terjangkau

Arsitektur platform dibangun dengan pola microservice supaya mature dan extensible. Fokus saat ini di proyek digital (software development, web, mobile, UI/UX, data). Arsitektur sudah didesain supaya bisa diperluas ke bidang engineering lain (sipil, geodesi, geologi, planologi) dan industri bisnis lainnya di fase berikutnya.

## Konteks Bisnis

### Model Bisnis

BYTZ adalah perantara terkurasi (managed intermediary), bukan kontraktor langsung. Platform memfasilitasi kontrak antara client dan worker, dengan nilai tambah berupa kurasi proyek, pembuatan dokumen, dan pencocokan talent.

### Revenue Stream

1. Penjualan BRD (Business Requirement Document): Client bayar untuk dokumen kebutuhan bisnis yang dihasilkan AI dan divalidasi
2. Penjualan PRD (Product Requirement Document): Jika client lanjut, bayar tambahan untuk dokumen teknis lengkap
3. Margin dari pengerjaan proyek end-to-end: Client bayar total harga proyek, platform ambil margin

Belum termasuk di scope saat ini: subscription bulanan, maintenance retainer, atau fee per jam.

### Struktur Margin

Margin berbanding terbalik dengan nilai proyek:

- Proyek di bawah Rp 10 juta: margin 25-30%
- Proyek Rp 10-50 juta: margin 20-25%
- Proyek Rp 50-100 juta: margin 15-20%
- Proyek di atas Rp 100 juta: margin 10-15%

Logika: proyek kecil butuh effort kurasi yang relatif sama dengan proyek besar, jadi persentase margin lebih tinggi. Proyek besar sudah menghasilkan nominal besar meski persentase kecil.

Team project pricing: margin dihitung dari total harga proyek (sum of all work packages). Proyek yang butuh team lebih besar cenderung bernilai lebih tinggi, sehingga margin persentasenya lebih rendah tapi nominal tetap signifikan. AI menghitung harga per work package berdasarkan: complexity, required skill level, estimated hours. Total harga proyek = sum(work_package_price) + platform_margin.

Transparent Fee Framing: Worker selalu menerima 100% dari quoted amount mereka. Platform fee sudah termasuk dalam harga yang ditampilkan ke client. Framing di UI: "Workers keep 100% of their quoted amount. Platform service fee is included in the project price." Ini penting untuk menarik worker (referensi: Contra's 0% freelancer commission framing).

### Cakupan Proyek

Fokus saat ini di proyek digital (software development, web, mobile app, UI/UX design, data/AI). Bidang hard engineering (sipil, geodesi, geologi) direncanakan untuk fase berikutnya. Arsitektur microservice memastikan penambahan domain baru hanya perlu service baru tanpa mengubah service existing.

## Flow Utama Platform

### 1. Client Request Project

Client mengisi form pengajuan proyek dengan field:

- Nama proyek dan deskripsi singkat
- Kategori (Web App, Mobile App, UI/UX Design, Data/AI, Other Digital)
- Budget range (estimasi kasar dari client)
- Estimasi timeline / deadline yang diharapkan (time bound — input kritis untuk kalkulasi team size oleh AI)
- Konteks/konten detail kebutuhan (free text)
- Info perusahaan/organisasi (opsional)
- Preferensi worker (almamater, pengalaman minimum, skill tertentu, opsional)

Form ini pakai multi-step wizard (bukan satu halaman panjang) supaya tidak overwhelming. Setiap step divalidasi sebelum lanjut ke step berikutnya.

### 2. AI Chatbot Follow-up

Jika deskripsi proyek belum lengkap atau ambigu, chatbot AI melakukan follow-up:

- Menanyakan detail fitur yang dibutuhkan
- Mengklarifikasi target user dan skala aplikasi
- Menanyakan integrasi dengan sistem existing
- Memastikan prioritas fitur (must-have vs nice-to-have)
- Menanyakan referensi aplikasi sejenis (misal: "seperti Tokopedia tapi untuk X"). AI bisa pre-populate fitur berdasarkan referensi

Chatbot terus follow-up sampai informasi cukup untuk menghasilkan BRD yang lengkap.

Sebelum generate BRD, chatbot menampilkan scope summary (ringkasan bullet point dari semua informasi yang dikumpulkan) dan minta konfirmasi client. Ini mencegah BRD yang salah arah dan mengurangi revisi.

Teknis chatbot:

- Pakai Vercel AI SDK v6 (useChat hook di frontend, streamText + toUIMessageStreamResponse() di backend Hono). v6 stable: Agent abstraction untuk reusable agents, type-safe UI streaming, automated codemod dari v5 tersedia
- Streaming response supaya user tidak menunggu lama
- System prompt berisi konteks tentang BYTZ, daftar pertanyaan yang perlu dijawab, dan format output yang diharapkan
- Conversation history disimpan di database per project
- Setiap pesan baru, AI mengevaluasi completeness score (0-100). Jika sudah di atas 80, suggest untuk generate BRD
- Template pertanyaan berbeda per kategori proyek (e-commerce punya pertanyaan beda dengan mobile app)
- Model: fine-tuned GPT-4o-mini untuk chatbot (hemat biaya, sudah dilatih dengan data project scoping), GPT-4o untuk BRD/PRD generation (butuh kualitas tinggi)
- RAG: chatbot menggunakan konteks dari proyek-proyek serupa sebelumnya via pgvector similarity search

### 3. Generate BRD

Setelah informasi lengkap, AI menghasilkan BRD yang berisi:

- Executive summary proyek
- Business objectives dan success metrics
- Scope dan batasan proyek
- Functional requirements (daftar fitur detail)
- Non-functional requirements (performa, keamanan, skalabilitas)
- Estimasi harga berdasarkan kompleksitas
- Estimasi timeline dan jumlah orang yang dibutuhkan (AI kalkulasi awal: scope vs time bound client = team size suggestion)
- Risk assessment (termasuk risk jika timeline terlalu ketat untuk scope yang diminta)

BRD di-generate menggunakan Vercel AI SDK structured output (generateObject() dengan Zod schema) supaya format konsisten dan bisa langsung di-parse ke UI.

BRD ditampilkan ke client untuk review. Client bisa minta revisi melalui chat.

### 4. Client Decision Point (setelah BRD)

Client punya tiga pilihan:

- Opsi A: Beli BRD saja, bayar biaya BRD, selesai. Client bisa pakai BRD untuk dikerjakan sendiri atau vendor lain.
- Opsi B: Lanjut ke PRD. Platform akan buat PRD (dokumen teknis lebih lengkap). Client bayar tambahan untuk PRD. Setelah PRD jadi, client bisa ambil PRD dan selesai, atau lanjut ke Opsi C.
- Opsi C: Lanjut develop sampai selesai dengan BYTZ. Platform cari worker, kelola proyek end-to-end.

### 5. Generate PRD (jika pilih Opsi B atau C)

AI menghasilkan PRD (Product Requirement Document) yang lebih teknis dari BRD. PRD berisi:

- Tech stack recommendation, arsitektur sistem, API design, database schema
- Breakdown task per sprint/milestone
- **Team Composition**: AI otomatis menghitung jumlah worker yang dibutuhkan berdasarkan:
  - Scope dan kompleksitas proyek (dari BRD)
  - Timeline yang diminta client (time bound)
  - Skill yang dibutuhkan (frontend, backend, mobile, UI/UX, data, dll)
  - Estimasi man-hours total dibagi timeline = jumlah worker
  - Misal: proyek butuh 800 man-hours, client minta selesai 2 bulan (320 jam kerja), maka butuh ~3 worker
  - **Team Templates** (accelerator): pre-built team configurations untuk common project types yang mempercepat AI decomposition:
    - Web App Standard: 1 backend + 1 frontend + 1 UI/UX (3 workers)
    - Mobile App: 1 backend + 1 mobile dev + 1 UI/UX (3 workers)
    - Full-Stack Starter: 1 fullstack + 1 UI/UX (2 workers)
    - Data Platform: 1 backend + 1 data engineer + 1 frontend (3 workers)
    - AI menggunakan template sebagai starting point lalu adjust berdasarkan BRD specifics
  - **Algorithm detail**:
    1. LLM Decomposition: GPT-4o menganalisis BRD dan menghasilkan daftar work packages dengan required_skills, estimated_hours, dan dependencies. Output via structured output (generateObject())
    2. Team Size Calculation: `team_size = ceil(total_estimated_hours / (timeline_days * working_hours_per_day))`. Minimum 1, maximum 8 (constraint: platform belum siap kelola tim > 8)
    3. Role Assignment Optimization: jika ada work packages yang bisa di-assign ke satu worker (skill overlap), merge untuk efisiensi. Gunakan greedy algorithm — sort work packages by hours desc, assign ke worker yang masih ada capacity
    4. Dependency Graph: DAG (Directed Acyclic Graph) dari dependencies antar work packages. Validasi: no cycles. Compute critical path via topological sort + longest path
    5. Timeline Validation: jika critical path > timeline client, AI suggest: (a) tambah worker, (b) extend timeline, (c) reduce scope. Tampilkan trade-off ke client
- **Task Decomposition**: Jika team > 1 worker, AI otomatis memecah proyek menjadi work packages per role/skill:
  - Setiap work package berisi: milestones, tasks, estimated hours, required skills
  - Dependencies antar work packages (misal: backend harus selesai sebelum frontend integrasi)
  - Parallel work streams yang bisa dikerjakan bersamaan
  - Critical path identification (via topological sort pada dependency DAG)
- **Pricing per Worker**: AI menghitung biaya per work package berdasarkan complexity dan skill level yang dibutuhkan. Total harga proyek = sum of all work packages + platform margin

PRD ditampilkan ke client untuk review. Client bisa minta revisi melalui chat (termasuk minta adjust jumlah worker atau timeline).
Setelah client setuju, status berubah ke PRD_APPROVED

### 5b. Client Decision Point (setelah PRD)

- Jika client memilih Opsi B: Bayar PRD, ambil dokumen, selesai. Client bisa pakai PRD untuk dikerjakan sendiri atau vendor lain.
- Jika client memilih Opsi C: Lanjut ke matching worker dan development.

### 6. Pencocokan Worker-Client (jika pilih Opsi C)

Semua komunikasi diperantarai platform. Client dan worker TIDAK berkomunikasi langsung sebelum deal. Ini menjamin:

- Privasi kedua pihak (identitas worker dirahasiakan sebelum deal)
- Semua transaksi terjamin lewat platform
- Mencegah bypass platform (disintermediation)

#### Matching SLA

Platform menjamin waktu matching:

- Single worker project: matched dalam 72 jam (ditampilkan ke client saat masuk MATCHING state)
- Team project: semua posisi terisi dalam 14 hari
- SLA ditampilkan di UI sebagai countdown/progress indicator

#### Single Worker Project (team_size = 1)

Alur pencocokan sama seperti sebelumnya:

- Platform merekomendasikan worker berdasarkan ML-powered matching (skill, pemerataan, track record, ketersediaan)
- Client mereview profil anonim, approve atau request worker lain
- Worker menerima atau menolak setelah melihat ringkasan proyek
- Deal: kontrak digital, dana escrow, proyek dimulai

#### Multi-Worker Team Project (team_size > 1)

Jika PRD menentukan butuh lebih dari 1 worker, platform membentuk tim:

- Status berubah ke TEAM_FORMING (sub-state dari MATCHING)
- Platform merekomendasikan worker per work package berdasarkan skill yang dibutuhkan:
  - Setiap work package punya required skills sendiri (misal: work package "Backend API" butuh skill backend + database)
  - Matching algorithm berjalan per work package, bukan per proyek keseluruhan
  - Tetap mengutamakan pemerataan: epsilon-greedy dan fairness constraint berlaku per work package
- Client mereview semua worker yang direkomendasikan secara anonim (Worker #1 untuk Frontend, Worker #2 untuk Backend, dst)
- Client bisa approve per worker atau request pengganti untuk posisi tertentu
- Setiap worker menerima atau menolak work package mereka secara independen
- Jika satu worker menolak, platform cari pengganti hanya untuk posisi tersebut (tidak perlu ulang seluruh tim)
- Batas waktu team formation: 14 hari sejak status MATCHING. Jika belum lengkap, platform menghubungi client untuk diskusi (adjust timeline/scope atau terima tim yang sudah ada)
- Setelah SEMUA posisi terisi dan kedua pihak setuju:
  - Kontrak digital per worker di-generate (setiap worker punya kontrak sendiri)
  - Dana escrow masuk per work package
  - Status berubah ke MATCHED, lalu IN_PROGRESS
- Pencairan bertahap per milestone per worker

### 7. Eksekusi Proyek

Setelah deal, client dan worker bisa berkomunikasi melalui platform chat (semua percakapan tercatat dan dimoderasi platform). Komunikasi langsung di luar platform tidak dianjurkan dan melanggar ToS.

#### Single Worker Project

- Worker mengerjakan proyek sesuai PRD
- Progress tracking via Gantt chart dan time tracking di platform
- Client bisa monitor real-time: milestone progress, time spent, deliverables
- Client approve milestone, dana cair ke worker
- Setelah semua milestone selesai, client melakukan final review

#### Multi-Worker Team Project

- Setiap worker mengerjakan work package masing-masing sesuai PRD
- Platform chat: ada group chat (semua worker + client) dan private chat per worker dengan client
- Inter-worker chat: worker dalam satu tim bisa chat satu sama lain via platform (untuk koordinasi teknis)
- Progress tracking:
  - Gantt chart menampilkan semua work packages secara terintegrasi, color-coded per worker
  - Client bisa filter view: per worker, per milestone, atau aggregate (semua worker)
  - Dashboard progress: overall project completion (rata-rata semua work packages), per-worker completion, critical path status
  - Alert otomatis jika satu worker ketinggalan yang bisa block worker lain (dependency)
- Milestone approval:
  - Milestone yang di-assign ke satu worker: client approve, dana cair ke worker tersebut
  - Milestone integrasi (gabungan beberapa worker): semua worker terkait harus submit, client approve keseluruhan, dana cair proporsional
  - Client bisa approve milestone per worker secara independen (tidak perlu menunggu worker lain yang tidak terkait)
- Setelah semua milestone semua worker selesai, client melakukan final review

#### Auto-Generated Invoices (Semua Tipe Proyek)

- Saat milestone di-approve dan escrow released, platform auto-generate invoice PDF:
  - Invoice number (sequential per project), project details, milestone description
  - Amount, payment method, payment confirmation reference
  - Platform fee breakdown (visible to admin only, not on client/worker invoice)
  - Tax info placeholder (PPN if applicable, auto-generate e-Faktur data di fase berikutnya)
- Client dan worker masing-masing dapat copy invoice
- Invoice history dashboard: tab "Financials" di project detail dan user dashboard
  - Filter: by project, by date range, by status (pending/released/disputed)
  - Export: CSV/PDF untuk keperluan accounting/tax
  - Running totals: total earned (worker), total spent (client)

#### Monitoring & Koordinasi (Semua Tipe Proyek)

- Rating bersifat internal (tidak dilihat client/worker lain), dipakai untuk AI matching dan evaluasi worker oleh platform
- Untuk team project: client bisa memberikan rating per worker (bukan hanya rata-rata tim)

### Talent Placement (Opsional, Post-Project)

Setelah proyek selesai dan kedua pihak puas, platform menawarkan opsi talent placement:

- Client bisa mengajukan interest untuk merekrut worker ke perusahaan mereka
- Platform memfasilitasi proses rekrutmen dengan conversion fee (10-15% dari estimasi gaji tahunan worker)
- Tiered fee: fee lebih tinggi untuk hubungan kerja < 1 tahun (platform belum banyak recoup value), fee lebih rendah untuk > 2 tahun (sudah banyak margin terkumpul). Referensi: Upwork menerapkan 13.5% dari estimasi 12-bulan earnings, staffing industry standard 15-25%
- Bundled services opsional: platform bisa memfasilitasi employment compliance, payroll processing sebagai revenue tambahan (model Upwork "Any Hire")
- Legal: conversion fee didokumentasikan di Terms of Service saat signup, diframing sebagai kompensasi atas facilitation dan introduction services (bukan restraint of trade)
- Mencegah "shadow hiring" di luar platform karena ada jalur resmi yang difasilitasi
- Worker tetap bisa menolak tawaran rekrutmen

### Platform Disintermediation Prevention (Behavioral Design)

Desain platform menerapkan prinsip psikologi dan behavioral economics untuk menjaga semua transaksi tetap melalui platform. Referensi: Harvard Business School research menunjukkan paradoks bahwa semakin platform meningkatkan trust antara kedua pihak, semakin tinggi risiko disintermediation — karena dengan trust yang cukup, kedua pihak bisa bypass intermediary.

Anonymity before deal (Trust Transfer Theory): Identitas worker dirahasiakan sebelum deal resmi. Client mengembangkan "institution-based trust" terhadap platform, yang ditransfer ke worker. Tanpa identitas, client tidak bisa menghubungi worker langsung. Studi Wharton: restricting external communication technology mengurangi disintermediation ~18%.

Multi-dimensional switching cost: Switching cost bukan hanya finansial, tapi juga: (1) time and effort cost — semua BRD/PRD, chat history, progress data di platform, (2) financial loss — escrow protection hilang, (3) psychological cost — identity dan connection yang sudah dibangun di platform (rating, portfolio, project history). Semakin banyak dimensi yang terlibat, semakin kuat lock-in.

Value-added lock-in (positif): Platform menyediakan fitur yang tidak bisa didapat di luar: escrow protection, Gantt tracking, dispute resolution, milestone management, time tracking, automated invoicing. Client tetap di platform karena value, bukan karena dipaksa. Prinsip: jangan pernah izinkan manual invoicing di luar platform (Upwork lesson).

Talent Placement sebagai "release valve": Alih-alih client diam-diam merekrut worker (shadow hiring), platform menyediakan jalur resmi dengan fee transparan. Referensi: Toptal dan Gigster mencegah disintermediation dengan model berbeda — Toptal via continuous margin, Gigster via team-as-a-service yang membuat relasi client ke tim bukan individu. BYTZ menggabungkan: continuous platform value (escrow, tracking) + conversion fee jika client ingin hire langsung.

Project-price-based revision fees: Revisi berbasis persentase harga proyek (bukan hourly rate worker) memastikan konsistensi. Alasan: (1) eliminasi worker-rate variance — revisi yang sama bisa cost $50 atau $500 tergantung rate worker, (2) eliminasi perverse incentive — hourly billing mendorong worker bekerja lambat pada revisi, (3) predictability — client tahu biaya sebelum request, (4) anchoring effect — harga proyek yang sudah disetujui menjadi anchor. Industry standard: agensi menyertakan 2-3 round revisi di base price, revisi tambahan dicharge flat fee. Firms dengan change order process yang disiplin capture 95% lebih banyak additional services revenue.

Platform communication monitoring: Semua komunikasi client-worker melalui platform chat. Platform bisa mendeteksi percakapan yang mengarah ke bypass (misal: tukar nomor HP, email pribadi) dan memberikan warning otomatis. ToS melarang transaksi di luar platform.

### 8. Admin Monitoring

- Admin BYTZ monitor seluruh proyek via admin panel
- Dashboard: total proyek aktif, revenue, worker utilization, dispute rate
- Alert: proyek yang terlambat, dispute baru, worker yang perlu review
- Bisa intervensi: reassign worker, mediasi dispute, suspend user

### Project Lifecycle (State Machine via XState v5)

Implementasi: XState v5 (29K GitHub stars, MIT license, TypeScript-first). State machine didefinisikan sebagai XState machine dengan type-safe transitions, guards, dan actions. Visual editor di stately.ai untuk desain dan debugging. Built-in persistence API (`getPersistedSnapshot()` / `createActor(machine, { snapshot })`) untuk save/restore state ke database via Drizzle.

Catatan: state names di diagram menggunakan UPPER_CASE untuk readability. Di database enum, semua disimpan sebagai lower_case (draft, scoping, brd_generated, dst).

```
DRAFT -> SCOPING -> BRD_GENERATED -> BRD_APPROVED
  -> PRD_GENERATED -> PRD_APPROVED -> MATCHING -> [TEAM_FORMING] -> MATCHED
  -> IN_PROGRESS -> REVIEW -> COMPLETED

TEAM_FORMING: sub-state dari MATCHING, aktif jika team_size > 1
  - Platform merekomendasikan worker per work package
  - Client approve/reject per posisi
  - Worker accept/decline per work package
  - Setelah semua posisi terisi -> MATCHED

Exit points (client bisa selesai dan bayar dokumen saja):
- BRD_APPROVED -> BRD_PURCHASED (Opsi A: beli BRD saja)
- PRD_APPROVED -> PRD_PURCHASED (Opsi B: beli PRD saja)

Side states:
- CANCELLED (bisa dari state manapun sebelum IN_PROGRESS, dan juga dari IN_PROGRESS/PARTIALLY_ACTIVE dengan partial refund)
- DISPUTED (dari IN_PROGRESS atau REVIEW)
- ON_HOLD (dari IN_PROGRESS)
- PARTIALLY_ACTIVE (dari IN_PROGRESS, jika satu worker dalam tim terminated tapi yang lain masih aktif)

ON_HOLD valid transitions:
- ON_HOLD -> IN_PROGRESS (proyek dilanjutkan setelah hold, trigger event project.resumed)
- ON_HOLD -> CANCELLED (client memutuskan tidak lanjut)
- ON_HOLD -> DISPUTED (ada dispute baru saat on hold)

DISPUTED valid transitions:
- DISPUTED -> IN_PROGRESS (dispute resolved, proyek dilanjutkan)
- DISPUTED -> CANCELLED (dispute resolved, proyek dibatalkan)
- DISPUTED -> COMPLETED (dispute resolved, deliverables diterima)

PARTIALLY_ACTIVE valid transitions:
- PARTIALLY_ACTIVE -> IN_PROGRESS (worker pengganti ditemukan, semua posisi terisi kembali)
- PARTIALLY_ACTIVE -> CANCELLED (client membatalkan seluruh proyek)
- PARTIALLY_ACTIVE -> DISPUTED (ada dispute baru)
- PARTIALLY_ACTIVE -> REVIEW (semua work packages remaining selesai)
- Tidak bisa kembali ke TEAM_FORMING (replacement matching berjalan di background, tidak mengubah status utama proyek)
```

Setiap perpindahan state dicatat di tabel project_status_logs untuk audit trail.

## Kebijakan Escrow, Revisi, Pembatalan, dan Dispute

### Escrow dan Auto-Release

Single worker project:

- Dana client masuk escrow sebelum pengerjaan dimulai (untuk fixed-price per milestone)
- Setelah worker submit milestone, client punya 14 hari untuk review dan approve
- Jika client tidak merespons dalam 14 hari, dana otomatis cair ke worker (auto-release)
- Auto-release mencegah client menahan pembayaran tanpa alasan

Multi-worker team project:

- Dana client masuk escrow per work package (setiap worker punya alokasi escrow sendiri berdasarkan PRD pricing)
- Escrow di-split saat proyek dimulai: total_escrow = sum(work_package_amount) + platform_margin
- Setiap worker punya milestones sendiri, pencairan independen per worker per milestone
- Auto-release 14 hari berlaku per worker per milestone (tidak menunggu worker lain)
- Milestone integrasi (cross-worker): dana di-hold sampai semua worker terkait submit, lalu client review keseluruhan. Auto-release 14 hari dihitung dari submit terakhir
- Jika satu worker terminated mid-project: escrow work package worker tersebut dibekukan, milestone yang belum selesai dikembalikan ke client, milestone yang sudah di-approve tetap dibayar. Platform cari pengganti, escrow di-reallocate ke worker baru

### Kebijakan Revisi per Milestone

- Setiap milestone termasuk 2 putaran revisi gratis
- Revisi harus masih dalam scope yang sudah disepakati di PRD
- Jika client minta perubahan di luar scope, itu dianggap change request dan perlu kesepakatan tambahan (harga dan timeline baru)

Revisi tambahan (setelah 2 putaran gratis):

- Client mengajukan request revisi tambahan melalui chatbot platform
- Chatbot menganalisis scope revisi dan menghitung biaya otomatis
- Biaya revisi tambahan berdasarkan persentase harga proyek (BUKAN rate per jam worker) untuk konsistensi:
  - Revisi minor (perubahan kecil, UI tweak): 3-5% dari harga milestone terkait
  - Revisi moderate (perubahan fungsionalitas): 8-12% dari harga milestone terkait
  - Revisi major (fitur baru / perubahan arsitektur): dianggap change request, butuh estimasi ulang. Change request diproses sebagai revision_request baru dengan severity=major dan is_paid=true. AI menghitung ulang harga dan timeline, disimpan di revision_requests table. Tidak perlu tabel terpisah — revision_requests sudah cukup untuk tracking change requests
- Setelah biaya dihitung, request dikirim ke worker untuk di-approve atau decline
- Worker bisa decline jika revisi di luar kemampuan atau scope terlalu besar
- Jika worker decline, platform mencarikan solusi (negosiasi scope atau reassign)
- Client harus bayar biaya revisi tambahan sebelum worker mulai mengerjakan
- Batas waktu pengajuan revisi: 7 hari setelah milestone disubmit

### Kebijakan Pembatalan (dengan Time Bounds)

#### Sebelum worker mulai (status sebelum IN_PROGRESS)

- Client bisa batalkan proyek kapan saja
- Dana escrow dikembalikan penuh ke client dalam 3 hari kerja
- Biaya BRD/PRD yang sudah dibayar tidak bisa direfund (dokumen sudah dihasilkan)
- Batas waktu: client punya 30 hari sejak status MATCHED untuk memulai proyek. Jika tidak dimulai dalam 30 hari, proyek otomatis dibatalkan dan escrow dikembalikan
- Team project: jika dibatalkan saat TEAM_FORMING (belum semua posisi terisi), escrow dikembalikan penuh

#### Setelah worker mulai (status IN_PROGRESS) — Single Worker

- Milestone yang sudah di-approve dan dicairkan tidak bisa direfund
- Milestone yang sedang dikerjakan: platform menilai progres dalam 5 hari kerja, bayar proporsional ke worker
- Milestone yang belum dimulai: dana dikembalikan ke client dalam 3 hari kerja
- Platform mencarikan worker pengganti dalam 7 hari kerja jika client ingin melanjutkan
- Batas waktu pembatalan oleh client: harus mengajukan dalam 3 hari setelah menemukan masalah pada milestone yang sedang dikerjakan

#### Setelah worker mulai (status IN_PROGRESS) — Multi-Worker Team

Client membatalkan seluruh proyek:

- Sama seperti single worker, tapi diterapkan per worker:
- Setiap worker dinilai secara independen: milestone approved dibayar, sedang dikerjakan dinilai proporsional, belum dimulai direfund
- Semua kontrak per worker di-terminate
- Total refund = sum(refund per worker untuk milestone belum selesai)

Client membatalkan satu worker saja (partial cancellation):

- Proyek tetap berjalan dengan worker lain (status PARTIALLY_ACTIVE)
- Worker yang dibatalkan: milestone approved dibayar, sedang dikerjakan dinilai proporsional, belum dimulai direfund
- Platform mencarikan worker pengganti untuk work package yang ditinggalkan dalam 7 hari kerja
- Worker lain yang terkena dependency dari work package yang vacant: timeline di-extend otomatis, platform komunikasikan ke client
- Jika pengganti tidak ditemukan dalam 14 hari, platform diskusi dengan client: re-scope proyek, adjust timeline, atau cancel work package tersebut

#### Jika worker tidak aktif mengerjakan proyek

- Jika worker tidak ada progress selama 7 hari berturut-turut tanpa pemberitahuan, platform kirim warning
- Jika setelah warning 3 hari masih tidak ada respons, platform bisa reassign worker
- Dana milestone yang belum selesai dikembalikan ke client dalam 3 hari kerja
- Worker mendapat penalti di rating internal dan pemerataan_skor
- Team project: reassignment hanya untuk worker yang bermasalah, worker lain tetap lanjut. Platform otomatis extend due_date milestone yang tergantung pada worker yang di-reassign (+ 7 hari grace period)

#### Jika worker membatalkan (abandon)

- Milestone yang belum selesai: dana dikembalikan ke client dalam 3 hari kerja
- Worker mendapat penalti di rating internal dan pemerataan_skor
- Jika abandon lebih dari 2 kali, worker disuspend dari platform
- Team project: sama seperti di atas, proyek tetap berjalan dengan worker lain. Platform cari pengganti untuk work package yang ditinggalkan

#### Refund timeline

- Refund escrow (sebelum IN_PROGRESS): 3 hari kerja
- Refund milestone yang belum dimulai: 3 hari kerja
- Refund proporsional (milestone sedang dikerjakan): 5-7 hari kerja (butuh assessment progress)
- Refund dari dispute resolution: 3 hari kerja setelah keputusan final
- Refund partial cancellation (team project, per worker): 3-5 hari kerja
- Semua refund diproses melalui payment gateway (Midtrans/Xendit), waktu actual tergantung metode pembayaran (instant untuk e-wallet, 1-3 hari untuk bank transfer)

#### Time bounds per milestone

- Worker harus submit milestone sebelum due_date yang disepakati
- Jika melewati due_date + 7 hari grace period, client bisa mengajukan dispute atau pembatalan milestone
- Setelah worker submit, client punya 14 hari untuk review (auto-release setelahnya)
- Setelah client request revisi, worker punya 7 hari untuk menyelesaikan revisi
- Team project: due_date per worker per milestone. Jika satu worker melewati due_date dan work package lain tergantung padanya, platform otomatis notifikasi semua pihak dan extend due_date worker yang terdampak

### Dispute Resolution (3-Step Structured Process)

Alur penyelesaian sengketa (3 tahap eskalasi):

**Step 1 — Direct Resolution (3 hari kerja)**:

1. Client atau worker mengajukan dispute melalui platform (dengan bukti: screenshot, file, timeline)
2. Status proyek berubah ke DISPUTED, dana escrow dibekukan
3. Platform membuka admin_mediation chat channel antara kedua pihak + admin mediator
4. Kedua pihak diberi kesempatan 3 hari kerja untuk menyelesaikan sendiri dengan bantuan chat mediator
5. Jika resolved: admin confirm resolution, status kembali ke IN_PROGRESS atau COMPLETED

**Step 2 — Admin Mediation (5 hari kerja)**: 6. Jika Step 1 gagal, admin mereview semua bukti dari kedua pihak 7. Admin menghubungi kedua pihak terpisah untuk klarifikasi 8. Admin mengajukan proposal resolusi (misal: split 70-30, partial refund + delivery) 9. Kedua pihak punya 2 hari untuk menerima atau menolak proposal

**Step 3 — Binding Decision (2 hari kerja)**: 10. Jika proposal ditolak, admin membuat keputusan final (binding, tidak bisa banding) 11. Keputusan bisa berupa: dana dirilis ke worker, dana dikembalikan ke client, atau dibagi proporsional 12. Keputusan didokumentasikan di dispute record dengan detail reasoning

Team project disputes:

- Dispute bisa diajukan terhadap satu worker tertentu (tidak perlu dispute seluruh proyek)
- Hanya escrow work package worker yang di-dispute dibekukan, worker lain tetap berjalan
- Jika dispute melibatkan integration milestone (cross-worker), platform menentukan kontribusi masing-masing worker
- Keputusan dispute per worker, bukan per proyek keseluruhan
- Worker lain yang terdampak dependency dari worker yang di-dispute: timeline di-extend, platform komunikasikan

Kasus dispute yang umum:

- Kualitas deliverable tidak sesuai spesifikasi PRD
- Worker tidak responsif atau melewati deadline
- Client mengubah requirement di luar scope tanpa kesepakatan
- Perselisihan tentang apa yang termasuk "dalam scope"
- Team project: satu worker tidak deliver tapi yang lain sudah selesai (partial dispute)

### NDA dan IP Agreement

- Platform menyediakan template NDA dan IP transfer agreement standar
- Template di-generate otomatis sebagai bagian dari kontrak digital saat proyek dimulai
- Inti: semua hasil kerja (kode, desain, dokumen) menjadi milik client setelah pembayaran selesai
- Worker tidak boleh menggunakan kode client untuk proyek lain
- Kedua pihak setuju untuk menjaga kerahasiaan informasi bisnis
- Team project: setiap worker menandatangani NDA dan IP agreement sendiri-sendiri. Workers dalam satu tim juga terikat NDA terhadap satu sama lain (tidak boleh share informasi proyek ke luar tim)

## Worker Vetting dan Evaluasi

### Vetting: CV Parsing dan AI Extraction

Proses vetting worker hanya satu tahap otomatis (tanpa skill assessment manual atau probation period, untuk menjamin pemerataan proyek):

1. Worker registrasi: data diri, CV upload (PDF/DOCX/PPTX), portfolio links (GitHub, Dribbble, Behance, LinkedIn, dll)
2. CV diparsing oleh Docling (IBM, unified document parsing) di AI Service lalu diextract via AI structured output (Instructor)
3. Hasil parsing dicocokkan dengan input manual worker untuk validasi silang
4. Setelah CV berhasil diparsing dan divalidasi, worker langsung berstatus "verified" dan bisa menerima proyek

Tidak ada skill assessment manual atau probation period karena:

- Skill assessment menciptakan barrier yang menghambat pemerataan (worker yang tidak pandai tes tapi kompeten bisa tersingkir)
- Probation period menciptakan bias terhadap worker baru (monitoring lebih ketat = lebih mudah mendapat rating buruk)
- Kualitas worker dinilai dari CV, portfolio, dan riwayat proyek yang sudah diparsing AI, bukan dari tes buatan

### Worker Portfolio (Structured)

Worker portfolio ditampilkan sebagai structured cards (bukan free text):

- Setiap portfolio item: project title, category, tech stack tags, duration, role played, 1-3 screenshots (opsional), key outcomes
- Proyek yang selesai melalui BYTZ mendapat "Verified on BYTZ" badge dengan data aktual: on-time delivery, within budget, completion status
- Auto-endorsed skills: skills yang digunakan di proyek BYTZ ter-endorse otomatis (misal: "React Native — used in 3 BYTZ projects")
- External portfolio: links ke GitHub, Dribbble, Behance tetap bisa ditambahkan tapi tanpa verified badge
- Portfolio di-render di profil worker (private view) dan di profil anonymous (matching view, tanpa nama proyek client)

### Client Review Worker (Anonymous)

Saat matching, client bisa mereview profil worker yang direkomendasikan platform:

- Profil ditampilkan TANPA nama worker (anonymous, hanya Worker #1, Worker #2, dst)
- Yang bisa dilihat client: ringkasan CV (pengalaman, pendidikan, skill), structured portfolio cards (dengan verified badges), domain expertise, jumlah proyek selesai di platform, auto-endorsed skills
- Client TIDAK bisa melihat: nama asli, rating internal, tier internal, kontak langsung
- Tujuan: client menilai berdasarkan kompetensi, bukan reputasi atau bias nama/institusi

### Worker Tiers (Internal Only)

Tier worker bersifat INTERNAL ONLY — tidak terlihat oleh worker maupun client. Digunakan hanya oleh sistem:

- Junior: 0-2 tahun pengalaman, portfolio terbatas
- Mid: 2-5 tahun pengalaman, beberapa proyek selesai
- Senior: 5+ tahun pengalaman, track record kuat

Tier hanya digunakan untuk:

- Adjusted pricing: rate yang digunakan dalam pricing engine berbeda per tier (tapi client hanya lihat harga final proyek, bukan tier worker)
- AI matching relevance: tier sebagai salah satu feature dalam algoritma matching, tapi TIDAK sebagai filter (semua tier tetap bisa mendapat semua proyek)
- Internal monitoring: admin bisa melihat distribusi proyek per tier untuk memastikan pemerataan

Tier TIDAK digunakan untuk:

- Membatasi proyek mana yang bisa dilihat worker (semua worker melihat semua proyek yang sesuai skill)
- Membuat prestige atau ranking yang terlihat
- Memprioritaskan worker tertentu secara signifikan (bobot tier dalam matching harus kecil)

### Rating dan Review (Internal Only)

Rating dan review bersifat INTERNAL ONLY — tidak terlihat oleh client lain atau worker lain:

- Setelah proyek selesai, client dan worker saling memberikan rating (1-5) dan review
- Rating TIDAK ditampilkan di profil publik worker atau di halaman matching
- Rating digunakan untuk: AI matching (sebagai feature), evaluasi performa worker oleh admin, quality control internal
- Worker bisa melihat rating sendiri di dashboard pribadi (untuk self-improvement), tapi client tidak bisa melihat rating worker lain
- Alasan internal only: mencegah "rich get richer" effect di mana worker dengan rating tinggi selalu dipilih, menghambat pemerataan

### Quality Control Berkelanjutan

- Semua quality control berdasarkan rating internal (tidak terlihat publik)
- Worker dengan average_rating di bawah 3.5 setelah 3+ proyek mendapat warning internal dari admin
- Worker dengan average_rating di bawah 3.0 setelah 5+ proyek disuspend sementara
- Worker yang disuspend bisa mengajukan banding dan improvement plan
- Admin memonitor distribusi proyek per tier dan per worker untuk memastikan pemerataan tetap terjaga

## Sistem Distribusi dan Pemerataan Proyek

Salah satu value utama BYTZ adalah pemerataan proyek ke worker. Bukan hanya worker top yang dapat semua proyek. Sistem ini menggunakan kombinasi rule-based scoring dan ML model, dengan penekanan kuat pada kesempatan bagi worker baru.

### Prinsip Pemerataan

- Worker baru tanpa rating/proyek HARUS punya kesempatan tinggi mendapat proyek (cold start problem)
- Tidak boleh ada "rich get richer" effect di mana worker berpengalaman monopoli proyek
- Tier internal tidak boleh menjadi filter yang membatasi akses proyek
- Rating internal tidak boleh menjadi satu-satunya penentu (karena worker baru belum punya rating)

### Strategi Cold Start (Exploration vs Exploitation)

Cold start problem: platform harus learn atribut worker baru (explore) agar bisa match lebih baik di masa depan (exploit). Setiap worker adalah separate multi-armed bandit problem, coupled oleh constrained job supply. Referensi: Lyft menerapkan full online reinforcement learning untuk matching, menghasilkan $30M+ incremental annual revenue.

Epsilon-greedy approach (rule-based, Fase 1-5) untuk menyeimbangkan kualitas matching dengan pemerataan:

- Exploration (30%): 30% slot rekomendasi dialokasikan untuk worker yang belum banyak/belum pernah dapat proyek, terlepas dari skor matching mereka (selama skill dasar cocok)
- Exploitation (70%): 70% slot menggunakan skor matching optimal (rule-based atau ML)
- Epsilon menurun secara bertahap per worker: setelah worker menyelesaikan 3+ proyek, slot exploration mereka berkurang. Tujuan: setiap worker punya minimal portfolio awal

New Worker Boost: Worker baru mendapat temporary increased visibility di listing rekomendasi (mirip Etsy new listing boost). Tujuan: platform mengumpulkan data performa worker secepat mungkin untuk improve matching quality. Boost berkurang setelah 2-3 proyek pertama selesai.

Graduated Exposure: Worker baru dimulai dari proyek yang lebih kecil/less complex (jika tersedia), lalu exposure meningkat seiring positive track record. Ini melindungi client sekaligus memberi worker kesempatan membuktikan diri.

Hybrid Recommender: Kombinasi content-based approach (skills, portfolio quality dari CV parsing) dengan collaborative filtering (apa yang dikerjakan worker serupa dengan sukses). Transfer learning: apply insights dari worker dengan profil serupa untuk infer capability worker baru.

Transparent Fairness Communication: Eksplisit komunikasikan ke worker bagaimana sistem pemerataan bekerja. Riset behavioral economics menunjukkan: procedural fairness sama pentingnya dengan outcome fairness — jika worker percaya sistem adil, mereka lebih loyal meskipun tidak selalu dapat proyek. Tanpa komunikasi fairness, "losers" cenderung salah mempersepsikan kompetisi sebagai tidak adil.

Alternative approach (Fase 6): Thompson Sampling — setiap worker punya probability distribution yang di-update setelah setiap proyek selesai. Worker baru punya distribusi lebar (high uncertainty = high exploration), worker berpengalaman distribusi sempit. Riset menunjukkan Thompson Sampling memiliki advantage riil dibanding epsilon-greedy dan UCB1 karena otomatis adaptif.

### Prioritas Assignment

1. Worker yang belum pernah dapat proyek sama sekali (prioritas tertinggi, agar semua worker punya portfolio)
2. Worker yang sedang tidak mengerjakan proyek aktif dan punya sedikit proyek selesai
3. Worker yang sudah pernah dapat proyek tapi sedang tidak sibuk
4. Worker yang sedang mengerjakan proyek (prioritas terendah)

### Tetap Mempertimbangkan

- Skill match: worker harus punya kemampuan yang relevan dengan proyek (hard requirement, bukan hanya bobot)
- Track record: riwayat penyelesaian proyek tepat waktu (tapi worker baru diberi benefit of the doubt)
- Availability: kesediaan waktu yang cukup
- Rating internal: sebagai signal kualitas, tapi bobot kecil untuk tidak menghukum worker baru
- Tier internal: sebagai signal pengalaman, tapi bobot sangat kecil

### Algoritma Skor Rekomendasi (Rule-based, Fase 1-5)

```
skor_rekomendasi = (skill_match * 0.30) + (pemerataan_skor * 0.35) + (track_record * 0.20) + (rating * 0.15)
```

Bobot pemerataan (0.35) paling besar untuk memastikan distribusi merata. Rating (0.15) paling kecil untuk tidak menghukum worker baru.

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
- Worker baru (0 proyek): skor 1.0 (maksimal)
- Worker dengan 1 proyek aktif: skor sekitar 0.33
- Worker dengan 0 aktif tapi 10 selesai: skor sekitar 0.5
- Bonus: worker yang belum pernah dapat proyek sama sekali mendapat +0.2 bonus (capped at 1.0)

track_record (0-1):

- Berdasarkan: persentase proyek selesai tepat waktu, tingkat kepuasan client (rating internal)
- Worker baru: default 0.6 (benefit of the doubt, lebih tinggi dari rata-rata)
- Formula: `(on_time_rate * 0.6) + (satisfaction_rate * 0.4)`

rating (0-1):

- Normalisasi dari rating 1-5 ke 0-1
- Worker baru tanpa rating diberi default 0.7 (tinggi, benefit of the doubt — jangan menghukum worker baru)
- Formula: `(avg_rating - 1) / 4`
- Rating ini internal only, tidak terlihat oleh client

### ML-based Matching (setelah 100+ proyek selesai)

Setelah data historis cukup, rule-based scoring digantikan/dilengkapi ML model:

- Model: CatBoost (Yandex, Apache 2.0) dijalankan di AI Service (Python) — native categorical feature handling tanpa manual encoding, LightGBM sebagai benchmark comparison
- Features: skill vectors, rating history (internal), completion rate, time patterns, project complexity score, client satisfaction history, pemerataan_skor, tier internal
- Constraint: model harus dilatih dengan fairness constraint supaya pemerataan tetap terjaga (tidak hanya optimisasi match success rate)
- Training: retrain mingguan dengan data proyek yang sudah selesai
- Output: probability score bahwa worker akan sukses menyelesaikan proyek
- Epsilon-greedy tetap berlaku: 30% slot exploration bahkan saat ML aktif
- Fallback: jika ML service down, gunakan rule-based scoring
- Evaluation: A/B test rule-based vs ML, track match success rate DAN distribution fairness (Gini coefficient per worker)

## Worker Onboarding

### Registrasi Worker

- Data diri (nama, email, nomor HP wajib format +62 dan unik per akun dengan verifikasi OTP, lokasi)
- Upload CV (PDF/DOCX/PPTX, maks 5MB — Docling mendukung multi-format parsing)
- Link portfolio (GitHub, Dribbble, Behance, LinkedIn, dll)
- Pilih kategori skill (Frontend, Backend, Fullstack, Mobile, UI/UX, Data, DevOps, dll)
- Pengalaman kerja (tahun)
- Pendidikan (universitas, jurusan, tahun lulus)
- Sertifikasi atau kursus relevan (opsional)

### CV Parser Pipeline

Urutan proses parsing CV:

1. Upload: File masuk ke S3-compatible storage via presigned URL (browser upload langsung ke R2/MinIO, bypass backend), metadata disimpan di database
2. Document Parsing: Docling (IBM, MIT license) di AI Service (Python) mengekstrak text dari semua format:
   - PDF (text-based dan image/scanned): unified pipeline, built-in OCR via EasyOCR/Tesseract fallback
   - DOCX, PPTX, HTML, Markdown: native support tanpa library terpisah
   - Layout analysis: tabel, heading hierarchy, list detection — output structured DoclingDocument
   - Satu library unified untuk semua format CV (tidak perlu OCR library + PDF library terpisah)
3. Structured Extraction: Parsed text diproses di AI Service via Instructor (Python library untuk LLM structured output dengan Pydantic, built-in retry logic, 10+ provider support):
   - nama, kontak
   - riwayat_pendidikan: [{universitas, jurusan, tahun_lulus, ipk}]
   - pengalaman_kerja: [{perusahaan, posisi, mulai, selesai, deskripsi}]
   - proyek: [{nama, deskripsi, tech_stack, url}]
   - skills: [string]
   - sertifikasi: [{nama, penerbit, tahun}]
4. Skill Matching: Skill yang diekstrak dari CV dicocokkan dengan canonical skill taxonomy menggunakan hybrid fuzzy matching (exact → Jaro-Winkler → embedding similarity)
5. Validasi Silang: Data hasil parsing dibandingkan dengan data yang diinput manual oleh worker. Jika ada perbedaan signifikan, tampilkan ke worker untuk konfirmasi
6. Background Job: Seluruh proses ini dijalankan sebagai background job via pg-boss, supaya user tidak menunggu

### Dashboard Worker

- Lihat proyek yang tersedia dan sesuai skill (difilter otomatis berdasarkan skill match, SEMUA proyek terlihat oleh semua tier)
- Apply ke proyek dengan satu klik (profil sudah lengkap)
- Lihat status aplikasi (pending, diterima, ditolak)
- Tracking proyek yang sedang dikerjakan (milestone, deadline, Gantt view, work package yang di-assign)
- Team project: lihat siapa rekan tim, progress masing-masing, dependency alerts
- Time tracking: log waktu kerja per task/milestone
- Riwayat proyek dan rating internal sendiri (hanya worker yang bisa lihat rating pribadinya, untuk self-improvement)
- Notifikasi proyek baru yang sesuai skill

## Project Management Tools

### Gantt Chart (Client dan Worker View)

- Library: SVAR React Gantt (@svar-ui/react-gantt v2.4+, MIT license, TypeScript, drag-and-drop)
- Tampilkan timeline per milestone dan task
- Dependencies antar task (finish-to-start, start-to-start)
- Critical path highlighting
- Zoom level: hari, minggu, bulan
- Client view: read-only, monitoring progress
- Worker view: bisa update progress dan log time (hanya task milik worker tersebut)

Multi-worker team view:

- Gantt chart menampilkan semua work packages dan tasks dalam satu view terintegrasi
- Color-coded per worker (setiap worker punya warna berbeda untuk task mereka)
- Swimlane view: baris per worker, menampilkan task masing-masing secara paralel
- Cross-worker dependencies ditampilkan sebagai garis penghubung antar swimlane
- Filter: client bisa filter per worker, per work package, atau lihat aggregate
- Worker hanya bisa edit task miliknya, tapi bisa lihat timeline worker lain (untuk koordinasi)
- Alert visual: task yang overdue atau blocking task worker lain ditandai merah

### Time Tracking

- Worker log waktu kerja per task
- Timer start/stop atau manual entry
- Daily/weekly summary
- Client bisa lihat total time spent per milestone, per worker (untuk team project)
- Team project: dashboard summary menampilkan time spent per worker dan total project
- Data dipakai untuk improvement estimasi di proyek berikutnya (termasuk estimasi team size)
- Tidak dipakai untuk billing (model fixed-price per milestone), tapi untuk transparansi

### Milestone Board

- Kanban-style view: Pending, In Progress, Submitted, Revision Requested, Approved, Rejected
- Milestone status flow: pending -> in_progress -> submitted -> approved (happy path). Submitted -> revision_requested -> in_progress (revision cycle). Submitted -> rejected (final rejection by client, triggers dispute or re-scoping)
- Drag-and-drop status update (worker side)
- File attachment per milestone submission
- Comment thread per milestone
- Due date dan overdue indicator
- Team project: board menampilkan milestones grouped per worker, dengan kolom "Integration" untuk milestones yang butuh multiple worker
- Filter per worker atau lihat semua

## Admin Panel

### Overview

Admin panel lengkap untuk monitoring dan manajemen BYTZ secara keseluruhan. Dibangun sebagai apps/admin (React + TanStack Router, BUKAN Refine) yang berjalan di port terpisah (5174) dari main web app (5173). Di production, admin panel diakses via subdomain admin.bytz.id. Admin memiliki login page sendiri yang memvalidasi role=admin. Semua request ke admin-service API divalidasi via middleware yang mengecek session cookie + role admin.

### Dashboard Admin (BI/Analytics)

Metrics utama (real-time dari materialized views, refresh setiap 5 menit via pg_cron):

- Total proyek per status (aktif, completed, cancelled), conversion funnel (BRD -> PRD -> development)
- Revenue: harian, mingguan, bulanan, kumulatif, breakdown per revenue stream (BRD/PRD/project margin)
- Worker utilization rate: rata-rata proyek aktif per worker, distribusi per tier
- Average project completion time vs estimated time
- Dispute rate, resolution time, outcome distribution (funds_to_worker/client/split)
- New user registrations trend (client dan worker, per minggu)
- AI usage: total cost per hari/minggu, cost per model, rata-rata tokens per interaction
- Matching performance: success rate, average time-to-match, exploration vs exploitation ratio
- Platform health: active services, error rate, latency P95 (dari OpenObserve metrics)

Charts dan visualisasi:

- Line chart: revenue trend, user growth, project volume over time
- Bar chart: proyek per kategori, worker distribusi per skill
- Funnel chart: conversion rate per state machine stage
- Heatmap: waktu aktivitas user (jam/hari), popular skill combinations
- Pie chart: revenue breakdown, dispute causes

Data export: CSV/PDF untuk semua dashboard views, scheduled weekly report ke admin email via pg-boss

### Manajemen User

- List semua user (client dan worker) dengan filter dan search
- Detail profil user, riwayat proyek, rating internal
- Suspend/ban user dengan alasan
- Verify worker manual (override CV parsing result)
- Reset password, update role
- Lihat tier internal worker, distribusi proyek per worker/tier

### Manajemen Proyek

- List semua proyek dengan filter per status, team_size (single/team)
- Detail proyek: timeline, milestones per worker, work packages, transactions per worker, chat history
- Intervensi: reassign worker, ubah status, adjust pricing
- Proyek yang terlambat (overdue alert)

### Manajemen Keuangan

- Transaction log lengkap
- Escrow balance
- Payout history ke worker
- Revenue report (harian, mingguan, bulanan)
- Refund management

### Manajemen Dispute

- List dispute aktif
- Review bukti dari kedua pihak
- Mediasi tools (chat admin-user)
- Keputusan dan pencairan dana

### Sistem dan Konfigurasi

- Platform settings (margin rates, matching weights, exploration rate, auto-release timer)
- AI model configuration (model selection, temperature, max tokens)
- Audit log semua aksi admin

## Tech Stack

### Frontend

- Runtime: Bun 1.3.x (package manager dan bundler)
- Framework: React 19 dengan TypeScript (strict mode)
- Build Tool: Vite 8 (Rolldown-based unified Rust bundler, 10-30x faster builds) dengan plugin @tailwindcss/vite dan @tanstack/router-plugin/vite (import: tanstackRouter)
- Routing: TanStack Router v1 (file-based routing, type-safe params/search, auto code splitting)
- Data Fetching: TanStack Query v5 (server state, caching, background refetch, optimistic update)
- Client State: Zustand v5 (minimal boilerplate, bisa persist ke localStorage). Breaking change v5: selectors yang return array/object baru tiap render bisa cause infinite loop — gunakan `useShallow` dari `zustand/shallow` untuk wrap selectors tersebut
- Styling: Tailwind CSS v4 (utility-first, zero runtime, CSS variables untuk design tokens)
- UI Components: shadcn/ui (copy-paste components, accessible via Radix UI, customizable)
- Form: React Hook Form v7 + @hookform/resolvers + Zod
- Chat/AI UI: Vercel AI SDK v6 (@ai-sdk/react useChat hook, streaming bawaan, Agent abstraction untuk reusable agents)
- Internationalization: react-i18next + i18next (multi-language Indonesian/English)
- Gantt Chart: SVAR React Gantt (@svar-ui/react-gantt v2.4+, MIT license, TypeScript, drag-and-drop, task dependencies)
- Icons: Lucide React (tree-shakeable, konsisten dengan shadcn)
- Date: date-fns (tree-shakeable, immutable)
- PDF Viewer: @react-pdf/renderer (untuk preview BRD/PRD di browser)
- PDF Generation: Typst (Rust-based, server-side PDF generation untuk BRD/PRD export dan invoices, <100ms generation, 20MB Docker image, markdown-like syntax)

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
      api.ts             # API client (hono/client — type-safe RPC dari Hono route types, zero codegen)
      i18n.ts            # i18next initialization
      constants.ts       # config, enum values
      utils.ts           # helper functions
    locales/
      id/                # Bahasa Indonesia translations
        common.json
        auth.json
        project.json
        worker.json
        chat.json
        document.json
        matching.json
        payment.json
        admin.json
        errors.json
      en/                # English translations
        common.json
        auth.json
        project.json
        worker.json
        chat.json
        document.json
        matching.json
        payment.json
        admin.json
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
- Password hashing: Argon2id (Better Auth built-in)
- Session cookie cache: enabled, maxAge 5 minutes (reduce DB lookups per request)
- RBAC: 2 roles di main app (client, worker). Admin terpisah di apps/admin (port 5174) dengan admin-service API yang memvalidasi session+role via middleware
- Hono middleware pattern: extract session di middleware, set user/session ke Hono context variables (c.set("user", session.user))
- Route handler: auth.handler(c.req.raw) untuk semua /api/v1/auth/\* routes
- Endpoint: `/api/v1/auth/*`

**Project Service (Hono)**:

- Runtime: Bun
- Lifecycle management: CRUD proyek, state machine via XState v5 (18 project states, type-safe transitions, visual editor di stately.ai, built-in persistence API untuk DB snapshots)
- Work package management: create from PRD, assign workers, track per-package status
- Team formation: coordinate multi-worker matching, track team completeness
- Milestone management: create, update status, file attachments, per-worker dan integration milestones
- Time tracking: log entries per task/milestone per worker
- Gantt data: task dependencies, scheduling, cross-worker dependencies
- Escrow logic: hold, release, auto-release timer, per-worker escrow split
- Endpoint: `/api/v1/projects/*`, `/api/v1/work-packages/*`, `/api/v1/milestones/*`, `/api/v1/time-logs/*`

**AI Service (Python FastAPI)**:

- Runtime: Python 3.12+ dengan UV (package manager, lebih cepat dari pip/poetry)
- Framework: FastAPI
- LLM Gateway: TensorZero (Rust, Apache 2.0, <1ms p99 latency, built-in A/B testing, schema enforcement, cost tracking via TOML config)
- Chatbot: fine-tuned GPT-4o-mini via OpenAI fine-tuning API
- Structured Output: Instructor (Python library untuk LLM structured output dengan Pydantic, built-in retry logic, complement AI SDK generateObject() di TypeScript)
- BRD/PRD Generation: GPT-4o via Instructor structured output (PRD termasuk team composition, work package decomposition, dependency analysis)
- CV Parsing: Docling (IBM, MIT license, unified document parsing — PDF/DOCX/PPTX/HTML, built-in layout analysis) + GPT-4o structured extraction via Instructor
- ML Matching: CatBoost (Yandex, Apache 2.0, native categorical feature handling — superior untuk skill/domain/tier features tanpa manual encoding) dengan LightGBM sebagai benchmark comparison, experiment tracking via MLflow
- RAG: pgvector untuk similarity search, OpenAI embeddings, hybrid search (BM25 + vector + mxbai-rerank-large-v2 cross-encoder reranking dengan RRF)
- Endpoint: `/api/v1/ai/*`

**Payment Service (Hono)**:

- Runtime: Bun
- Integrasi: Midtrans atau Xendit
- Transaction management: escrow in/out, refund
- Double-entry bookkeeping: setiap money movement = debit+credit entries yang sum to zero (accounts + ledger_entries tables). Menjamin ledger selalu balanced, audit-proof, reconcilable. Pattern: Stripe Ledger
- Idempotency: idempotency_key per transaksi
- Webhook handler dari payment gateway
- Endpoint: `/api/v1/payments/*`

**Notification Service (Hono)**:

- Runtime: Bun
- In-app notifications (database + SSE push)
- Email transaksional via Resend
- Real-time transport: Centrifugo (Go, Apache 2.0, standalone WebSocket server, 1M connections/node, language-agnostic HTTP API, integrates dengan NATS). Backend services publish via Centrifugo Server API (HTTP/gRPC), Centrifugo handles semua WebSocket connections, fan-out, presence tracking, reconnection. Built-in channel permissions, message history, presence detection
- Event listener dari NATS (project.status.changed, payment.completed, dll)
- Endpoint: `/api/v1/notifications/*`, `/ws/*`

**Admin Service (Hono)**:

- Runtime: Bun
- API backend untuk Refine admin panel
- Dashboard analytics queries
- User management, project management
- Audit logging
- Platform configuration
- Endpoint: `/api/v1/admin/*`

Shared across services:

- Validation: Zod v4 (7-14x faster dari v3, type instantiations turun dari 25K ke 175. Zod Mini tersedia ~1.9KB gzipped untuk client-side. Schema dishare via monorepo packages/shared)
- ORM: Drizzle ORM (type-safe, SQL-like API, migration via drizzle-kit). Driver: drizzle-orm/postgres-js (postgres.js v3, battle-tested 4+ tahun, full drizzle-kit compatibility). Catatan: bun:sql (native Bun SQL module) lebih cepat ~50% di raw benchmarks tapi masih ada concurrent statement bugs dan drizzle-kit push incompatibility — migrasi ke drizzle-orm/bun-sql saat issues resolved (one-line config change)
- Database: PostgreSQL 17 (shared database dengan schema separation, split per service jika ada bottleneck). PG17 features yang dipakai: JSON_TABLE untuk query JSONB columns (cv_parsed_data, preferences, metadata) tanpa manual JSON extraction, faster VACUUM, improved HNSW index performance. pgvector 0.8.2+ (CVE fix). Extensions: pgvector, pg_cron (scheduled jobs: data retention cleanup, materialized view refresh)
- Cache: Redis via Upstash (session store, rate limiting, AI response cache)
- Job Queue: pg-boss (background jobs: CV parsing, document generation, notification sending, ML training)
- Logging: Pino via hono-pino (structured JSON logging), shipped ke OpenObserve via OTLP
- Observability: OpenObserve (Apache 2.0, single Rust binary, ~1GB RAM) — unified logs + traces + metrics dalam satu platform. Menggantikan Loki + Jaeger + Prometheus + Grafana (4 tools → 1). OTLP-native, S3/R2 compatible storage backend. Pipeline: Pino → OpenTelemetry Collector → OpenObserve. UI built-in untuk log search, trace visualization, metrics dashboards
- Telemetry: OpenTelemetry SDK + OpenTelemetry Collector (vendor-neutral, OTLP export ke OpenObserve)
- Connection Pooling: PgBouncer (transaction mode, ~10MB RAM) — multiplexes service connections ke PostgreSQL. Best practice untuk microservice architecture dengan shared database, mencegah connection exhaustion saat scaling replicas
- Message Broker: NATS with JetStream (persistent messaging, exactly-once delivery, message deduplication). Client library: @nats-io/transport-node + @nats-io/jetstream (modular packages)

### AI/ML Architecture

4 konsep AI/ML yang diimplementasikan:

**1. AI as a Service (TensorZero Gateway)**:

- TensorZero (Rust, Apache 2.0, 11K+ GitHub stars, $7.3M funded) sebagai LLM gateway
- Self-hosted via Docker, OpenAI-compatible API, <1ms p99 latency at 10K+ QPS, zero memory leaks
- Model routing via TOML config: GPT-4o-mini untuk chatbot, GPT-4o untuk BRD/PRD, fine-tuned model untuk scoping
- Built-in A/B testing: routing ke model variants dengan configurable weights (misal: 80% GPT-4o, 20% Claude Sonnet untuk BRD generation)
- Schema enforcement: input/output JSON schema validation per function, reject malformed responses sebelum sampai ke user
- Natively supports: OpenAI, Anthropic, Google, Ollama, AWS Bedrock, Azure, Fireworks, Together, vLLM
- Local Development: Ollama menjalankan model lokal (Llama 3, Mistral, dll) untuk development tanpa API costs. TensorZero routes ke Ollama di dev, ke cloud providers di production
- Cost tracking: built-in per-request cost calculation, exportable metrics
- Observability: integrates dengan Langfuse untuk detailed LLM tracing, prompt management, dan cost analytics
- Config: semua routing, model, dan function definitions di tensorzero.toml (declarative, version-controlled)

**2. Fine-tuned LLM (Project Scoping Chatbot)**:

- Base model: GPT-4o-mini (murah untuk fine-tuning dan inference)
- Training data: conversation logs dari project scoping yang sukses (setelah 50+ proyek)
- Format: JSONL dengan system/user/assistant messages
- Fine-tuning via OpenAI API (bukan self-hosted training)
- Tujuan: chatbot lebih fokus dan konsisten dalam menggali kebutuhan proyek digital
- Sebelum data cukup: pakai prompt engineering dengan few-shot examples
- Evaluasi: completeness score accuracy, user satisfaction rating

**3. ML Model (Worker-Project Matching)**:

- Model: CatBoost (Yandex, Apache 2.0) di Python AI Service — native categorical feature handling tanpa manual one-hot encoding, superior untuk BYTZ matching features (skills, domain, tier, category semua categorical). LightGBM sebagai benchmark comparison
- Features: skill vector (TF-IDF), rating history, completion rate, response time, project complexity, client satisfaction, domain expertise, tier (categorical native)
- Training: batch retrain mingguan via pg-boss scheduled job
- Experiment tracking: MLflow (self-hosted, Docker container) — track hyperparameters, metrics, model versions, dataset snapshots
- Model registry: MLflow model registry, promote model ke "production" stage setelah evaluation pass
- Serving: FastAPI endpoint, response < 100ms
- Fallback: rule-based weighted scoring jika ML service down
- Evaluation: A/B test rule-based vs ML, track match success rate + fairness metrics (Gini coefficient)
- LLM Evaluation: DeepEval (50+ metrics, pytest native, DAG deterministic scoring) + Ragas (RAG-specific: Context Precision, Context Recall, Faithfulness) — keduanya integrate sebagai MLflow third-party scorers. DeepEval untuk chatbot quality (Knowledge Retention, Conversation Completeness, hallucination detection), Ragas untuk RAG pipeline tuning

**4. RAG (Retrieval Augmented Generation)**:

- Vector store: pgvector extension di PostgreSQL (tidak perlu database terpisah)
- Embedding model: OpenAI text-embedding-3-small (1536 dimensions)
- Data yang di-embed: BRD/PRD yang sudah diapprove, project descriptions, skill descriptions
- Index: HNSW (Hierarchical Navigable Small World) untuk fast approximate nearest neighbor. BUKAN IVFFlat (HNSW lebih akurat dan tidak butuh training step)
- HNSW parameters: m=16, ef_construction=200 (good balance accuracy vs build time)
- Use case: chatbot mengambil konteks dari proyek serupa sebelumnya untuk improve scoping quality
- Query pipeline (3-stage retrieval):
  1. BM25 search via PostgreSQL `tsvector` + `ts_rank` (keyword/lexical match)
  2. Vector search via pgvector cosine similarity (semantic match)
  3. Cross-encoder reranking via sentence-transformers (Python, di AI Service) — rerank top-20 candidates dari BM25+vector, +5-15% retrieval accuracy. Model: mixedbread-ai/mxbai-rerank-large-v2 (Apache 2.0, Qwen-2.5 architecture, outperforms Cohere/Voyage on BEIR benchmarks)
  - RRF: `score = sum(1 / (k + rank_i))` dengan k=60 untuk merge BM25+vector sebelum cross-encoder rerank
  - Pipeline: BM25+Vector → RRF merge top-20 → cross-encoder rerank → return top-4
- Chunking strategy: section-aware chunking untuk BRD/PRD (split per section heading, bukan fixed character count). Setiap chunk simpan metadata: document_id, section_title, section_order
- Threshold: cosine similarity > 0.5, final top 4 results setelah reranking

**Document Parsing Pipeline** (bagian dari CV Parser, di AI Service Python):

- Docling (IBM, MIT license) sebagai unified document parsing engine
  - Multi-format: PDF (text-based dan image/scanned), DOCX, PPTX, HTML, Markdown — satu library untuk semua format CV
  - Layout analysis: tabel, heading hierarchy, list detection, multi-column layout
  - Built-in OCR: EasyOCR/Tesseract sebagai fallback untuk scanned documents
  - Output: structured DoclingDocument object dengan section hierarchy
  - Open source (MIT), aktif dikembangkan oleh IBM Research
- Language: Indonesian + English (multi-language support built-in)
- Pre-processing: built-in di Docling (auto format detection, layout normalization)
- Post-processing: clean up parsing artifacts, normalize whitespace, merge fragmented sections
- Confidence scoring: jika parsed content terlalu sedikit (<100 kata), minta user upload ulang
- Fallback: jika Docling service down, queue job untuk retry (pg-boss)
- File upload: presigned URL pattern — browser upload langsung ke R2/MinIO, backend hanya generate signed URL dan validasi metadata

### Monorepo Structure

```
bytz/
  apps/
    web/                 # Frontend React app (client + worker views, port 5173)
    admin/               # Admin panel React app (admin only, port 5174, separate login)
    gateway/             # Traefik config
    auth-service/        # Auth Service (Hono + Better Auth)
    project-service/     # Project Service (Hono)
    ai-service/          # AI Service (Python FastAPI)
    payment-service/     # Payment Service (Hono)
    notification-service/# Notification Service (Hono)
    admin-service/       # Admin Service (Hono + Refine API)
  packages/
    shared/              # Shared Zod schemas, types, constants, enums, error codes
    db/                  # Drizzle schema, client, migrations, seed
    nats-events/         # NATS event type definitions, publisher/subscriber helpers, outbox
    logger/              # Pino config, structured logging, correlation ID middleware
    config/              # Zod-based env validation, service config loader
    testing/             # Shared test utilities, fixtures, database helpers
    ui/                  # Shared UI components (beyond shadcn)
  biome.json             # Biome config (linter + formatter)
  turbo.json             # Turborepo config
  package.json           # Root workspace config (Bun workspaces)
  bun.lockb              # Bun lockfile
  docker-compose.yml     # All services + PostgreSQL 17 + PgBouncer + Redis 7 + NATS + MinIO + OpenObserve + Traefik + TensorZero + Ollama + Centrifugo + Temporal + Langfuse
  docker-compose.prod.yml  # Production overrides + Infisical (secret management)
  .env.example           # Template environment variables
```

Package manager: Bun workspaces (Bun 1.3.x)
Monorepo tool: Turborepo (build orchestration, caching, parallel task execution)

### Infrastructure (Production)

Semua pilihan berdasarkan: ada free tier atau murah, open source friendly, cocok untuk startup.

- Container Orchestration: Docker Compose, Kubernetes (k3s) untuk scale
- API Gateway: Traefik v3 (auto-discovery, Let's Encrypt SSL, Docker native)
- Hosting: Coolify (Apache 2.0, self-hosted PaaS, native Docker Compose support, auto-deploy dari GitHub, Let's Encrypt SSL) di VPS (Hetzner/Contabo)
- Database: Neon PostgreSQL (serverless, branching per PR, free tier 0.5GB) + pgvector extension
- Connection Pooling: PgBouncer (transaction mode, ~10MB RAM, ISC license)
- Redis: Upstash (serverless Redis, free tier 10k commands/hari)
- Message Broker: NATS (self-hosted di container, lightweight)
- Real-time Transport: Centrifugo (self-hosted Docker container, Go, Apache 2.0)
- Workflow Orchestration: Temporal (MIT license, self-hosted Docker container, TypeScript SDK). Durable workflow execution untuk complex multi-service sagas (escrow → milestone → payment → notification), auto-retry, visual debugging UI
- File Storage: Cloudflare R2 (S3-compatible, free tier 10GB, no egress fee). Upload via presigned URLs (browser → R2 langsung)
- Domain dan DNS: Cloudflare (free)
- Email: Resend (free tier 3.000 email/bulan)
- Payment Gateway: Midtrans atau Xendit (VA, QRIS, bank transfer, GoPay, OVO, Dana, ShopeePay)
- Secret Management: Infisical (self-hosted, open source, Docker container). Centralized secret management untuk semua services. Rotasi otomatis, audit trail, environment-based (dev/staging/prod). Menggantikan .env files di production
- Error Tracking: Sentry (free tier 5k events/bulan)
- Uptime Monitoring: Uptime Kuma (MIT license, self-hosted, ~80MB RAM, unlimited monitors) untuk internal service monitoring + Better Stack (free tier 5 monitors) untuk external/public endpoint monitoring
- Observability: OpenObserve (Apache 2.0, single Rust binary, ~1GB RAM) — unified logs + traces + metrics. Menggantikan Loki + Jaeger + Prometheus + Grafana (4 tools → 1)
- Telemetry Pipeline: OpenTelemetry Collector (vendor-neutral OTLP export ke OpenObserve)
- Feature Flags: Flagsmith (BSD-3, self-hosted Docker container) — feature toggles, A/B testing, remote config untuk gradual rollout
- CI/CD: GitHub Actions (free untuk public repo, 2000 menit/bulan untuk private)
- Analytics: Umami (MIT, self-hosted, privacy-friendly, lightweight)
- AI Gateway: TensorZero (Rust, self-hosted Docker container, <1ms p99 latency, TOML config, built-in A/B testing)
- Local LLM Development: Ollama (self-hosted Docker container, zero API costs saat development)
- LLM Observability: Langfuse (MIT, self-hosted Docker container, acquired by ClickHouse) — LLM tracing, cost tracking, prompt management, playground

### Development Tools

- Linter + Formatter: Biome 2.x (Rust-based, menggantikan ESLint + Prettier, 10-100x lebih cepat)
- Git Hooks: Lefthook (MIT, Go binary, parallel execution, native monorepo support, YAML config — menjalankan biome check --write --staged sebelum commit)
- Testing: Vitest v4 (unit dan integration test, compatible dengan Vite 8). Breaking change v4: test options sekarang argument kedua (bukan ketiga): `test('name', { retry: 2 }, () => {})`
- E2E Testing: Playwright v1.58 (cross-browser, auto-wait, trace viewer)
- API Testing: Bruno (open source, Git-friendly, collections disimpan di repo)
- Contract Testing: Pact (consumer-driven contract testing antar microservices)
- Load Testing: k6 (AGPL-3.0, Grafana, Go engine, JavaScript test scripts, OpenAPI integration — performance testing untuk API endpoints dan load scenarios)
- Security Scanning: Trivy (Apache 2.0, Aqua Security) untuk container image + dependency + IaC scanning + Grype (Apache 2.0, Anchore) untuk SBOM-based vulnerability scanning. Run di CI/CD pipeline
- Local Services: Docker Compose (PostgreSQL 17 + PgBouncer + Redis 7 + NATS + MinIO + OpenObserve + Traefik + TensorZero + Ollama + Centrifugo + Temporal + Langfuse + Uptime Kuma + Flagsmith)

### Deployment Strategy

- Docker Compose single-host deployment via Coolify (self-hosted PaaS) di VPS
- Rolling updates via `docker compose up -d --no-deps --build <service>` untuk per-service zero-downtime updates
- Database migrations: run sebelum deploy (backward-compatible only, additive — add columns, jangan rename/drop), jangan di-couple dengan container startup
- Blue-green deployment: via Docker Compose profiles. Two sets of containers (blue/green), Traefik switches routing via Docker labels setelah health check pass. Rollback instant (< 1 detik, switch Traefik routing kembali). Butuh ~1.5x resources karena kedua stacks jalan bersamaan saat switchover
- Scale: migrate ke Kubernetes (k3s) untuk auto-scaling, rolling updates, pod health management

## Arsitektur Microservice

### Prinsip Desain

- Bounded Context: setiap service punya domain yang jelas dan tidak overlap
- Database per Service (logical): shared PostgreSQL dengan schema separation (`auth.*`, `project.*`, `payment.*`, dll). Migrasi ke database terpisah jika ada bottleneck
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

Komunikasi synchronous (REST via hono/client):

- Frontend -> Service: semua user-facing API calls via hono/client (type-safe RPC, zero codegen — import Hono route types langsung, auto-complete di IDE)
- Service -> Service: hono/client untuk type-safe inter-service calls (misal: Project Service -> Auth Service untuk validate user). Eliminasi manual API type definitions

Komunikasi asynchronous (NATS):

- project.status.changed -> Notification Service kirim email/push
- payment.completed -> Project Service update milestone status
- worker.registered -> AI Service trigger CV parsing
- project.completed -> AI Service update embeddings dan retrain ML model

### NATS JetStream Stream Configuration

Streams diorganisasi per domain untuk isolasi dan retention policy yang berbeda:

```
Stream: PROJECT_EVENTS
  Subjects: project.>, project.status.>, project.team.>
  Retention: limits (max 10GB, max 30 days)
  Storage: file
  Replicas: 1 (single-host), 3 (production cluster)
  Deduplication window: 2 minutes (msgID-based)

Stream: PAYMENT_EVENTS
  Subjects: payment.>
  Retention: limits (max 5GB, max 90 days — longer for audit)
  Storage: file
  MaxDeliver: 5 (more retries for payment events)

Stream: WORKER_EVENTS
  Subjects: worker.>
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
- project.team.forming, project.team.worker_assigned, project.team.worker_replaced, project.team.complete

Payment:

- payment.escrow.created, payment.released, payment.refunded, payment.partial_refund
- payment.revision_fee.charged, payment.talent_placement_fee.charged
- payment.gateway.webhook_received (dari Midtrans/Xendit)

Worker:

- worker.registered, worker.verified, worker.suspended, worker.unsuspended
- worker.assignment.accepted, worker.assignment.declined

Milestone:

- milestone.submitted, milestone.approved, milestone.rejected
- milestone.revision_requested, milestone.auto_released
- milestone.overdue, milestone.due_soon (7 hari sebelum due_date)
- milestone.dependency.blocked (ketika satu worker blocking worker lain)

Chat & AI:

- chat.message.sent (untuk trigger AI response di scoping)
- chat.bypass_detected (percakapan mencurigakan, potential disintermediation)
- ai.brd.generated, ai.prd.generated, ai.cv.parsed
- ai.matching.completed (hasil rekomendasi worker)

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
- Solution: tulis event ke `outbox_events` table dalam transaction yang sama dengan business data. Background worker (pg-boss) poll table dan publish ke NATS. Mark event sebagai published setelah NATS acknowledge
- Table: outbox_events (id, aggregate_type, aggregate_id, event_type, payload JSONB, published boolean default false, created_at)
- Worker: jalan setiap 1 detik, batch publish max 100 events, retry 3 kali sebelum dead letter
- Catatan: meskipun NATS JetStream sudah provide reliable delivery, outbox pattern tetap diperlukan untuk menjamin atomicity antara database write dan event publish (dual-write problem). JetStream menjamin message delivery SETELAH publish, outbox menjamin event PASTI di-publish

**Idempotent Consumer + Dead Letter Queue (DLQ)**:

- NATS JetStream sudah provide at-least-once delivery dan message deduplication (via msgID). Tapi consumer-side idempotency tetap perlu
- Setiap NATS consumer simpan processed event IDs di Redis (SET, TTL 7 hari)
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

**OpenAPI Documentation** (@hono/zod-openapi):

- Setiap service expose `/api/v1/{service}/docs` — Scalar API Reference (@scalar/hono-api-reference, MIT, modern UI, OpenAPI 3.1 native, built-in dark mode) auto-generated dari Zod schemas
- Zod schema sudah dipakai untuk validasi input → reuse sebagai OpenAPI spec
- `@hono/zod-openapi` menghasilkan OpenAPI 3.1 spec dari route definitions
- Dokumentasi selalu up-to-date karena derived dari code, bukan ditulis manual

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
- pg-boss worker: stop polling, wait for active jobs to finish
- WebSocket connections: send close frame, wait for client disconnect
- Docker stop timeout: 30 detik (match graceful shutdown timeout)

**Temporal Workflows** (durable orchestration untuk complex multi-service sagas):

- Complex flows didefinisikan sebagai Temporal workflows (TypeScript SDK):
  - Milestone approval: validate → release escrow → update project → send notification → generate invoice
  - Team formation: match workers → wait for acceptance → handle decline/timeout → replace → form team
  - Dispute resolution: open dispute → freeze escrow → mediation → binding decision → release/refund
  - Auto-release: timer 14 hari → check client response → release escrow ke worker
- Setiap step adalah independently retryable activity, crash-safe (Temporal replays dari checkpoint terakhir)
- Visual debugging: Temporal Web UI menampilkan setiap workflow execution, step, retry, dan error
- Simple event fan-out (notifications, logging, analytics) tetap via NATS choreography — Temporal hanya untuk orchestrated multi-step flows
- Temporal Server: self-hosted Docker container (frontend + matching + history + worker services), menggunakan shared PostgreSQL

**Shared Packages** (packages/ directory):

- `packages/shared`: Zod schemas, TypeScript types, constants, enums, error codes
- `packages/db`: Drizzle schema, client, migrations, seed
- `packages/nats-events`: NATS event type definitions, publisher/subscriber helpers, outbox utilities
- `packages/logger`: Pino configuration, structured logging helpers, correlation ID middleware
- `packages/config`: Zod-based env validation, service config loader
- `packages/testing`: shared test utilities, fixtures, database test helpers
- `packages/ui`: shared UI components (if any beyond shadcn)

### CI/CD Pipeline (GitHub Actions)

```yaml
# Trigger: push ke main, PR ke main
# Jobs:
# 1. lint-and-type-check: biome check + tsc --noEmit (parallel per workspace via Turborepo)
# 2. test-unit: vitest run (parallel per service, Turborepo change detection — hanya test yang affected)
# 3. test-e2e: playwright (setelah unit pass, spin up docker compose, run E2E)
# 4. security-scan: trivy image scan + grype dependency scan (parallel per service)
# 5. build: docker build per service (multi-stage build, hanya rebuild service yang berubah)
# 6. deploy: push images ke registry, deploy ke Coolify (hanya di main branch)
```

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
# Docling models + mxbai-rerank-large-v2 model download di build time, bukan runtime
```

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
- Soft delete (deleted_at column) untuk: users, projects, transactions, documents
- Hard delete untuk: chat_messages yang sudah expire, temporary data
- JSONB column untuk data semi-structured (AI response raw, metadata fleksibel)
- Index strategy: foreign key, kolom yang sering di-WHERE (status, created_at), composite index untuk query yang sering digabung
- pgvector extension untuk embedding storage (RAG)
- Schema separation per service domain: `auth.*`, `project.*`, `payment.*`, `ai.*`, `admin.*`
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
- phone (unique, NOT NULL, Indonesian format +62 diikuti 9-13 digit, untuk mencegah multi-account abuse)
- phone_verified (boolean, default false, diverifikasi via OTP 6 digit)
- role (enum: client, worker — admin terpisah di admin app/service, tidak bisa registrasi dari main app)
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

worker_profiles (1:1 dengan users yang role = worker)

- id (UUID v7, PK)
- user_id (FK -> users, unique)
- bio
- years_of_experience
- tier (enum: junior, mid, senior) -- INTERNAL ONLY, tidak ditampilkan ke worker/client
- education_university
- education_major
- education_year
- cv_file_url
- cv_parsed_data (JSONB, hasil parsing CV)
- portfolio_links (JSONB, array of {platform, url})
- hourly_rate_expectation
- availability_status (enum: available, busy, unavailable)
- verification_status (enum: unverified, cv_parsing, verified, suspended) -- unverified -> cv_parsing (saat parsing berjalan) -> verified (setelah CV berhasil diparsing)
- domain_expertise (JSONB, array of string: ["fintech", "e-commerce", "healthcare", "education", "logistics", "saas"])
- total_projects_completed
- total_projects_active
- average_rating
- pemerataan_penalty (float, default 0, akumulasi penalti dari abandon/inaktif — ditambahkan ke formula pemerataan_skor: `1 / (1 + proyek_aktif * 2 + total_proyek_selesai * 0.1 + pemerataan_penalty)`)
- created_at, updated_at

Catatan `pemerataan_skor`: dihitung real-time dari formula di atas menggunakan kolom worker_profiles (total_projects_completed, total_projects_active, pemerataan_penalty). Tidak disimpan sebagai kolom terpisah karena selalu derived.

Catatan `health_score`: dihitung real-time per proyek dari komponen timeline/milestone/communication/budget. Tidak disimpan di database — dihitung on-demand saat admin dashboard atau project detail di-load. Jika performa jadi issue, cache di Redis (TTL 5 menit).

worker_assessments (hasil vetting — hanya CV parsing, tanpa skill assessment atau probation)

- id (UUID v7, PK)
- worker_id (FK -> worker_profiles)
- stage (enum: cv_parsing) -- saat ini satu stage. Tetap pakai enum (bukan boolean) untuk extensibility jika nanti ditambahkan stage lain (portfolio_review, skill_test, dll) tanpa migration breaking
- status (enum: pending, in_progress, passed, failed)
- score (float, nullable)
- reviewer_id (FK -> users, nullable, untuk manual override oleh admin)
- notes (text, nullable)
- completed_at
- created_at

worker_penalties (tracking suspend/penalty)

- id (UUID v7, PK)
- worker_id (FK -> worker_profiles)
- type (enum: warning, rating_penalty, suspension, ban)
- reason (text)
- related_project_id (FK -> projects, nullable)
- issued_by (FK -> users, admin)
- appeal_status (enum: none, pending, accepted, rejected)
- appeal_note (text, nullable)
- expires_at (timestamptz, nullable, untuk temporary suspension)
- created_at

worker_skills (many-to-many)

- worker_id (FK -> worker_profiles)
- skill_id (FK -> skills)
- proficiency_level (enum: beginner, intermediate, advanced, expert)
- is_primary (boolean)
- PK: (worker_id, skill_id)

skills (master data)

- id (UUID v7, PK)
- name (unique)
- category (enum: frontend, backend, mobile, design, data, devops, other)
- aliases (JSONB, array of string untuk fuzzy matching, misal: ["ReactJS", "React.js", "React"])
- embedding (vector(1536), pgvector, untuk semantic skill matching)

#### Project Domain

projects

- id (UUID v7, PK)
- client_id (FK -> users)
- title
- description
- category (enum: web_app, mobile_app, ui_ux_design, data_ai, other_digital)
- status (enum: draft, scoping, brd_generated, brd_approved, brd_purchased, prd_generated, prd_approved, prd_purchased, matching, team_forming, matched, in_progress, partially_active, review, completed, cancelled, disputed, on_hold)
- budget_min, budget_max (integer, dalam Rupiah)
- estimated_timeline_days
- team_size (integer, default 1, dihitung AI dari PRD)
- final_price (integer, setelah kalkulasi AI, total semua work packages + margin)
- platform_fee (integer, margin platform)
- worker_payout (integer, total yang diterima semua worker — derivation: sum(work_packages.worker_payout). Constraint: final_price = worker_payout + platform_fee)
- preferences (JSONB: {almamater, min_experience, required_skills} — required_skills disimpan sebagai string names, di-resolve ke skills table saat matching via fuzzy pipeline)
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
- type (enum: ai_scoping, client_worker, team_group, worker_worker, admin_mediation)
- created_at
- Untuk team project: client_worker = private chat client-worker per worker, team_group = group chat semua worker + client, worker_worker = inter-worker koordinasi, admin_mediation = dispute resolution chat (admin + kedua pihak)

chat_participants (join table — siapa saja yang ada di conversation)

- id (UUID v7, PK)
- conversation_id (FK -> chat_conversations)
- user_id (FK -> users)
- joined_at (timestamptz)
- left_at (timestamptz, nullable — null jika masih aktif)
- role (enum: member, moderator) — moderator = admin/platform
- UNIQUE: (conversation_id, user_id)

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
- type (enum: message_sent, milestone_submitted, milestone_approved, milestone_rejected, revision_requested, payment_made, payment_released, file_uploaded, status_changed, worker_assigned, worker_replaced, worker_declined, team_formed, review_posted, dispute_opened, dispute_resolved, project_on_hold, project_resumed)
- title (string, ringkasan aktivitas)
- metadata (JSONB, detail tambahan sesuai type)
- created_at

brd_documents

- id (UUID v7, PK)
- project_id (FK -> projects, unique)
- content (JSONB, structured BRD data)
- version (integer, untuk track revisi)
- status (enum: draft, review, approved, paid)
- price (integer, harga BRD)
- embedding (vector(1536), pgvector, untuk RAG similarity search)
- created_at, updated_at

prd_documents

- id (UUID v7, PK)
- project_id (FK -> projects, unique)
- content (JSONB, structured PRD data termasuk team_composition: {team_size, work_packages: [{title, required_skills, estimated_hours, amount}], task_decomposition, dependencies})
- version (integer)
- status (enum: draft, review, approved, paid)
- price (integer, harga PRD)
- embedding (vector(1536), pgvector)
- created_at, updated_at

project_applications

- id (UUID v7, PK)
- project_id (FK -> projects)
- worker_id (FK -> worker_profiles)
- status (enum: pending, accepted, rejected, withdrawn)
- cover_note (text, pesan dari worker)
- recommendation_score (float, dari algoritma matching)
- created_at, updated_at
- UNIQUE: (project_id, worker_id)

work_packages (pembagian tugas per worker dalam team project)

- id (UUID v7, PK)
- project_id (FK -> projects)
- title (misal: "Frontend Development", "Backend API", "UI/UX Design")
- description
- order_index (integer)
- required_skills (JSONB, array of skill names yang dibutuhkan)
- estimated_hours (float)
- amount (integer, nominal harga work package ini)
- worker_payout (integer, yang diterima worker untuk work package ini)
- status (enum: unassigned, pending_acceptance, assigned, declined, in_progress, completed, terminated)
- created_at, updated_at
- pending_acceptance: worker sudah direkomendasikan, menunggu accept/decline
- declined: worker menolak, platform cari pengganti (status kembali ke unassigned setelah replacement ditemukan)
- Untuk single worker project: 1 work package yang mencakup seluruh proyek

project_assignments (satu per worker per proyek, bisa multiple per proyek untuk team)

- id (UUID v7, PK)
- project_id (FK -> projects)
- worker_id (FK -> worker_profiles)
- work_package_id (FK -> work_packages)
- application_id (FK -> project_applications, nullable — untuk team project, worker bisa di-assign langsung tanpa apply)
- role_label (string, misal: "Frontend Developer", "Backend Developer", "UI/UX Designer")
- acceptance_status (enum: pending, accepted, declined) — tracking worker acceptance sebelum proyek dimulai
- status (enum: active, completed, terminated, replaced)
- started_at, completed_at
- created_at
- UNIQUE INDEX: (project_id, work_package_id) WHERE status IN ('active', 'completed') — satu worker aktif per work package. Partial unique index memungkinkan worker baru di-assign ke work package yang sama setelah worker sebelumnya di-replace (status = 'replaced'/'terminated')

contracts (NDA dan IP agreement per worker per proyek)

- id (UUID v7, PK)
- project_id (FK -> projects)
- assignment_id (FK -> project_assignments)
- type (enum: standard_nda, ip_transfer)
- content (JSONB, generated contract data)
- signed_by_client (boolean, default false)
- signed_by_worker (boolean, default false)
- signed_at (timestamptz, nullable)
- created_at
- Untuk team project: satu kontrak per worker (bukan unique per project)

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
- resolution_type (enum: funds_to_worker, funds_to_client, split, nullable)
- resolved_by (FK -> users, nullable, admin yang resolve)
- resolved_at (timestamptz, nullable)
- created_at, updated_at

milestones

- id (UUID v7, PK)
- project_id (FK -> projects)
- work_package_id (FK -> work_packages, nullable — null jika single worker atau milestone integrasi)
- assigned_worker_id (FK -> worker_profiles, nullable — null jika milestone integrasi yang butuh multiple worker)
- title
- description
- milestone_type (enum: individual, integration) — individual: satu worker, integration: butuh submit dari multiple worker
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
- requested_by (FK -> users, client yang request)
- description (text, detail revisi yang diminta)
- severity (enum: minor, moderate, major)
- is_paid (boolean, default false — true jika sudah melewati 2 revisi gratis)
- fee_amount (integer, nullable — biaya jika is_paid = true)
- fee_transaction_id (FK -> transactions, nullable — referensi pembayaran revisi)
- status (enum: pending, accepted, in_progress, completed, declined)
- worker_response (text, nullable — alasan jika declined)
- requested_at (timestamptz)
- completed_at (timestamptz, nullable)
- created_at

tasks (sub-item dari milestone, untuk Gantt chart)

- id (UUID v7, PK)
- milestone_id (FK -> milestones)
- assigned_worker_id (FK -> worker_profiles, nullable — inherit dari milestone jika individual, explicit jika integration milestone)
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
- type (enum: finish_to_start, start_to_start) — finish_to_start paling umum (misal: backend selesai sebelum frontend integrasi)
- UNIQUE: (work_package_id, depends_on_work_package_id)
- Validasi: no cycles (DAG check saat create)

time_logs (time tracking)

- id (UUID v7, PK)
- task_id (FK -> tasks)
- worker_id (FK -> worker_profiles)
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
- worker_id (FK -> worker_profiles, nullable — untuk tracking pembayaran per worker di team project)
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
- owner_type (enum: platform, client, worker, escrow) — tipe pemilik account
- owner_id (UUID v7, nullable — FK ke users/worker_profiles, null untuk platform account)
- account_type (enum: asset, liability, revenue, expense)
- name (string, misal: "Client Escrow - Project X", "Worker Payout - Worker Y", "Platform Revenue")
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
- metadata (JSONB, nullable — detail tambahan: project_id, milestone_id, worker_id)
- created_at
- Index: (account_id, created_at) untuk balance calculation dan audit trail
- Index: (transaction_id) untuk menghubungkan semua entries dalam satu transaksi
- Constraint: untuk setiap transaction_id, sum(debit amounts) HARUS = sum(credit amounts) — enforced di application layer via db.transaction()

Contoh flow escrow:

1. Client bayar escrow Rp 10jt: DEBIT client_escrow_account, CREDIT platform_holding_account
2. Milestone approved, release ke worker Rp 8jt: DEBIT platform_holding_account Rp 8jt, CREDIT worker_payout_account Rp 8jt
3. Platform fee Rp 2jt: DEBIT platform_holding_account Rp 2jt, CREDIT platform_revenue_account Rp 2jt
   Setiap step: sum(debit) = sum(credit), ledger selalu balanced

talent_placement_requests (tracking talent placement / direct hire requests)

- id (UUID v7, PK)
- project_id (FK -> projects — proyek asal yang menghubungkan client dan worker)
- client_id (FK -> users)
- worker_id (FK -> worker_profiles)
- status (enum: requested, in_discussion, accepted, declined, completed)
- estimated_annual_salary (integer, nullable — estimasi gaji tahunan untuk kalkulasi fee)
- conversion_fee_percentage (float — 10-15% berdasarkan durasi hubungan kerja)
- conversion_fee_amount (integer, nullable — dihitung dari salary \* percentage)
- transaction_id (FK -> transactions, nullable — referensi pembayaran fee)
- notes (text, nullable)
- created_at, updated_at

#### Shared Domain

reviews (INTERNAL ONLY — rating dan review tidak ditampilkan ke client lain atau worker lain, hanya untuk AI matching dan admin monitoring)

- id (UUID v7, PK)
- project_id (FK -> projects)
- reviewer_id (FK -> users)
- reviewee_id (FK -> users)
- rating (integer, 1-5)
- comment (text)
- type (enum: client_to_worker, worker_to_client)
- is_visible_to_reviewee (boolean, default true) -- worker bisa lihat rating sendiri untuk self-improvement
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
- aggregate_type (string, misal: "project", "payment", "worker")
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

#### Analytics Domain (Materialized Views)

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

mv_worker_stats (statistik worker)

- total_workers (integer)
- workers_by_tier (JSONB: {junior: N, mid: N, senior: N})
- avg_projects_per_worker (float)
- avg_rating (float)
- utilization_rate (float, persentase worker yang punya proyek aktif)
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

- Library: react-i18next + i18next + i18next-http-backend + i18next-browser-languagedetector
- Default language: Bahasa Indonesia (id)
- Supported languages: id, en
- Detection order: localStorage -> navigator -> fallback (id)
- Translation files: JSON per namespace per language (/locales/{lng}/{ns}.json)

### Namespaces

- common: button labels, navigation, generic UI text
- auth: login, register, OAuth, session, password reset
- project: project-related text (form labels, status names, flow descriptions)
- worker: worker-related text (profile, dashboard, CV parsing, time tracking)
- chat: chatbot UI, chat client-worker, group chat, system messages
- document: BRD/PRD viewer, editor, generation status
- matching: worker recommendation, team formation, anonymous profil
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

Miller's Law: Kelompokkan informasi dalam chunk 5-7 item. Daftar fitur di BRD dikelompokkan per modul. Skill tags di profil worker dikelompokkan per kategori.

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

Arsitektur semantic color tokens disiapkan dari awal supaya dark mode bisa ditambahkan tanpa refactor besar:

- Semua warna referensi via CSS variables (sudah dilakukan di @theme)
- Naming convention semantic: `--color-bg-primary`, `--color-text-primary`, bukan `--color-white`, `--color-black`
- shadcn/ui sudah support `.dark` class toggle — hanya perlu definisi ulang CSS variables di `.dark {}`
- Pertimbangkan OKLCH color space untuk dark mode palette (perceptually uniform — L=0.25 untuk background, L=0.85 untuk text menghasilkan consistent brightness across hues, unlike HSL). Browser support sudah solid (Chrome 111+, Firefox 113+, Safari 15.4+). Saat ini pakai HSL/hex, migrasi ke OKLCH saat implement dark mode
- Implementasi dark mode di fase berikutnya, tapi token structure harus ready dari Fase 1

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
  Green:    #9fc26e (brand green) / #7fa84e (untuk worker-related UI, success indicators)
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
Dashboard (Client): Two-panel (sidebar + main). Summary cards di atas (active projects, pending actions, total spent, overall progress percentage), project list di bawah (grid view default + list view toggle), Gantt chart view per proyek. Client analytics: total investment, milestone completion rate, average project duration, spending trend chart
Dashboard (Worker): Two-panel (sidebar + main). Available projects feed (grid + list toggle), active projects sidebar, time tracker widget. Proactive match notifications: "New project matching your skills"
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
- Interface Segregation: client frontend hanya import type yang dibutuhkan dari packages/shared
- Dependency Inversion: service layer depend pada interface (repository pattern), bukan concrete database implementation

### Clean Architecture Layers

Per microservice:

```
Route Handler (HTTP layer) -> Service (Business Logic) -> Repository (Data Access)
```

- Route handler: parse request, validate input (Zod), call service, return response
- Service: business logic murni, tidak tahu HTTP, tidak tahu database implementation
- Repository: Drizzle queries, database-specific logic

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
6. Processes: stateless services (session di Redis, files di S3)
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
  - (worker_id, skill_id): worker skill lookups
  - (user_id, is_read): notification reads
  - (conversation_id, created_at): chat message pagination (critical for performance)
  - (worker_id, proficiency_level, is_primary): worker skill matching queries
  - (project_id, worker_id, status) ON project_assignments: active assignment lookups
- Partial indexes:
  - project_assignments WHERE status = 'active': only index active assignments (smaller index, faster queries)
  - outbox_events WHERE published = false: only index unpublished events for polling
  - milestones WHERE status IN ('pending', 'in_progress', 'submitted'): only active milestones
- pgvector HNSW: untuk embedding columns (cosine distance)

Database Constraints (beyond FK/PK):

- work_packages.amount: CHECK (amount > 0) — prevent zero/negative pricing
- work_packages.estimated_hours: CHECK (estimated_hours > 0)
- milestones.amount: CHECK (amount >= 0) — allow zero for non-paid milestones
- milestones.revision_count: CHECK (revision_count >= 0)
- projects.budget_min, budget_max: CHECK (budget_min >= 0 AND budget_max >= budget_min)
- transactions.amount: CHECK (amount > 0)
- reviews.rating: CHECK (rating >= 1 AND rating <= 5)
- time_logs: CHECK (ended_at IS NULL OR ended_at > started_at)

### Arsitektur Data Lengkap

Tahap 1 (Foundation, seiring Development Fase 1): Shared PostgreSQL dengan schema separation per domain. Materialized views untuk dashboard metrics, di-refresh via pg_cron setiap 5 menit. Views yang di-materialized: project_summary_stats (jumlah proyek per status, revenue kumulatif), worker_utilization_stats (proyek aktif per worker, rating rata-rata, distribusi tier), financial_summary (escrow balance, total payout, revenue harian/mingguan/bulanan), matching_performance (match success rate, average time-to-match)

Tahap 2 (Read Replica, seiring Development Fase 5): Read replica PostgreSQL untuk semua dashboard dan reporting queries (admin dashboard, client progress view, worker analytics). Write ke primary, read dari replica. Connection routing via application-level logic (Drizzle multiple clients: dbWrite, dbRead). Latency replica: < 1 detik asynchronous replication

Tahap 3 (CQRS, setelah traffic signifikan): Command Query Responsibility Segregation untuk domain yang high-read. Write model (normalized 3NF) di primary database. Read model (denormalized views) di replica, dibangun dari NATS events. Contoh: project detail page baca dari denormalized read model (gabungan projects + milestones + assignments + work_packages dalam satu query), command (update status, approve milestone) tetap ke write model. Sinkronisasi: event-driven via NATS, eventual consistency (< 2 detik)

Tahap 4 (Analytics/BI, setelah data cukup): Dedicated analytics database (ClickHouse atau PostgreSQL read replica khusus analytics). ETL pipeline via pg_cron + custom scripts: extract dari operational DB, transform (aggregate, clean), load ke analytics DB. Tabel analytics: daily_project_metrics, weekly_revenue_report, worker_performance_trends, matching_effectiveness, ai_cost_analysis. Dashboard BI admin: OpenObserve dashboards connect ke analytics DB, custom charts di admin panel via Refine

### Business Intelligence (Admin)

Dashboard analytics yang dibangun bertahap:

Materialized Views (Tahap 1, refresh via pg_cron):

- mv_project_overview: total proyek per status, conversion rate (BRD -> PRD -> development), rata-rata waktu per fase
- mv_revenue_daily: revenue harian/mingguan/bulanan, breakdown per revenue stream (BRD/PRD/project margin)
- mv_worker_stats: distribusi proyek per worker, per tier, rata-rata rating, utilization rate
- mv_matching_metrics: match success rate, rata-rata waktu matching, exploration vs exploitation ratio
- mv_ai_cost: total cost per model per hari, rata-rata tokens per interaction, cost per project

Custom Analytics Queries (Tahap 2+):

- Cohort analysis: retention rate client dan worker per bulan registrasi
- Funnel analysis: drop-off rate di setiap state machine transition
- Worker performance trends: rating trajectory, completion rate over time
- Revenue forecasting: berdasarkan proyek aktif dan pipeline
- Dispute analysis: penyebab dispute terbanyak, rata-rata resolution time, outcome distribution

Export dan Reporting:

- CSV/PDF export untuk semua dashboard data
- Scheduled reports via pg-boss: kirim weekly summary ke admin email
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
- Form pakai React Hook Form dengan Zod resolver
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
- OpenAPI docs: @hono/zod-openapi + @scalar/hono-api-reference — auto-generate OpenAPI 3.1 spec dari Zod schemas, Scalar API Reference di `/api/v1/{service}/docs`
- Response format konsisten: { success: boolean, data?: T, error?: { code: string, message: string } }
- Pagination format: { items: T[], total: number, page: number, pageSize: number }
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

- Chatbot streaming: Vercel AI SDK v6 (streamText + toUIMessageStreamResponse di Hono, useChat di React, Agent abstraction untuk reusable agents)
- Structured output: generateObject() / streamObject() dengan Zod schema. v6: Output.object() API tersedia
- Catatan: zodResponseFormat sudah deprecated, JANGAN gunakan
- LLM calls via TensorZero gateway (Rust, <1ms p99 latency, TOML config, built-in A/B testing, schema enforcement)
- Retry: 3 kali dengan exponential backoff + jitter (base 1s, factor 2x, max 8s, jitter ±500ms random) untuk API call yang gagal. Jitter mencegah thundering herd saat service recover
- Circuit breaker (Cockatiel): composable resilience — retry + circuit breaker + timeout + bulkhead in single wrap(). Config: threshold 5 failures, resetTimeout 30s, halfOpenMax 3, return fallback error ke user
- Cache: simpan hash(prompt + parameters) -> response di Redis, TTL 1 jam untuk estimasi harga
- Timeout: 30 detik untuk chatbot response, 60 detik untuk BRD/PRD generation
- Log: semua AI interaction disimpan di ai_interactions table (prompt tokens, completion tokens, model, latency, cost) + Langfuse tracing untuk detailed LLM observability
- Cost control: set max_tokens per request, monitor usage via TensorZero metrics + Langfuse cost dashboard

### Security

- Input sanitization di semua user-facing endpoint (DOMPurify untuk HTML content)
- Rate limiting per IP dan per user (pakai Hono rate-limit middleware + Redis)
- CORS hanya untuk domain yang diizinkan (frontend domain saja)
- CSRF protection via SameSite cookie + Origin header check
- File upload: presigned URL pattern (browser upload langsung ke R2/MinIO, bypass backend). Validasi MIME type via magic bytes (bukan hanya extension), max 5MB untuk CV, max 10MB untuk attachment. Generate random filename (UUID) untuk mencegah path traversal. Backend hanya generate signed URL dengan expiry dan validasi metadata setelah upload complete
- Password hashing: Argon2id (via Better Auth, sudah built-in)
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

Error middleware menangkap semua error, log detail ke console, return format konsisten ke client.

Untuk external service (AI, payment gateway):

- Retry dengan exponential backoff
- Circuit breaker jika service down terus-menerus
- Fallback message ke user: "Sedang ada gangguan, coba lagi dalam beberapa menit" (via i18n)
- Jangan expose error detail dari external service ke user

## Alur Development

### Urutan Pengerjaan

Fase 1: Foundation

- Init monorepo (Turborepo + Bun workspaces)
- Setup Docker Compose (PostgreSQL 17 + PgBouncer + Redis 7 + NATS + MinIO + OpenObserve + Traefik + TensorZero + Ollama + Centrifugo + Temporal + Langfuse + Uptime Kuma + Flagsmith)
- Setup packages/shared (Zod schemas, types, constants, error codes)
- Setup packages/db (Drizzle schema semua domain, migrations, seed, pgvector extension, materialized views)
- Setup packages/nats-events (event type definitions, outbox utilities)
- Setup packages/logger (Pino config, correlation ID middleware)
- Setup packages/config (Zod env validation per service)
- Setup Biome, Lefthook
- Setup GitHub Actions CI/CD (lint, test, build via Turborepo change detection)
- Setup Docker multi-stage builds per service
- Setup frontend (Vite 8 + React 19 + TanStack Router + Tailwind v4 + shadcn + react-i18next + hono/client)
- Setup Auth Service (Hono + Better Auth: email+password, Google OAuth, session, RBAC)
- Setup API Gateway (Traefik config + Docker labels)
- Setup XState v5 state machine definitions (project lifecycle, milestone status)
- Setup Temporal workflows (milestone approval, team formation, dispute resolution, auto-release)
- Setup Centrifugo (WebSocket channels, authentication, presence)
- Setup Flagsmith (feature flags, environment config)
- Base layout: sidebar, header, responsive shell, language switcher

Fase 2: Core Client Flow

- Landing page (public, multi-language, platform success metrics section)
- Form pengajuan proyek (multi-step wizard)
- AI chatbot follow-up (Vercel AI SDK v6, streaming via TensorZero)
- BRD generation (structured output, preview UI)
- Client review, revisi via chat, approval BRD
- Payment untuk BRD (integrasi Midtrans/Xendit via Payment Service)

Fase 3: Core Worker Flow

- Registrasi worker (multi-step form, CV upload)
- CV parser (Docling unified document parsing + AI extraction via Instructor, background job pg-boss) — satu-satunya vetting stage
- Worker profile page (anonymous public view untuk client, full private view untuk worker sendiri)
- Dashboard worker: listing proyek yang sesuai skill (semua proyek terlihat, tidak difilter per tier)
- Apply ke proyek
- Notification system (in-app + email via Resend, Notification Service)

Fase 4: Matching, Assignment, dan Project Management

- Algoritma rekomendasi worker (weighted scoring, rule-based dulu)
- PRD generation (termasuk AI team composition dan work package decomposition)
- Work package management (create from PRD, per-worker assignment)
- Pencocokan client-worker (anonymous profil, platform-mediated, epsilon-greedy pemerataan)
- Multi-worker team formation flow (TEAM_FORMING state, per-position matching)
- Kontrak digital per worker dan escrow setup per work package
- Milestone breakdown per worker dan integration milestones
- Gantt chart (@svar-ui/react-gantt, task dependencies, multi-worker swimlane view)
- Time tracking (timer, manual entry, per worker)

Fase 5: Project Execution, Admin, dan BI

- Project tracking dashboard (milestone progress per worker, aggregate view, Gantt view)
- Client progress dashboard (investment summary, milestone completion rate, spending trend)
- Project health scoring (auto-calculated, admin alerts)
- Team coordination: group chat, inter-worker chat, dependency alerts
- Milestone submission dan approval (per worker, integration milestones)
- Structured deliverable management (checklist per milestone dari PRD)
- Pencairan dana per milestone per worker
- Auto-generated invoices per milestone (Typst PDF generation, invoice history dashboard, export CSV/PDF)
- Partial cancellation dan worker replacement flow
- Review dan rating internal (dua arah, per worker untuk team project, internal only)
- Project completion flow (team: semua worker harus selesai)
- Admin panel (Refine: dashboard BI, user management, project management, team management, finance, dispute, DLQ viewer)
- Materialized views untuk dashboard analytics (pg_cron refresh setiap 5 menit)
- Read replica setup untuk dashboard dan reporting queries
- RAG pipeline (embed BRD/PRD, hybrid search BM25 + vector + cross-encoder reranking, improve chatbot context)
- Notification event catalog implementation (semua events terdefinisi di atas)
- Data export: CSV/PDF untuk dashboard, scheduled weekly report ke admin email

Fase 6: ML Enhancement dan Advanced Analytics

- Collect training data dari completed projects
- Fine-tune GPT-4o-mini untuk project scoping chatbot
- Train CatBoost model untuk worker-project matching (LightGBM sebagai benchmark comparison)
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
docker compose up -d  # PostgreSQL 17 + PgBouncer + Redis 7 + NATS + MinIO + OpenObserve + Traefik + TensorZero + Ollama + Centrifugo + Temporal + Langfuse + Uptime Kuma + Flagsmith

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
bun run test          # unit + integration (Vitest)
bun run test:e2e      # end-to-end (Playwright)

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

# AI (via TensorZero)
TENSORZERO_API_URL=http://localhost:3333
OPENAI_API_KEY=sk-...
OLLAMA_URL=http://localhost:11434

# LLM Observability
LANGFUSE_URL=http://localhost:3100
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...

# Storage
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=bytz-uploads

# Payment (Midtrans sandbox)
MIDTRANS_SERVER_KEY=SB-Mid-server-...
MIDTRANS_CLIENT_KEY=SB-Mid-client-...

# Email
RESEND_API_KEY=re_...

# Observability
OPENOBSERVE_URL=http://localhost:5080
OPENOBSERVE_USER=root@bytz.io
OPENOBSERVE_PASSWORD=bytz-dev

# Real-time Transport
CENTRIFUGO_URL=http://localhost:8000
CENTRIFUGO_API_KEY=centrifugo-api-key
CENTRIFUGO_SECRET=centrifugo-secret

# Workflow Orchestration
TEMPORAL_URL=localhost:7233
TEMPORAL_NAMESPACE=bytz

# Feature Flags
FLAGSMITH_URL=http://localhost:8002
FLAGSMITH_SERVER_KEY=...

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
- KTP/identity verification untuk worker (e-KTP OCR verification)
- Consolidated monthly invoicing untuk enterprise clients
- Client qualification/onboarding questionnaire (budget readiness, technical literacy)
- Worker portfolio showcase (visual gallery, live demo links)
- Transparent pricing calculator (public-facing estimation tool sebelum signup)
- Geographic/timezone intelligence (match worker berdasarkan timezone overlap)
- Dark mode (arsitektur semantic tokens sudah disiapkan di Fase 1)

### Software Architecture Decisions

Microservice Architecture: Backend didesain sebagai microservices terpisah dengan bounded context yang jelas. Semua service dijalankan di Docker Compose. Setiap service adalah Hono app independen (kecuali AI Service yang pakai FastAPI/Python). Komunikasi async via NATS, sync via REST melalui Traefik API Gateway.

Kenapa microservice sejak awal: platform perlu extensible ke domain engineering lain di masa depan. Penambahan domain baru (misal: Civil Engineering Service) hanya perlu service baru tanpa mengubah service existing. Juga memungkinkan scaling independen per service (AI Service bisa di-scale terpisah karena resource-intensive).

Clean Architecture layers per service: Route -> Service -> Repository (Drizzle). Route handler tidak boleh langsung query database. Service tidak boleh tahu tentang HTTP request/response.

Event-driven: NATS sebagai message broker untuk decouple operasi antar service. Setiap state change yang relevan di-publish sebagai event.

Saga Pattern: untuk transaksi yang span multiple services (payment -> project status -> notification), menggunakan choreography-based saga via NATS events.

CQRS: Diimplementasikan bertahap. Tahap 1 pakai materialized views untuk dashboard metrics (refresh via pg_cron). Tahap 2 tambahkan read replica untuk read-heavy queries (dashboard, analytics, reporting). Tahap 3 full CQRS dengan denormalized read model dari NATS events. Detail lengkap di bagian Arsitektur Data Lengkap.

## Project Health Scoring

Setiap proyek aktif punya health score (0-100) yang dihitung otomatis. Ditampilkan di admin dashboard dan client project detail.

### Komponen Health Score

```
health_score = (timeline_score * 0.35) + (milestone_score * 0.30) + (communication_score * 0.20) + (budget_score * 0.15)
```

- **timeline_score** (0-100): berdasarkan perbandingan actual progress vs planned progress di Gantt chart. 100 = on track atau ahead, 0 = sangat terlambat
- **milestone_score** (0-100): persentase milestones yang approved on time. Revision requests dan rejected milestones menurunkan skor
- **communication_score** (0-100): berdasarkan response time rata-rata di chat (worker dan client). 100 = < 4 jam, 0 = > 72 jam tanpa respons
- **budget_score** (0-100): berdasarkan actual spending vs budget. 100 = on budget, turun jika ada banyak revision fees atau change requests

### Health Status

- 80-100: Healthy (hijau)
- 60-79: At Risk (kuning) — admin gets notification
- 40-59: Critical (oranye) — admin must intervene
- 0-39: Emergency (merah) — admin + client notified, proyek mungkin perlu di-pause

Team project: health score dihitung per worker (per work package) DAN aggregate. Jika satu worker critical tapi yang lain healthy, overall score turun tapi tidak sepenuhnya red.

## Notification Event Catalog

Setiap notification type memiliki: trigger event, recipients, channel (in-app, email, atau both), dan template.

### Client Notifications

| Event                            | Channel        | Template Key                         |
| -------------------------------- | -------------- | ------------------------------------ |
| BRD ready for review             | email + in-app | notification.brd_ready               |
| PRD ready for review             | email + in-app | notification.prd_ready               |
| Worker recommended (matching)    | in-app         | notification.worker_matched          |
| Team formation complete          | email + in-app | notification.team_complete           |
| Milestone submitted              | email + in-app | notification.milestone_submitted     |
| Milestone auto-released (14 day) | email + in-app | notification.milestone_auto_released |
| Worker overdue                   | in-app         | notification.worker_overdue          |
| Project completed                | email + in-app | notification.project_completed       |
| Dispute update                   | email + in-app | notification.dispute_update          |
| Payment confirmed                | email          | notification.payment_confirmed       |
| Refund processed                 | email          | notification.refund_processed        |

### Worker Notifications

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
| Worker inactive 7 days     | in-app  | notification.admin_worker_inactive    |
| DLQ event failed           | in-app  | notification.admin_dlq_failed         |
| High-value project created | in-app  | notification.admin_high_value_project |

## Structured Deliverable Management

Setiap milestone submission memiliki deliverable checklist yang didefinisikan di PRD:

- PRD AI generate daftar expected deliverables per milestone (misal: "API endpoint documentation", "Unit test coverage > 80%", "Figma design file")
- Worker harus checklist setiap deliverable saat submit milestone
- Client review berdasarkan checklist (bisa approve partial — "desain OK tapi dokumentasi kurang")
- Deliverable types: code (Git repo/branch), document (PDF/Figma/Google Docs link), file (uploaded artifact), demo (URL)
- File attachments via milestone_files table (sudah ada)
- Deliverable metadata disimpan di milestones.metadata (JSONB): `{ deliverables: [{ title, type, expected, submitted_url, status }] }`

## Performance Requirements

### Response Time Targets

- Page load (initial): < 2 detik (P95)
- API response (CRUD): < 200ms (P95)
- API response (with DB query): < 500ms (P95)
- AI chatbot first token: < 1 detik (P95)
- AI BRD/PRD generation: < 60 detik (streaming dimulai < 3 detik)
- Search (worker matching): < 500ms (P95)
- File upload (CV, 5MB): < 5 detik
- WebSocket message delivery: < 100ms

### Throughput Targets

- Concurrent users: 500
- API requests: 1000 req/menit
- WebSocket connections: 200 concurrent
- AI requests: 50 req/menit (bottleneck: OpenAI rate limits)
- Background jobs: 100 jobs/menit (pg-boss)

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

- Coverage target: 80% untuk business logic (service layer), tidak perlu 100%
- Focus: service layer functions, utility functions, Zod schema validation, state machine transitions
- Mock: external services (AI, payment gateway, NATS), database (drizzle mock atau in-memory SQLite)
- Naming: `{module}.test.ts` adjacent to source file

### Integration Tests (Vitest)

- Test service + database interaction (real PostgreSQL via testcontainers atau Docker)
- Test NATS event publishing dan consuming
- Test API endpoints end-to-end per service (HTTP request → response)
- Database: fresh schema per test suite (parallel test isolation)

### E2E Tests (Playwright)

- Critical user flows:
  1. Client: register → create project → chat → BRD review → approve → pay
  2. Worker: register → upload CV → browse projects → apply → get matched
  3. Project: matching → contract → milestone submit → approve → payment release
  4. Team: PRD with team → team formation → multi-worker milestone → completion
  5. Admin: dashboard → manage dispute → resolve
- Run against staging environment atau local Docker Compose
- Visual regression: Playwright screenshot comparison

### Contract Tests (Pact)

- Consumer-driven: frontend defines expected API shapes, backend verifies
- Inter-service: Project Service defines expected Auth Service responses, Auth Service verifies
- Run in CI — fail build if contract broken

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
- Rate Limiting: per IP + per user via Redis
- Secrets: environment variables, never committed to repo

### Additional Mitigations (Implement)

- Content Security Policy (CSP) header: restrict script sources
- Helmet middleware untuk Hono: set security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Payment webhook signature verification: Midtrans menggunakan SHA512 signature (server_key + order_id + status_code + gross_amount), Xendit menggunakan webhook token verification. Verifikasi WAJIB di Payment Service sebelum proses webhook event
- AI prompt injection defense: system prompt hardening, input sanitization before LLM call, output validation
- Regular dependency audit: Trivy + Grype scanning in CI (container + dependency vulnerabilities), Dependabot/Renovate for auto-updates
- SSRF protection: internal service endpoints not accessible via API gateway (Traefik routing rules)
