# Audit jalur uang dan flow proyek, Midtrans sandbox

Branch `fix/payout-path`. Semua pernyataan di bawah diverifikasi terhadap kode
yang berjalan atau terhadap test yang merah saat implementasinya dirusak.

## 1. Tujuan uang talenta saat dapat proyek

Sebelumnya tidak ada. `ReleaseEscrow` menulis baris ledger dan tidak ada kolom
di mana pun yang menyimpan ke mana uang dikirim, jadi "payout released" berarti
saldo berpindah antar dua baris di database sendiri sementara kasnya duduk di
akun settlement gateway.

Sekarang `talent_profiles` membawa `payout_channel`, `payout_provider`,
`payout_account_number`, `payout_account_holder_name`, `payout_verified_at`
(migrasi 0039).

Bukan bank saja. Midtrans dan Xendit mencairkan ke e-wallet dengan bentuk yang
sama seperti bank, yaitu kode provider plus identifier akun, jadi kolomnya
membawa bentuk itu. `payout_channel` menentukan validasi: bank adalah digit
rekening, e-wallet adalah nomor telepon terdaftar. Provider yang diterima:
bca, bni, bri, mandiri, permata, cimb, danamon, bsi, gopay, ovo, dana,
shopeepay, linkaja.

Nomor e-wallet dinormalisasi ke satu bentuk kanonik (08x, +62x, 62x menjadi
62x). Tanpa itu satu orang memegang tiga tujuan berbeda dan rekonsiliasi tidak
mungkin.

Nomor akun di-mask ke empat digit terakhir bahkan untuk talenta sendiri; tulis
tetap menerima nomor penuh. Sesi yang dicuri tidak boleh bisa memanen nomor
rekening.

`payout_verified_at` adalah GERBANG, bukan tanggal untuk ditampilkan. Selama
null, akun itu tidak dibayar: pencairan ke nomor yang belum dicocokkan dengan
nama pemiliknya adalah transfer ke digit yang diketik orang asing. Menulis
rekening baru mengosongkannya kembali.

Kapan diminta: bukan saat registrasi, melainkan saat menerima proyek.
`assertPayoutDestination` di jalur accept menolak dengan
`TALENT_PAYOUT_ACCOUNT_REQUIRED` kalau belum ada. Gerbangnya memeriksa
KEBERADAAN, bukan `payout_verified_at`, karena verifikasi adalah jawaban
gateway yang datang belakangan dan memblokir accept di situ berarti memblokir
talenta atas sesuatu yang bukan urusannya.

## 2. Pembagian uang

Owner membayar PENUH. Escrow menahan gross. Fee dipisah HANYA saat release.

Alur uangnya, tiga leg dalam satu transaksi (dua kalau fee nol):

1. Webhook Midtrans settled: DEBIT escrow proyek sebesar gross, CREDIT akun owner
2. Milestone disetujui: CREDIT escrow sebesar gross, DEBIT akun payout talenta
   sebesar talent share, DEBIT akun revenue platform sebesar fee

Contoh yang benar-benar dijalankan flow test: proyek Rp 10 juta, dua work
package Rp 5 juta. Bracket dipilih SEKALI di level proyek dari total, yaitu
bracket <= Rp 10 juta yang memberi talenta 71,5%. Milestone Rp 5.000.000 rilis
sebagai `amount` 5.000.000 dan `feeAmount` 1.425.000; yang diterima talenta
adalah selisihnya, 3.575.000.

Ini yang penting dan sempat saya salah baca sendiri: request ke payment-service
membawa GROSS plus fee, bukan net. Net adalah selisih. Test menegaskan
identitasnya, bukan angkanya sendiri-sendiri.

Yang TIDAK dibukukan, dan ini harus disadari sebelum produksi: biaya gateway.
Escrow dikredit sebesar gross sementara Midtrans menyetorkan gross dikurangi
MDR. Liability escrow benar, kas yang benar-benar ada lebih kecil, dan
selisihnya beban tanpa akun. Payload webhook Midtrans tidak membawa fee sama
sekali; ia dilaporkan di settlement report. Jalan yang benar adalah rekonsiliasi
terhadap laporan itu, bukan leg di webhook, dan itu belum dikerjakan. Di bracket
<= Rp 3 juta yang menyisakan 18,5% untuk platform, MDR 2% adalah lebih dari
sepersepuluh margin.

## 3. Angka yang tampil di project finder

Yang tampil adalah ANGGARAN OWNER, bukan yang diterima talenta. Sebelumnya
angka itu tampil tanpa label sama sekali, yang membuat talenta wajar mengira
itu bayarannya.

Sekarang diberi label `Anggaran pemilik` dan daftar itu membawa satu catatan di
atasnya bahwa payout dikutip saat penawaran.

Payout TIDAK BISA diturunkan saat browsing, dan ini bukan kemalasan: bracket
berlaku atas `final_price = sum(work_packages.amount)`, dan work package baru
ada setelah PRD. Proyek yang sedang dicari talenta belum tentu punya PRD. Angka
payout yang dikarang di halaman browse akan meleset begitu PRD memecah scope.

## 4. Flow ujung ke ujung, dua talenta dalam satu proyek

`apps/project-service/src/routes/project-flow.integration.test.ts`, 15 test,
Postgres sungguhan, route handler sungguhan, state machine sungguhan. Yang
di-stub hanya payment-service di batas fetch.

Yang dibuktikan, berurutan:

- proyek mencapai `matched` hanya setelah KEDUA talenta menerima
- kontrak NDA dan IP transfer terbit untuk tiap talenta saat tim lengkap
- thread privat per talenta plus satu thread grup terbuka saat tim lengkap,
  dengan keanggotaan yang benar
- `in_progress` ditolak sampai setiap perjanjian ditandatangani kedua pihak
- submit, tolak, lanjut, submit ulang, setujui
- pembagian gross/fee/net saat release
- kedua milestone talenta independen
- talenta tidak bisa menyetujui milestone sendiri
- talenta tidak bisa menyentuh milestone talenta lain
- proyek masuk `review` setelah keduanya selesai
- owner tidak menjawab: auto-release membayar talenta
- milestone yang baru disubmit dibiarkan untuk owner
- accept ditolak kalau talenta belum punya tujuan pencairan
- decline membuka kembali package itu saja, yang lain tetap terisi
- assignment tetap hidup dan tertandatangani setelah pekerjaan mulai

Di mana test ini berhenti, dan kenapa: ia berakhir di "ledger menyatakan
talenta berhak dibayar", BUKAN "talenta memegang uangnya". Disbursement yang
benar-benar memindahkan kas butuh Midtrans Payouts, yang perlu persetujuan yang
tidak bisa didapat di sandbox. Test yang dinamai "talenta menerima uang" akan
menegaskan pembukuan sambil mengklaim perbankan.

## 5. Fasilitas chat

Ini temuan terbesar sesi ini dan sebelumnya tidak pernah disebut.

Tipe percakapan DEKORATIF, persis seperti `contracts` sebelum diperbaiki. Enum
ada, tabel ada, dokumen menjelaskannya, dan tidak ada satu baris pun yang
membuatnya. `createConversation` punya tepat satu pemanggil, sebuah route yang
tidak pernah di-POST frontend mana pun. Jadi proyek yang sudah matched tidak
punya thread apa pun: owner dan talenta yang baru menandatangani perjanjian
tidak punya tempat bicara, sementara ToS melarang bicara di luar platform.

Lebih dalam lagi: thread AI scoping ditulis TANPA satu pun baris peserta. Kedua
route chat mengotorisasi lewat keikutsertaan, dan `GET /conversations` MEMANG
query peserta itu. Akibatnya halaman Pesan kosong untuk SETIAP pengguna
platform ini, dan riwayat scoping hilang di setiap reload: klien mencari
threadnya lewat daftar itu, tidak menemukan apa-apa, lalu merender percakapan
kosong tanpa error apa pun.

Perbaikannya mengikuti pola yang sudah ada, bukan pola baru.
`ensureProjectConversations` dipanggil di dua call site yang sama dengan
`ensureProjectContracts`. Satu thread privat per assignment, satu thread grup
begitu proyek membawa lebih dari satu talenta. Keanggotaan diperbaiki di setiap
pemanggilan, jadi thread lama sembuh sendiri tanpa migrasi backfill. Idempoten
lewat dua partial unique index, dengan `assignment_id` sebagai jangkar thread
privat.

`talent_talent` sengaja TIDAK dibuat: satu thread per pasangan, tanpa UI dan
tanpa pemanggil.

Ikut ditutup di route yang sama: `participantIds` tidak divalidasi sama sekali.
Gerbangnya hanya memeriksa pemanggil, jadi owner bisa mendudukkan id pengguna
mana pun dan menyerahkan seluruh thread proyek ke orang asing.

## 6. Keterlambatan dan laporan

`milestone.overdue` dan `milestone.due_soon` punya consumer, template
notifikasi, dan baris di katalog notifikasi, dan NOL publisher di seluruh
monorepo. `due_date` ditulis saat milestone dibuat lalu dibaca hanya untuk
menilai on-time rate talenta SETELAH faktanya. Talenta yang melewati tenggat
tidak diberi tahu apa pun; owner mengetahuinya dengan cara melihat sendiri.
Grace period 7 hari sebelum owner boleh mengajukan dispute tidak punya penanda
kapan ia mulai.

`MilestoneDeadlineSweepService` sekarang berjalan tiap jam di bawah advisory
lease, mengikuti pola sweep yang sudah ada. Sweep, bukan timer Temporal: due
date adalah properti baris dan bisa diubah, jadi bertanya ke tabel apa yang
telat SEKARANG benar, sementara timer yang dijadwalkan saat pembuatan akan
menyala terhadap tanggal yang sudah pindah.

Penanda "sudah diperingatkan" ada di baris milestone, bukan di
notification-service, karena idempotency store di sana degrade ke no-op saat
Valkey tidak terjangkau dan sweep tiap jam tanpa penanda akan memberi tahu
talenta bahwa ia telat setiap jam sampai proyek selesai. Dua penjaga
independen, query kandidat dan compare-and-swap pada penanda; test merah kalau
keduanya dihapus.

Dua angka bertabrakan di CLAUDE.md, tiga hari di satu katalog dan tujuh hari di
katalog lain. Tujuh menang karena tujuh adalah angka yang sudah dikatakan
salinan consumer kepada talenta.

Notifikasi overdue sekarang mengabari DUA pihak. Sebelumnya hanya talenta,
padahal owner-lah yang jam grace period-nya berjalan.

Dispute: route-nya ada dan proses tiga tahapnya jalan, tapi ada batas keras
yang harus diketahui. Escrow disetor SEKALI di level proyek, bukan per work
package, jadi dispute yang di-scope ke satu work package TIDAK bisa direfund.
`DisputeService` melempar `DISPUTE_SCOPE_UNSUPPORTED` alih-alih diam-diam
merefund seluruh proyek atau menandai dispute resolved tanpa memindahkan uang.
Untuk proyek tim yang salah satu talentanya gagal, itu berarti dispute per
talenta bisa DIBUKA tapi tidak bisa DISELESAIKAN dengan refund. Memperbaikinya
berarti membuat deposit membawa work_package_id, yaitu perubahan pada
`CreateSnapToken` dan alur pembayaran owner, dan itu keputusan produk yang
belum diambil.

## 7. TNC, perjanjian, tanda tangan sebelum deal

Ada sekarang; sebelumnya tabel `contracts` hanya memuat baris yang ditulis test.

`ensureProjectContracts` menerbitkan DUA perjanjian per talenta saat tim
lengkap: `standard_nda` dan `ip_transfer`. Klausulnya disimpan di baris itu
sendiri, bukan dirujuk ke versi template, karena template yang diedit belakangan
tidak boleh diam-diam mengubah apa yang sudah ditandatangani dua orang.

Tanda tangan menggerbangi `in_progress`. Owner yang mencoba memulai pekerjaan
sebelum semua pihak menandatangani mendapat `CONTRACT_NOT_SIGNED` beserta
daftar posisi mana yang ditunggu, bukan penolakan buta. Baris kontrak yang
hilang dihitung sebagai BELUM ditandatangani, bukan sebagai tidak ada yang
perlu ditandatangani.

## 8. Kategori status: redundansi dan ambiguitas

Empat enum status berlaku bersamaan: `projects.status` (18),
`milestones.status` (6), `work_packages.status` (7),
`project_assignments.acceptance_status` (3) dan `.status` (4). Overlapnya
disengaja dan sehat, karena masing-masing menjawab pertanyaan berbeda. Yang
bermasalah adalah LABEL yang dibaca owner dan talenta, bukan enumnya.

Sudah diperbaiki:

- `revision_fee_required` masih mengatakan "Dua revisi gratis sudah terpakai"
  padahal jatahnya sudah tiga. Angkanya dihapus dari kalimat supaya konstanta
  bisa berubah lagi tanpa meninggalkan tempat kedua untuk diingat.

Belum diubah karena mengubah teks yang dilihat pengguna adalah keputusan
produk, dan ini yang saya minta putusannya:

1. `Ditolak` lawan `Revisi Diminta`. Setelah perbaikan sesi ini keduanya
   mengembalikan milestone ke `in_progress` dan keduanya memakai jatah putaran
   yang sama. Dari layar talenta keduanya adalah keadaan yang sama dengan dua
   nama; satu-satunya beda nyata adalah admin ikut diberi tahu pada penolakan.
   Usul: `Ditolak, ditinjau admin` lawan `Revisi diminta`. Kalau tidak, jujur
   saja bahwa bedanya tipis dan pertimbangkan menyatukan keduanya.

2. `Pencocokan` lawan `Tercocokkan`. Dua kata yang nyaris sama untuk dua state
   berurutan, dan owner tidak bisa membedakannya sekilas. Usul:
   `Mencari talenta` lawan `Tim terbentuk`.

3. `Tinjauan` untuk `projects.status = review` bertabrakan dengan `Diajukan`
   pada milestone di layar yang sama. Usul: `Tinjauan akhir`.

4. `in_progress` punya dua kunci i18n dengan nilai identik (`in_progress` dan
   `status_in_progress`). Redundansi, bukan bug.

## 9. Edge case

### Talenta mendaftar tanpa CV

Sudah diperbaiki, dan lubangnya lebih besar daripada yang terlihat. Matching
SUDAH menolak merekomendasikan talenta yang belum `verified`, tapi jalur lamaran
mandiri tidak memeriksa apa pun tentang talenta: tidak CV, tidak status
verifikasi. Jadi satu-satunya jalur yang bisa ditempuh talenta sendiri juga
satu-satunya jalur yang memutari vetting. Profil kosong bisa melamar, dan owner
bisa menerimanya menjadi assignment.

Daftar akun tanpa CV tetap boleh. Menjelajah proyek tetap boleh. Garisnya
ditarik di tempat platform mulai membuat janji tentang seseorang, yaitu saat
melamar: `TALENT_CV_REQUIRED` kalau belum ada CV, `TALENT_NOT_VERIFIED` kalau CV
masih diparsing atau akunnya disuspend.

Dashboard talenta mengatakan alasannya SEBELUM diklik, bukan gagal saat diklik,
dengan tautan ke profil. Tombol yang hanya gagal saat ditekan tidak mengajarkan
apa pun.

Satu hal yang SENGAJA tidak ikut digerbangi: `availability_status`. Matching
menyaring kandidat pada `verified` DAN `available`, sementara lamaran mandiri
hanya menuntut yang pertama. Itu bukan kelalaian. Verifikasi adalah penilaian
platform tentang seseorang, jadi ia berlaku di kedua jalur. Ketersediaan adalah
pernyataan talenta tentang kalendernya sendiri, dan seseorang yang menandai
dirinya sibuk lalu tetap melamar sedang memberi sinyal yang lebih baru daripada
tanda itu. Platform tidak menawarkannya pekerjaan; ia boleh memintanya.

### Melamar ke proyek yang tidak terbuka

Sudah diperbaiki. Lamaran mendarat di proyek berstatus draft, cancelled, dan
completed, karena tidak ada yang membandingkan status dengan dua status yang
memang ditampilkan daftar browse. `OPEN_TO_TALENT_STATUSES` sekarang menyebut
pasangan itu sekali alih-alih tiga tempat menuliskannya ulang. Proyek yang
sudah soft-delete juga dibaca sebagai tidak ada di sini, sama seperti route
project lainnya.

### Formulir pengajuan proyek yang belum lengkap

Dua hal berbeda, dan keduanya sudah diperbaiki.

Pertama, `budgetMax` boleh lebih kecil daripada `budgetMin` di schema. Wizard
memeriksanya dan constraint `projects_budget_range` memeriksanya; schema di
antara keduanya tidak. Pemanggil yang langsung ke API mengubah 400 menjadi
pelanggaran constraint yang muncul sebagai 500. Validasi yang hanya ada di
browser bukan validasi, dan ini kelas kesalahan yang sama dengan batas ukuran
unggahan yang sudah dicatat CLAUDE.md.

Kedua, draft dari formulir publik DIHAPUS saat render pertama wizard.
`loadDraftFromStorage` memanggil `removeItem` di badan render, jadi draft-nya
mati sebelum owner sempat menyentuh apa pun. Owner yang mengisi formulir publik,
mendaftar, lalu berpindah halaman sebentar kembali ke formulir kosong tanpa
jalan memulihkan apa yang sudah diketik. Sekarang draft bertahan sampai proyeknya
benar-benar dibuat, yaitu titik ketika ia memang sudah dikonsumsi.

### Owner terlambat membayar

Diperbaiki separuh, dan separuhnya memang sengaja.

Urutannya perlu diluruskan dulu: escrow dibayar SEBELUM matching, bukan setelah.
Owner menyetujui PRD, membayar, dan pembayaran itulah yang memindahkan proyek ke
`matching`. Jadi ada dua keterlambatan owner yang berbeda:

1. Owner menyetujui PRD lalu tidak pernah membayar. Proyek duduk di
   `prd_approved` selamanya. Tidak ada uang yang berisiko, tapi juga tidak ada
   pengingat dan tidak ada yang menutupnya.
2. Owner sudah membayar, proyek `matched`, lalu pekerjaan tidak pernah dimulai.
   CLAUDE.md menjanjikan pembatalan otomatis plus pengembalian escrow setelah 30
   hari. Tidak ada job yang melakukannya. Kelas yang sama persis dengan
   `milestone.overdue`, yaitu janji tanpa pelaksana.

Yang KETIGA, owner tidak menjawab milestone yang sudah disubmit, sudah tertangani
dan teruji: auto-release 14 hari membayar talenta.

`ProjectStartSweepService` sekarang memperingatkan owner DAN setiap admin lewat
`project.start_overdue` untuk kasus nomor 2. Ia tidak membatalkan dan tidak
merefund: memindahkan uang owner di atas timer tanpa satu pun manusia menekan
apa pun adalah keputusan produk, dan Anda memilih peringatan dulu dengan
pembatalan manual. Diukur dari baris `project_status_logs` yang memasukkan
proyek ke `matched`, bukan dari `updated_at`, supaya proyek yang terus disunting
tidak mengulang tenggatnya sendiri.

Kasus nomor 1 (setuju PRD lalu tidak bayar) masih tanpa pengingat.

## 10. Kategori status, lanjutan

Tiga label diganti sesuai keputusan Anda, dan satu tabrakan yang lebih buruk
ketahuan saat mengerjakannya.

- `Ditolak` menjadi `Ditolak, ditinjau admin`. Setelah perbaikan sesi ini,
  penolakan dan permintaan revisi sama-sama mengembalikan milestone ke
  `in_progress` dan sama-sama memakai jatah putaran, jadi dari layar talenta
  keduanya satu keadaan dengan dua nama. Yang membedakan hanya admin ikut
  dikabari, dan sekarang labelnya mengatakan itu
- `Pencocokan`/`Tercocokkan` menjadi `Mencari talenta`/`Tim terbentuk`
- `Tinjauan` menjadi `Tinjauan akhir`

Yang ketiga membuka masalah yang lebih besar: `status_review` dipakai DUA arti
sekaligus. `projects.status = 'review'` adalah tinjauan akhir owner atas
pekerjaan yang sudah selesai, sementara `brd_documents.status = 'review'` dan
`prd_documents.status = 'review'` adalah dokumen yang menunggu dibaca. Keduanya
membaca kunci i18n yang sama dan merender kata yang sama, kadang di halaman yang
sama. Dokumen sekarang punya set `doc_status_*` sendiri.

Pemisahan itu sekaligus menutup badge yang mencetak kunci mentah:
`status_paid` tidak ada di kedua locale, jadi badge yang memberi tahu owner
bahwa pembayarannya masuk terbaca sebagai literal `status_paid`. Test-nya
mencatat itu sebagai temuan; temuannya sekarang tertutup.

## 11. Sisi admin

Lima kontrol di halaman settings menulis `matching_weights`,
`exploration_rate`, `auto_release_days`, `free_revision_rounds`, dan
`max_team_size` ke `platform_settings`, dan tidak ada engine yang membaca tabel
itu: semua service membaca konstanta hasil kompilasi. Operator bisa menurunkan
jendela auto-release, melihatnya tersimpan, dan melihat milestone tetap rilis di
angka lama.

Lebih buruk daripada diam: admin-service menulis baris `admin_audit_logs`
bertipe `config.update` untuk setiap penyimpanan, jadi jejak audit mencatat
perubahan kebijakan yang tidak pernah berlaku. Baris tersimpan
`free_revision_rounds` masih 2 lama setelah konstantanya menjadi 3, dan konsol
menampilkannya sebagai kebijakan yang berlaku.

Sekarang halaman itu READ-ONLY dan membaca konstanta, sama seperti tabel bracket
fee yang sudah lebih dulu ditangani begitu. Membuat engine membaca tabel adalah
alternatifnya dan itu FITUR, bukan perbaikan: butuh cache, fallback saat baris
tidak ada, dan invalidasi lintas replika di tiga service.

Menutup UI saja tidak cukup. `PATCH /api/v1/admin/settings/:key` tetap menerima
sesi admin mana pun dan tetap menulis audit log, jadi jalur API masih bisa
mencatat kebijakan palsu. Keenam kunci milik engine sekarang dijawab 422
`SETTING_ENGINE_OWNED`. Menolak, bukan diam-diam membuang tulisannya, dengan
alasan yang sama seperti `DISPUTE_SCOPE_UNSUPPORTED`.

## 12. Dispute per work package

Sudah bisa direfund. Premis penolakan yang lama SALAH, dan itu bagian yang
penting: ia mengasumsikan refund per package butuh baris deposit yang membawa
package itu, dan karena escrow disetor sekali per proyek, baris itu tidak
pernah ada. Tapi refund hanya butuh nominal dan tujuan, bukan deposit yang
cocok.

Nominalnya adalah harga package dikurangi milestone package itu yang sudah
di-approve owner, karena milestone yang di-approve sudah keluar dari escrow dan
membayar talenta. Refundnya tetap disebar ke deposit proyek dan tetap dibatasi
saldo yang benar-benar ditahan, jadi uang rekan setim tidak bisa ikut ditarik.
Tidak ada migrasi, dan alur bayar owner tidak berubah.

Alternatifnya, deposit per work package, DITOLAK: owner akan checkout N kali
alih-alih sekali, tiap transaksi kena MDR sendiri sehingga justru memperburuk
celah biaya gateway, dan proyek bisa berakhir separuh terdanai.

`DISPUTE_SCOPE_UNSUPPORTED` masih dipakai untuk satu hal yang masih benar:
package yang tidak berada di proyek itu.

## 13. Biaya gateway (MDR)

TIDAK diperbaiki, dan sengaja tidak dipaksakan. Escrow dikredit sebesar gross
sementara Midtrans menyetorkan gross dikurangi MDR, jadi liability escrow benar
tapi kas yang benar-benar ada lebih kecil, dan selisihnya beban tanpa akun.
Margin sesungguhnya lebih kecil daripada yang dinyatakan tabel bracket; di
bracket <= Rp 3 juta yang menyisakan 18,5%, MDR 2% adalah lebih dari
sepersepuluh margin.

Kenapa tidak dikerjakan sekarang, dengan jujur: payload webhook Midtrans tidak
membawa fee sama sekali. Ia dilaporkan di settlement report, yang butuh akses
yang tidak dimiliki sesi ini. Dua jalan pintas yang tersedia dua-duanya salah.
Membukukan fee dari tabel tarif yang dipelihara tangan adalah persis pola yang
sudah menyimpang dua kali di repo ini (tarif biaya AI menetap di angka
gemini-2.5-flash berbulan-bulan setelah inferensi pindah ke GLM). Menambahkan
akun kas dan akun expense tanpa ada yang menulisinya adalah persis kelas cacat
yang dihapus sepanjang sesi ini: kontrak dekoratif, tipe percakapan dekoratif,
tuas settings dekoratif.

Jalan yang benar adalah rekonsiliasi terhadap settlement report, dan langkah
pertamanya bukan kode melainkan akses ke laporan itu.

## Yang tetap terbuka, dan kenapa

- Dispute per work package tidak bisa direfund sampai deposit membawa
  work_package_id. Keputusan produk, menyentuh alur bayar owner.
- Biaya gateway tidak dibukukan. Butuh rekonsiliasi settlement report, bukan
  tambahan leg di webhook.
- Pencairan sesungguhnya ke rekening talenta tidak bisa diuji: Midtrans Payouts
  butuh persetujuan yang tidak tersedia di sandbox. Semua yang di sisi ini dari
  batas itu sudah diuji.
- `talent_talent` chat tidak dibuat, sengaja.
- Tenggat dan dispute belum digabung: sweep menandai keterlambatan, tapi tidak
  ada yang otomatis membuka dispute setelah grace period. Itu memang harus
  tindakan owner, tapi belum ada tombol yang muncul saat gracenya lewat.
- Pembatalan otomatis proyek yang diam 30 hari di `matched`, beserta refundnya.
  Anda memilih peringatan dulu dengan pembatalan manual, dan itu yang dibangun.
- Pengingat untuk owner yang menyetujui PRD lalu tidak membayar. Aman dikerjakan
  (hanya notifikasi), belum dikerjakan.
- Biaya gateway. Terhalang akses settlement report, bukan terhalang kode.
- Tombol dispute yang muncul untuk owner begitu grace period milestone lewat.
  Sweep sudah menandai keterlambatannya; UI-nya belum menawarkan tindakan.

## Verifikasi

project-service, apps/web, payment-service, notification-service, admin-service
seluruh suite; `tsc --noEmit`; `gofmt -l`; `bun run arch`. Semua gerbang baru
diverifikasi lewat mutasi, yaitu implementasinya dirusak dan test-nya dipastikan
merah.
