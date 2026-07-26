# KerjaCUS! Final Submission

## Final Solution Title

KerjaCUS!: Managed Marketplace Berbasis AI untuk Digitalisasi Penciptaan Lapangan Kerja

## Problem Statement

Peningkatan Produktivitas, Ketahanan Pangan, dan Penciptaan Lapangan Kerja

## Sub-Problem Statement

Digitalisasi Penciptaan Lapangan Kerja

## Final Team Composition

Bryan Philinathaniel Hutagalung (Ketua), Lead Software Engineer. Memimpin arsitektur microservice, integrasi antarlayanan, dan pipeline AI: chatbot scoping, parsing CV, serta generasi BRD dan PRD.

Shazya Audrea Taufik, Analis dan Software Engineer. Menangani analisis kebutuhan, pemodelan basis data relasional, serta pengembangan backend dan API.

Tamara Mayranda Lubis, Project Manager dan Business Strategist. Mengelola rencana kerja, validasi pasar, model bisnis, dan strategi kemitraan.

Yovanka Sandrina Maharaja, Product Designer dan Software Engineer. Merancang UI/UX yang aksesibel dan membangun antarmuka frontend.

## Final Solution Summary

KerjaCUS! adalah managed project marketplace berbasis AI yang membantu pemilik proyek nonteknis seperti UMKM, startup, dan individu mengubah ide mentah menjadi proyek digital yang siap dikerjakan talenta pemula.

Owner mengisi form bertahap dan berdiskusi dengan AI chatbot sampai kebutuhannya dinilai cukup lengkap. Sistem lalu menyusun BRD dan PRD berisi work package, dependensi tugas berbentuk DAG, critical path, estimasi jam kerja, kebutuhan tim satu sampai delapan orang, biaya, dan timeline.

CV talenta diubah menjadi profil keahlian, lalu dicocokkan lewat exact match, Jaro-Winkler, dan kemiripan semantik pgvector. Skor matching dirinci per komponen sehingga bisa diaudit, dengan 30 persen slot eksplorasi agar talenta baru tetap kebagian.

Proyek dikelola lewat kontrak digital, escrow per milestone, Gantt chart, dan time tracking. Platform sudah dideploy di kerjacus.id dan memangkas proses scoping dari hitungan hari menjadi menit.

## Progress and Change Log

Financial projection direvisi mengikuti perubahan produk dan rencana ke depan.

Validasi langsung ke pengguna. Dua owner dan dua talenta mencoba sendiri alur scoping dan onboarding CV di produksi. Temuan utamanya kualitas keluaran AI masih perlu ditingkatkan, dan itu jadi prioritas kalau ada tambahan modal.

Pengendalian biaya AI. Layanan AI masih berjalan pada kuota trial. Setelah pengujian menunjukkan biaya token per proyek jadi variabel terbesar di unit economics, caching respons dan pemilihan model bertingkat masuk rencana kerja, tapi belum terpasang.

Audit teknis menyeluruh. Seluruh service diaudit dan 1.998 pengujian otomatis lulus. Audit menemukan dan menutup beberapa celah nyata, di antaranya route yang memungkinkan owner menambah saldo escrow tanpa membayar, endpoint tanpa pemeriksaan otorisasi, dan kebocoran tautan kontak talenta sebelum deal.

## Validated User Problem and Evidence

Pengguna utama. Di sisi demand, pemilik proyek nonteknis: UMKM, startup, dan individu tanpa tim teknis. Di sisi supply, talenta digital pemula: mahasiswa tingkat akhir, fresh graduate, dan freelancer.

Situasi masalah. Owner ingin mengubah ide jadi proyek, tapi marketplace freelance mengharuskan dia menentukan deskripsi, ruang lingkup, anggaran, dan kebutuhan talenta sejak awal. Padahal dia belum tahu fitur apa yang dibutuhkan, berapa biaya wajarnya, atau kompetensi seperti apa yang harus dicari. Bagi talenta, masalahnya mencari dan melamar proyek tanpa tahu kecocokan keahlian, kredibilitas owner, dan kepastian pembayaran.

Penyebab dan dampak. Akarnya asimetri informasi dan rendahnya kepercayaan antara kedua sisi pasar, diperburuk ketiadaan mekanisme scoping terstandar, matching yang transparan, dan perlindungan transaksi. Akibatnya owner menghadapi deskripsi kabur, revisi berulang, biaya membengkak, risiko penipuan, sampai pembatalan proyek. Talenta membuang waktu untuk bidding, terjebak perang harga, sulit dapat proyek pertama, dan berisiko tidak dibayar.

Bukti. Wawancara dengan satu pemilik warung menunjukkan digitalisasi dianggap mahal, sulit dipahami, dan rawan penipuan. Satu talenta digital menyatakan sulit menemukan proyek tepercaya dengan pembayaran yang pasti. BPS mencatat sekitar 7,4 juta penganggur pada 2025 dan sekitar 33,34 juta pekerja lepas pada 2020. McKinsey lewat Manyika et al. (2016) menemukan hanya sekitar 15 persen pekerja independen memakai platform digital.

Perubahan sejak submission kedua. Awalnya masalah dipahami sebagai dua hal terpisah: owner tidak bisa menyusun proyek, dan talenta sulit dapat pekerjaan. Wawancara menunjukkan defisit kepercayaan di kedua sisi dan ketidakpastian sebelum transaksi sama pentingnya.

## End-to-End Use Case and Feature-to-Pain Mapping

Use case utama: UMKM membangun aplikasi pemesanan tanpa tim teknis.

Kondisi awal. Owner tahu pelanggannya harus bisa memesan online, tapi tidak tahu fiturnya apa saja, biaya wajarnya berapa, dan butuh berapa orang. Dia membuka proyek di platform freelance dan berhenti di kolom deskripsi dan anggaran.

Tindakan pengguna. Owner mendaftar, mengisi form bertahap, lalu menjawab pertanyaan chatbot: tujuan bisnis, calon pengguna, referensi aplikasi sejenis, batas anggaran, dan tenggat.

Proses sistem. Pertama, chatbot menggali kebutuhan sampai completeness score memadai. Kedua, sistem menghasilkan BRD lalu PRD terstruktur berisi daftar fitur, work package, dependensi antartugas, komposisi tim, estimasi harga per paket, dan timeline. Ketiga, proyek dipublikasikan dan mesin pencocokan menilai kandidat dengan formula tertimbang: skill 30 persen, pemerataan 35 persen, rekam jejak 20 persen, rating 15 persen, ditambah 30 persen slot eksplorasi untuk talenta baru. Keempat, skill hasil parsing CV dicocokkan ke taksonomi lewat exact match, Jaro-Winkler, lalu kemiripan semantik pgvector.

Output. Dokumen BRD dan PRD siap pakai, serta daftar rekomendasi talenta terurut beserta skor relevansi dan alasannya.

Tindakan lanjutan. Owner menyetujui kandidat, kontrak digital berupa NDA dan perjanjian HKI terbit, dana milestone pertama masuk escrow, pekerjaan berjalan dengan milestone board dan time tracking, lalu dana cair per milestone yang disetujui.

Pemetaan fitur ke pain point. Chatbot dan completeness score menjawab owner yang tidak tahu cara merumuskan kebutuhan. Generasi BRD dan PRD menjawab ruang lingkup kabur, revisi berulang, dan biaya tidak pasti. Parsing CV dan ekstraksi skill menjawab talenta yang sulit membuktikan kompetensi secara terstruktur. Matching berbobot dan epsilon-greedy menjawab lamaran tanpa kepastian dan cold-start talenta baru. Escrow per milestone dan double-entry ledger menjawab risiko tidak dibayar dan tidak dikerjakan. Milestone board dan time tracking menjawab progres yang tidak terpantau.

## Operational Context, Solution Boundary, and Adoption

Lingkungan penggunaan. KerjaCUS! diakses lewat browser tanpa instalasi, bisa dipakai lintas lokasi, dan sepenuhnya berbahasa Indonesia. Owner menyusun kebutuhan dan mendanai proyek. Talenta mengerjakan sesuai milestone. Admin menangani verifikasi, kurasi, pemantauan, dan penyelesaian sengketa. Payment gateway berlisensi mengelola penampungan dan pencairan dana. Kampus dan komunitas jadi mitra utama untuk memperoleh talenta awal.

Batas solusi. Sistem membantu menyusun spesifikasi proyek, merekomendasikan talenta, menerbitkan kontrak digital, mengelola escrow, dan mencatat transaksi. Sistem belum bisa menjamin kualitas hasil kerja secara otomatis, tidak menyimpan dana pengguna secara langsung, dan belum melayani proyek di luar bidang digital. Estimasi biaya dari AI tetap perlu divalidasi manusia sebelum dijadikan nilai kontrak.

Ketergantungan. Operasional bergantung pada persetujuan akun produksi Midtrans, kuota berbayar penyedia LLM, pendaftaran PSE Kominfo, kepatuhan UU PDP Nomor 27 Tahun 2022, serta kerja sama kampus dan komunitas.

Hambatan adopsi. Perbedaan literasi digital ditangani lewat alur bertahap, chatbot berbahasa Indonesia, dan pendampingan langsung. Kepercayaan dibangun lewat verifikasi pengguna, kontrak digital, dan escrow. Kebiasaan memakai platform lama ditangani lewat pilot terbatas di komunitas kampus dan pendampingan pada proyek pertama. Risiko biaya awal ditekan lewat pembayaran per milestone, jadi owner tidak perlu membayar seluruh nilai proyek sebelum pekerjaan selesai.

## Innovation Level

Level 3: Prototype, Validasi, atau Implementasi Awal. KerjaCUS! sudah dideploy dan bisa diakses publik lewat kerjacus.id. Alur end-to-end dari scoping AI sampai escrow sudah berjalan dengan input aktual. Validasi dilakukan lewat wawancara owner dan talenta. Seluruh 1.998 pengujian otomatis lulus. Repositori kode bisa ditelusuri pada lampiran.

## Current Technical Reality, Data, and Integration

Sudah berfungsi dan bisa diuji publik. Monorepo Turborepo dan Bun berisi enam backend service di balik gateway Traefik, ditambah dua frontend. Auth memakai Better Auth, Project memakai Hono dan XState v5 dengan 18 status siklus proyek, Payment menangani escrow dan double-entry ledger, Notification memakai Centrifugo, Admin menyediakan panel operasional, dan AI service memakai FastAPI yang memanggil Gemini lewat SDK google-genai. Yang berjalan: autentikasi berbasis peran, chatbot scoping dengan completeness score, generasi BRD dan PRD, parsing CV format PDF, DOCX, dan PPTX lewat pypdfium2, python-docx, dan python-pptx, lalu ekstraksi terstruktur memakai response_schema Gemini. Pencocokan skill bertingkat, matching engine, kontrak digital, milestone board, time tracking, dan admin panel juga jalan. Basis data PostgreSQL 17 dengan pgvector berisi 45 tabel lewat Drizzle ORM, ditambah Valkey, NATS JetStream, dan MinIO.

Masih simulasi. Integrasi Midtrans ada di sandbox, jadi escrow, pencairan per milestone, dan auto-release sudah berjalan secara logika dan tercatat di ledger, tapi belum memindahkan uang nyata. Layanan AI memakai kuota trial, jadi throughput produksi belum teruji pada beban berbayar.

Sedang dikembangkan. Akun produksi Midtrans dan uji rekonsiliasi dana, migrasi ke kuota AI berbayar, caching respons AI, penyempurnaan prompt estimasi biaya, dan pendaftaran PSE Kominfo.

Direncanakan. Matching berbasis machine learning, reranking pada pipeline RAG, fine-tuning chatbot, read replica, dan kategori proyek nondigital.

Data. Data utama datang langsung dari pengguna: kebutuhan, anggaran, dan tenggat dari owner; CV, portofolio, dan ekspektasi tarif dari talenta. Data publik BPS dan McKinsey hanya untuk validasi pasar. Keandalan dijaga lewat validasi silang hasil parsing CV terhadap input manual talenta.

Integrasi dan kepatuhan. Integrasi eksternal mencakup Midtrans, penyedia LLM, dan penyimpanan objek. Keamanan mengacu UU PDP Nomor 27 Tahun 2022: enkripsi saat transit dan penyimpanan, password hashing, RBAC, presigned URL dengan validasi tipe file berbasis isi, verifikasi signature webhook, pencegahan pembayaran ganda lewat idempotency key, dan ledger yang bisa diaudit.

## MVP Execution and Deployment Plan

Ruang lingkup MVP. Fokus pada proyek digital bernilai kecil sampai menengah di Bandung dan Jakarta, dengan alur lengkap owner dan talenta dalam satu platform. Fitur prioritas: autentikasi, chatbot scoping, generasi BRD dan PRD, parsing dan verifikasi CV, matching engine, kontrak digital, escrow per milestone, dan dashboard progres. Yang belum masuk: matching berbasis machine learning, fine-tuning chatbot, reranking RAG, dark mode, dan proyek nondigital.

Milestone. Bulan 1 sampai 2 fokus kesiapan produksi dengan output akun Midtrans produksi, kuota AI berbayar, dan pendaftaran PSE. PIC Ketua untuk teknis dan Project Manager untuk legal, didukung biaya cloud, token, dan pendampingan hukum. Bulan 3 sampai 4 menjalankan pilot 10 sampai 15 proyek nyata dari komunitas kampus dan UMKM mitra, sekaligus mengukur akurasi parsing CV, akurasi estimasi biaya, dan kemudahan penggunaan. PIC Project Manager dan Product Designer. Bulan 5 sampai 8 mencakup iterasi produk, SOP sengketa, monitoring, dan alerting, dipimpin Analis dan Backend Engineer. Bulan 9 sampai 12 menargetkan sekitar 150 proyek tercocokkan, 500 talenta terverifikasi, dan 100 owner aktif.

Kebutuhan integrasi. Midtrans, penyedia LLM, dan basis data.

Operasional. Sistem berjalan dalam container dengan deployment otomatis, health check, log terpusat, backup harian, admin panel, dan dukungan lewat kanal komunitas.

Risiko dan mitigasi. Estimasi AI yang meleset ditangani lewat rentang harga dan validasi manusia. Variasi format CV ditangani lewat validasi silang dengan input manual talenta. Keterlambatan persetujuan gateway dimitigasi lewat pilot bernilai kecil. Biaya token dikendalikan lewat caching dan pemilihan model bertingkat. Kepatuhan PDP dijaga lewat minimisasi data dan persetujuan eksplisit.

## Problem and System Complexity

Kompleksitas KerjaCUS! bukan pada banyaknya fitur, melainkan pada mempertemukan dua pihak yang sama-sama tidak pasti. Owner nonteknis sulit menjelaskan kebutuhan proyek secara rinci: ruang lingkup, anggaran, timeline, keterampilan, maupun referensi. Di sisi lain, kompetensi talenta tersimpan dalam CV dengan format beragam sehingga sulit dibandingkan secara objektif.

Kedua masalah ini saling memengaruhi. Kebutuhan yang kurang jelas membuat estimasi biaya, jumlah anggota tim, dan durasi jadi tidak akurat, yang menaikkan risiko revisi dan sengketa. Sistem juga harus melayani kepentingan yang berbeda: owner ingin biaya terjangkau dan proses cepat, talenta ingin kesempatan yang adil, sementara platform harus menjaga kepercayaan sekaligus mencegah transaksi pindah ke luar platform.

Kompleksitas bertambah karena banyaknya status proyek, mekanisme escrow, revisi, pembatalan, sengketa, dan algoritma pemerataan. Berbeda dengan platform berbasis bidding, KerjaCUS! menstandarkan kebutuhan proyek sejak awal dan mencocokkan berdasarkan kompetensi, sehingga prosesnya lebih efisien dan lebih adil.

## Processing Pipeline and Engineering Depth

Alur pemrosesan menggabungkan model AI, aturan bisnis, dan validasi pengguna. Proses dimulai saat owner mengisi form bertahap yang divalidasi tiap langkah, lalu berdiskusi dengan chatbot. Talenta mengunggah CV, portofolio, dan ekspektasi tarif. Teks CV diekstraksi per format memakai pypdfium2 untuk PDF, python-docx untuk DOCX, dan python-pptx untuk PPTX, lalu diubah jadi data terstruktur memakai response_schema Gemini, dan divalidasi silang dengan data yang diisi manual oleh talenta.

Chatbot menggali informasi sampai completeness score memadai. Sistem lalu menghasilkan BRD dan PRD terstruktur berisi pembagian work package, dependensi pekerjaan, estimasi jam kerja, dan jumlah anggota tim yang dihitung dari total beban kerja dengan batas satu sampai delapan orang. Dependensi divalidasi sebagai Directed Acyclic Graph, lalu dianalisis dengan topological sort untuk menentukan critical path. Kalau estimasi melebihi timeline yang diminta, sistem menawarkan tiga pilihan: menambah talenta, memperpanjang waktu, atau mengurangi ruang lingkup. Keputusan akhir tetap di tangan owner, termasuk persetujuan dokumen, pemilihan talenta, dan persetujuan milestone.

Dari sisi rekayasa, KerjaCUS! memakai arsitektur microservice berbasis Turborepo dan Bun. Enam backend service berkomunikasi lewat NATS JetStream dengan outbox pattern, idempotent consumer, dan dead-letter queue. Traefik jadi gateway. XState v5 mengelola transisi status secara type-safe. Double-entry ledger memastikan setiap pergerakan dana seimbang dan bisa diaudit, dengan pengecekan keseimbangan dilakukan di dalam transaksi yang sama dengan penulisannya. Skalabilitas ditopang container dan Valkey, sementara keandalan diverifikasi lewat 1.998 pengujian otomatis yang mencakup unit, kontrak API, dan skenario BDD.

## Algorithm or Rule Quality and Decision Transparency

KerjaCUS! memakai algoritma berbasis aturan supaya rekomendasi talenta transparan dan bisa diaudit. Setiap kandidat diberi skor dari empat komponen: skill match 30 persen, pemerataan kesempatan 35 persen, rekam jejak 20 persen, dan rating 15 persen. Datanya berasal dari kebutuhan keterampilan proyek dan profil talenta, mencakup daftar skill, jumlah proyek aktif dan selesai, ketepatan waktu, kepuasan owner, dan rating.

Skill match dihitung bertingkat. Sistem mencari kecocokan persis dulu, lalu kemiripan teks dengan Jaro-Winkler, terakhir cosine similarity pada embedding lewat pgvector untuk menangani variasi penulisan seperti React dan React.js. Nilai pemerataan dihitung dari jumlah proyek yang sedang dan pernah dikerjakan, jadi talenta baru punya peluang lebih besar mendapat proyek pertama. Rekam jejak dihitung dari kombinasi ketepatan waktu dan kepuasan owner. Rating berasal dari rata-rata penilaian yang dinormalisasi. Talenta baru yang belum punya riwayat diberi nilai awal supaya tetap bisa bersaing.

Setelah semua komponen dihitung, sistem menghasilkan daftar rekomendasi terurut. Talenta tanpa kecocokan keterampilan tidak direkomendasikan karena skill adalah syarat utama, bukan sekadar bobot. Sistem juga menerapkan epsilon-greedy: 70 persen rekomendasi dari kandidat berskor tertinggi, 30 persen untuk talenta dengan pengalaman minim tapi keterampilannya relevan. Pendekatan ini dipilih untuk menekan efek rich get richer sekaligus mengatasi cold-start.

Keputusan bersifat transparan karena tiap rekomendasi disertai rincian sub-skor: skill match, pemerataan, rekam jejak, rating, dan status eksplorasi. Admin maupun owner bisa memahami alasan seorang talenta direkomendasikan, memvalidasi hasilnya, atau memilih kandidat lain. Ke depan, setelah data historis cukup, sistem akan memakai model machine learning seperti CatBoost dengan pendekatan berbasis aturan sebagai cadangan kalau model tidak tersedia.

## User Flow, Usability Testing, and Product Iteration

Alur penggunaan dirancang dua arah. Owner membuat akun, mengajukan proyek lewat form bertahap yang didampingi chatbot sampai informasinya dinilai cukup. Sistem menampilkan ringkasan ruang lingkup untuk ditinjau sebelum BRD dibuat. Owner lalu memilih membeli BRD saja, lanjut ke PRD, atau langsung ke pengembangan. Setelah rekomendasi talenta anonim muncul, owner memilih kandidat, membayar lewat escrow, memantau progres lewat Gantt chart, menyetujui tiap milestone, dan menerima invoice. Talenta cukup mengunggah CV dan portofolio, memverifikasi hasil ekstraksi, melihat proyek yang cocok dengan kompetensinya, melamar, mengerjakan, mencatat waktu kerja, dan menerima pencairan setelah milestone disetujui.

Evaluasi dilakukan lewat dogfooding pada prototipe fungsional dengan menjalankan seluruh alur end-to-end, ditambah pengujian langsung oleh dua owner dan dua talenta di lingkungan produksi. Sistem juga melewati 1.998 pengujian otomatis yang mencakup state machine, algoritma pencocokan, perhitungan harga, kontrol akses, dan paywall dokumen. Pengujian ini menemukan dan menutup beberapa masalah nyata, di antaranya tautan kontak talenta yang masih terkirim sebelum deal, endpoint yang menyajikan daftar proyek talenta tanpa pemeriksaan otorisasi, dan tombol tanda tangan kontrak yang tidak berfungsi untuk kedua pihak. Tahap berikutnya adalah uji usability bersama pengguna eksternal lewat pilot terbatas di komunitas kampus.

Untuk menekan kesalahan pengguna, tiap tahap dilengkapi validasi: pemeriksaan isian form, konfirmasi ringkasan sebelum BRD dibuat, pemeriksaan completeness score, validasi silang hasil parsing CV, dan guard XState yang menolak transisi status tidak valid. Tersedia dua kali revisi gratis per milestone serta escrow dengan auto-release setelah 14 hari untuk melindungi kedua belah pihak.

## Team Capability and Execution Ownership

Tim terdiri atas empat orang dengan pembagian tanggung jawab yang jelas.

Bryan Philinathaniel Hutagalung, Ketua sekaligus Lead Software Engineer, bertanggung jawab atas arsitektur microservice, integrasi antarlayanan, dan pipeline AI yang mencakup chatbot scoping, parsing CV, serta generasi BRD dan PRD. Hasil yang sudah dikerjakan meliputi enam backend service dalam monorepo, mesin pencocokan talenta, dan pipeline AI yang jadi inti sistem.

Shazya Audrea Taufik, Analis dan Software Engineer, fokus pada analisis kebutuhan, perancangan basis data relasional berisi 45 tabel, implementasi double-entry ledger, serta pengembangan backend dan API.

Tamara Mayranda Lubis, Project Manager dan Business Strategist, menyusun rencana kerja, melakukan validasi pasar, merancang model bisnis, dan membangun strategi kemitraan.

Yovanka Sandrina Maharaja, Product Designer dan Software Engineer, mengembangkan antarmuka web dan admin panel serta merancang pengalaman pengguna yang mudah diakses.

Seluruh anggota punya latar belakang software engineering sehingga bisa berkolaborasi di aspek teknis maupun bisnis. Keputusan arsitektur dan teknologi dipimpin Ketua sebagai tech lead. Keputusan prioritas fitur, model bisnis, dan go-to-market dipimpin Project Manager. Untuk keputusan lintas aspek, tim berdiskusi bersama dengan mempertimbangkan hasil pengujian dan validasi pasar.

Pada tahap berikutnya, Ketua memimpin implementasi model machine learning untuk pencocokan dan integrasi payment gateway produksi. Project Manager fokus pada pelaksanaan pilot dan akuisisi pengguna. Product Designer menyempurnakan alur penggunaan berdasarkan umpan balik pilot.

## Continuation Readiness

KerjaCUS! punya rencana pengembangan 6 sampai 12 bulan ke depan. Fokus utamanya menyelesaikan MVP yang mencakup registrasi, autentikasi, chatbot scoping, pembuatan BRD dan PRD, parsing CV, pencocokan talenta, kontrak digital, escrow per milestone, dan dashboard progres. Setelah MVP selesai, tim menjalankan pilot terbatas bersama komunitas kampus dan startup di Bandung serta Jakarta untuk mengumpulkan masukan pengguna.

Pada tahun pertama, target tim adalah 500 talenta terverifikasi, 100 owner aktif, dan 150 proyek yang berhasil dipertemukan, dengan match success rate di atas 30 persen dan efisiensi proses scoping di atas 90 persen. Setelah jumlah proyek cukup, sistem akan memakai model machine learning berbasis CatBoost untuk meningkatkan kualitas rekomendasi, sekaligus mengevaluasi keadilan distribusi memakai Gini coefficient.

Pembagian tanggung jawab tetap mengikuti peran masing-masing: Ketua pada integrasi sistem dan AI, Project Manager pada pilot dan kemitraan, Analis pada backend dan pengelolaan data, serta Product Designer pada pengalaman pengguna. Supaya berkelanjutan setelah hackathon, pengembangan memakai teknologi open source dan infrastruktur self-hosted agar biaya operasional tetap rendah. Tim berencana menggandeng advisor legal, payment gateway berlisensi, serta mitra kampus dan inkubator.

## Quantified Value, Business Model, and ROI

Pemangku kepentingan. Owner mengajukan dan membiayai proyek. Talenta mengerjakan proyek. Payment gateway berlisensi mengelola escrow. Perguruan tinggi dan komunitas jadi sumber talenta. Regulator berperan menjaga ekosistem digital tetap aman dan sesuai ketentuan.

Nilai bagi tiap pihak. Bagi owner, KerjaCUS! menyediakan perencanaan proyek yang terstruktur lewat BRD dan PRD, estimasi biaya dan timeline yang lebih jelas, serta jaminan transaksi lewat escrow. Waktu scoping terpangkas dari hitungan hari jadi menit. Bagi talenta, tersedia akses ke proyek yang sesuai kompetensi tanpa perang harga. Talenta menerima 100 persen dari nominal yang dikuotasikan kepadanya, dan mendapat portofolio terverifikasi setelah proyek selesai.

Model pendapatan. Tiga sumber: margin bertingkat dari tiap proyek, penjualan dokumen BRD dan PRD secara terpisah, serta talent placement fee setelah proyek selesai. Biaya operasional utama mencakup layanan AI, infrastruktur cloud, pengembangan produk, pemasaran, kepatuhan hukum, dan biaya transaksi payment gateway. Seiring bertambahnya volume, biaya per transaksi diproyeksikan turun lewat pemanfaatan teknologi open source, caching, dan infrastruktur yang lebih efisien.

Proyeksi tahun pertama. Dengan 150 proyek dan nilai rata-rata Rp25 juta, GMV mencapai sekitar Rp3,75 miliar. Proyek senilai Rp25 juta masuk bracket sampai Rp30 juta, dengan pembagian 56,5 persen untuk talenta dan 43,5 persen untuk platform. Pendapatan platform karena itu sekitar Rp1,63 miliar, belum termasuk penjualan BRD dan PRD.

Angka ini perlu dibaca dengan catatan. Take rate 43,5 persen berada di atas band managed marketplace transparan seperti Braintrust dan Gun.io, dan setara bracket atas layanan premium tertutup seperti Toptal dan Gigster. Konsekuensinya, elastisitas permintaan owner dan retensi talenta pada bracket Rp20 juta ke atas jadi risiko yang wajib dipantau selama pilot, karena di sana talenta menerima kurang dari 62 persen nilai yang dibayar owner. Kalau pilot menunjukkan penolakan, struktur bracket akan disesuaikan sebelum skala diperbesar.

## Adoption, Growth Strategy, and Competitive Moat

Strategi akuisisi dilakukan bertahap dengan menyasar kedua sisi marketplace. Dari sisi demand, pengguna awal difokuskan pada UMKM, startup tahap awal, dan inkubator bisnis lewat pendekatan B2B langsung. Dari sisi supply, perekrutan talenta lewat kerja sama dengan perguruan tinggi, komunitas teknologi, dan komunitas pencari kerja. Kanalnya mencakup direct outreach, kemitraan, media sosial, dan konten edukasi. Pilot awal dijalankan di Bandung dan Jakarta karena ekosistem startupnya relatif matang. Seluruh layanan diakses lewat browser tanpa instalasi.

Pengembangan produk direncanakan bertahap. Tahap pertama menyelesaikan MVP untuk proyek digital, dilanjutkan pilot dengan pengguna terbatas. Setelah data historis cukup, sistem memakai model machine learning untuk meningkatkan kualitas rekomendasi. Tahap berikutnya memperluas ke wilayah dan bidang engineering lain tanpa mengubah arsitektur, karena pendekatan microservice memungkinkan penambahan domain lewat service baru.

Keunggulan utama KerjaCUS! ada pada kemampuannya membantu owner menyusun kebutuhan sejak tahap awal lewat AI, bukan sekadar mencocokkan talenta seperti marketplace freelance umumnya. Harga ditetapkan sistem tanpa bidding, dan algoritma pemerataan memberi kesempatan lebih adil bagi talenta baru. Seluruh dokumen proyek, riwayat percakapan, progres pekerjaan, escrow, dan portofolio terverifikasi menciptakan switching cost yang mendorong retensi. Semakin banyak proyek yang diproses, semakin kaya data terstruktur yang dimiliki platform, sehingga kualitas rekomendasi terus membaik dan membentuk keunggulan jangka panjang.
