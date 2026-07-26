FINAL SOLUTION SUMMARY
KerjaCUS! adalah managed project marketplace berbasis AI yang membantu pemilik proyek nonteknis seperti UMKM, startup, dan individu mengubah ide mentah menjadi proyek digital yang siap dikerjakan talenta pemula.
Owner mengisi formulir secara bertahap sambil berdiskusi dengan AI chatbot hingga kebutuhannya dianggap memadai. Sistem kemudian menyusun BRD dan PRD yang memuat work package, dependensi antarpaket, estimasi jam kerja, kebutuhan tim beranggotakan satu hingga delapan orang, biaya, serta timeline.
CV talenta diubah menjadi profil keahlian, lalu dicocokkan lewat exact match dan Jaro-Winkler, dengan tahap kemiripan semantik pgvector menunggu taksonomi skill diembed. Skor matching dirinci per komponen sehingga bisa diaudit, dengan 30 persen slot eksplorasi agar talenta baru tetap kebagian.
Proyek dikelola lewat kontrak digital, escrow per milestone, gantt chart, dan time tracking. Platform sudah di-deploy di kerjacus.id. Penyusunan dokumen kebutuhan yang sebelumnya dilakukan secara manual selama beberapa hari kini dapat diselesaikan hanya dalam hitungan menit.
PROGRESS AND CHANGE LOG
Financial projection direvisi mengikuti perubahan produk dan rencana ke depan.
Validasi langsung ke pengguna
Dua owner dan dua talenta mencoba langsung alur scoping serta onboarding CV di lingkungan produksi. Temuan utamanya menunjukkan bahwa kualitas keluaran AI masih perlu ditingkatkan, dan hal tersebut menjadi prioritas apabila tersedia tambahan pendanaan.
Pengendalian biaya AI
Layanan AI masih berjalan pada kuota trial. Pengujian menunjukkan biaya token per proyek jadi variabel terbesar di unit economics, sehingga caching respons dan pemilihan model bertingkat masuk rencana peningkatan.
Audit keamanan
Seluruh service telah diaudit dan 272 kasus uji otomatis berhasil dilalui. Tiga celah pada alur transaksi juga berhasil ditutup, yaitu route yang memungkinkan owner menambah saldo escrow tanpa melakukan pembayaran, proses refund yang gagal tetapi tetap tercatat berhasil sehingga dana tertahan di escrow tanpa jejak, serta endpoint yang menampilkan daftar klien milik seorang talenta kepada siapa pun yang telah login.

B. USE CASE CLARITY & ALIGNMENT WITH USER PROBLEM 
VALIDATED USER PROBLEM AND EVIDENCE
Pengguna utama
Di sisi demand, pemilik proyek nonteknis yaitu UMKM, startup, dan individu tanpa tim teknis. Di sisi supply, talenta digital pemula yaitu mahasiswa tingkat akhir, fresh graduate, dan freelancer.
Situasi masalah
Owner ingin mengubah ide jadi proyek, tapi marketplace freelance mengharuskan dia menentukan deskripsi, ruang lingkup, anggaran, dan kebutuhan talenta sejak awal. Padahal dia belum tahu fitur apa yang dibutuhkan, berapa biaya wajarnya, atau kompetensi seperti apa yang harus dicari. Bagi talenta, masalahnya mencari dan melamar proyek tanpa tahu kecocokan keahlian, kredibilitas owner, dan kepastian pembayaran.
Penyebab dan dampak
Permasalahannya berakar pada ketimpangan informasi dan rendahnya tingkat kepercayaan, diperburuk ketiadaan mekanisme scoping terstandar, matching yang transparan, dan perlindungan transaksi. Akibatnya owner menghadapi deskripsi tidak lengkap, revisi berulang, biaya membengkak, risiko penipuan, sampai pembatalan proyek. Talenta membuang waktu untuk bidding, terjebak perang harga, sulit dapat proyek pertama, dan berisiko tidak dibayar.
Bukti
Wawancara dengan satu pemilik warung menunjukkan digitalisasi dianggap mahal, sulit dipahami, dan rawan penipuan. Satu talenta digital menyatakan sulit menemukan proyek tepercaya dengan pembayaran yang pasti. BPS mencatat sekitar 7,4 juta penganggur pada 2025 dan sekitar 33,34 juta pekerja lepas pada 2020. McKinsey lewat Manyika et al. (2016) menemukan hanya sekitar 15 persen pekerja independen memakai platform digital.
Perubahan sejak submission kedua
Awalnya masalah dipahami sebagai dua hal terpisah: owner tidak bisa menyusun proyek, dan talenta sulit dapat pekerjaan. Wawancara menunjukkan defisit kepercayaan dan ketidakpastian sebelum transaksi sama pentingnya.
END-TO-END USE CASE AND FEATURE-TO-PAIN MAPPING (288/300 KATA)
Use case utama: UMKM membangun aplikasi pemesanan tanpa tim teknis.
Kondisi awal
Owner tahu pelanggannya harus bisa memesan online, tapi tidak tahu fiturnya apa saja, biaya wajarnya berapa, dan butuh berapa orang. Dia membuka proyek di platform freelance dan berhenti di kolom deskripsi dan anggaran.
Tindakan pengguna. Owner mendaftar, mengisi form bertahap, lalu menjawab pertanyaan chatbot: tujuan bisnis, calon pengguna, referensi aplikasi sejenis, batas anggaran, dan tenggat.
Proses sistem
Pertama, chatbot menggali kebutuhan sampai completeness score memadai. Kedua, sistem menghasilkan BRD lalu PRD terstruktur berisi daftar fitur, work package, dependensi antartugas, komposisi tim, estimasi harga per paket, dan timeline. Ketiga, proyek dipublikasikan dan mesin pencocokan menilai kandidat dengan formula tertimbang: skill 30 persen, pemerataan 35 persen, rekam jejak 20 persen, rating 15 persen, ditambah 30 persen slot eksplorasi untuk talenta baru. Keempat, skill hasil parsing CV dicocokkan ke taksonomi lewat exact match dan alias, lalu Jaro-Winkler. Tahap kemiripan semantik pgvector menyusul setelah taksonomi diembed.
Output
Dokumen BRD dan PRD siap pakai, serta daftar rekomendasi talenta terurut beserta skor relevansi dan alasannya.
Tindakan lanjutan
Owner menyetujui kandidat, lalu menerbitkan kontrak digital berupa NDA dan perjanjian HKI yang ditandatangani kedua pihak. Dana milestone pertama masuk escrow, pekerjaan berjalan dengan milestone board dan time tracking, dan dana cair per milestone yang disetujui.
Pemetaan fitur ke pain point
Chatbot dan completeness score menjawab owner yang tidak tahu cara merumuskan kebutuhan. Generasi BRD dan PRD menjawab ruang lingkup kabur, revisi berulang, dan biaya tidak pasti. Parsing CV dan ekstraksi skill menjawab talenta yang sulit membuktikan kompetensi secara terstruktur. Matching berbobot dan epsilon-greedy menjawab lamaran tanpa kepastian dan cold-start talenta baru. Escrow per milestone dan double-entry ledger menjawab risiko tidak dibayar dan tidak dikerjakan. Milestone board dan time tracking menjawab progres yang tidak terpantau.
OPERATIONAL CONTEXT, SOLUTION BOUNDARY, AND ADOPTION
Lingkungan penggunaan
KerjaCUS! diakses lewat browser tanpa instalasi, bisa dipakai lintas lokasi, dan sepenuhnya berbahasa Indonesia. Owner menyusun kebutuhan dan mendanai proyek. Talenta mengerjakan sesuai milestone. Admin menangani verifikasi, kurasi, pemantauan, dan penyelesaian sengketa. Payment gateway berlisensi mengelola penampungan dan pencairan dana. Kampus dan komunitas jadi mitra utama untuk memperoleh talenta awal.
Batas solusi
Sistem membantu menyusun spesifikasi proyek, merekomendasikan talenta, menerbitkan kontrak digital, mengelola escrow, dan mencatat transaksi. Sistem belum bisa menjamin kualitas hasil kerja secara otomatis, tidak menyimpan dana pengguna secara langsung, dan belum melayani proyek di luar bidang digital. Estimasi biaya dari AI tetap perlu divalidasi manusia sebelum dijadikan nilai kontrak.
Ketergantungan
Operasional bergantung pada persetujuan akun produksi Midtrans, kuota berbayar penyedia LLM, pendaftaran PSE Kominfo, kepatuhan UU PDP Nomor 27 Tahun 2022, serta kerja sama kampus dan komunitas.
Hambatan adopsi
Perbedaan literasi digital ditangani lewat alur bertahap, chatbot berbahasa Indonesia, dan pendampingan langsung. Kepercayaan dibangun lewat verifikasi pengguna, kontrak digital, dan escrow. Kebiasaan memakai platform lama ditangani lewat pilot terbatas di komunitas kampus dan pendampingan pada proyek pertama. Risiko biaya awal ditekan lewat pembayaran per milestone, jadi owner tidak perlu membayar seluruh nilai proyek sebelum pekerjaan selesai.
C. IMPLEMENTATION FEASIBILITY
INNOVATION LEVEL
Level 3: Prototype, Validasi, atau Implementasi Awal. 
KerjaCUS! telah dideploy dan dapat diakses publik melalui kerjacus.id. Alur end-to-end dari scoping AI hingga escrow telah berjalan dengan input aktual. Validasi sudah dilakukan dengan wawancara owner dan talenta. Seluruh 272 kasus uji otomatis lulus. Repositori kode dapat ditelusuri pada lampiran.
CURRENT TECHNICAL REALITY, DATA, AND INTEGRATION
Sudah berfungsi dan bisa diuji publik
Monorepo Turborepo dan Bun berisi enam backend service di balik gateway Traefik, ditambah dua frontend. Auth memakai Better Auth, Project memakai Hono dan XState v5 dengan 18 status proyek, Payment menangani escrow dan double-entry ledger, Notification memakai Centrifugo, Admin menyediakan panel operasional, dan AI service memanggil Gemini lewat google-genai. Yang berjalan: autentikasi berbasis peran, chatbot scoping dengan completeness score, generasi BRD dan PRD, parsing CV PDF, DOCX, dan PPTX lewat pypdfium2, python-docx, dan python-pptx, lalu ekstraksi terstruktur memakai response_schema Gemini. Pencocokan skill bertingkat sampai tahap Jaro-Winkler, matching engine, kontrak digital, milestone board, Gantt chart, time tracking, dan admin panel juga jalan. Basis data PostgreSQL 17 dengan pgvector berisi 45 tabel, ditambah Valkey, NATS JetStream, dan MinIO.
Masih simulasi
Midtrans ada di sandbox, jadi escrow, pencairan per milestone, dan auto-release tercatat di ledger tapi belum memindahkan uang nyata. Layanan AI memakai kuota trial, jadi throughput belum teruji pada beban berbayar.
Sedang dikembangkan
Akun produksi Midtrans dan uji rekonsiliasi dana, migrasi ke kuota AI berbayar, pengisian embedding taksonomi skill supaya tahap semantik pencocokan aktif, caching respons AI, penyempurnaan prompt estimasi biaya, dan pendaftaran PSE Kominfo.
Direncanakan
Matching machine learning, reranking RAG, fine-tuning chatbot, read replica, dan kategori nondigital.
Data
Owner memberi kebutuhan, anggaran, dan tenggat. Talenta memberi CV, portofolio, dan ekspektasi tarif. Data BPS dan McKinsey hanya untuk validasi pasar. Keandalan dijaga lewat validasi silang hasil parsing CV terhadap input manual talenta.
Integrasi dan kepatuhan
Integrasi eksternal mencakup Midtrans, penyedia LLM, Resend untuk email, dan object storage. Mengacu UU PDP Nomor 27 Tahun 2022, yang sudah terpasang: enkripsi transit lewat TLS, password hashing, RBAC, presigned URL dengan validasi tipe file, verifikasi signature webhook, idempotency key, dan ledger yang bisa diaudit. Enkripsi penyimpanan dan backup terjadwal belum ada, dan jadi syarat sebelum pilot berbayar.
MVP EXECUTION AND DEPLOYMENT PLAN
Ruang lingkup MVP
Fitur inti sudah terbangun, jadi MVP di sini bukan membangun ulang melainkan membuatnya layak dipakai dengan uang nyata: Midtrans produksi, kuota AI berbayar, backup dan enkripsi penyimpanan, pendaftaran PSE, lalu pilot berbayar di Bandung dan Jakarta. Belum masuk: matching machine learning, fine-tuning chatbot, reranking RAG, dark mode, dan proyek nondigital.
Milestone
Bulan 1 sampai 2 fokus kesiapan produksi: akun Midtrans produksi, kuota AI berbayar, backup terjadwal, enkripsi penyimpanan, dan pendaftaran PSE. PIC Ketua untuk teknis, Project Manager untuk legal. Bulan 3 sampai 4 menjalankan pilot 10 sampai 15 proyek nyata dari komunitas kampus dan UMKM mitra, sekaligus mengukur akurasi parsing CV, estimasi biaya, dan kemudahan penggunaan. PIC Project Manager dan Product Designer. Bulan 5 sampai 8 mencakup iterasi produk, SOP sengketa, monitoring, dan alerting, dipimpin Analis dan Backend Engineer. Bulan 9 sampai 12 mengikuti model keuangan, yaitu 17 proyek selesai, 160 talenta terverifikasi, dan sekitar 110 owner yang mengajukan BRD.
Kebutuhan integrasi
Midtrans, penyedia LLM, Resend untuk email, dan object storage untuk CV serta lampiran milestone.
Operasional
Sistem berjalan dalam container dengan deployment otomatis, health check, admin panel, dan dukungan lewat kanal komunitas. Backup terjadwal dan enkripsi penyimpanan belum terpasang dan masuk pekerjaan bulan 1 sampai 2.
Risiko dan mitigasi
Estimasi AI yang meleset ditangani lewat rentang harga dan validasi manusia. Variasi format CV ditangani lewat validasi silang. Keterlambatan persetujuan gateway dimitigasi lewat pilot bernilai kecil. Biaya token dikendalikan lewat caching dan model bertingkat. Kepatuhan PDP dijaga lewat minimisasi data dan persetujuan eksplisit.


D. COMPLEXITY

PROBLEM AND SYSTEM COMPLEXITY
Kompleksitas KerjaCUS! bukan pada banyaknya fitur, melainkan pada mempertemukan dua pihak yang sama-sama tidak pasti. Owner nonteknis sulit menjelaskan kebutuhan proyek secara rinci, mulai dari ruang lingkup, anggaran, timeline, sampai keterampilan. Di sisi lain, kompetensi talenta tersebar dalam CV dengan format beragam sehingga sulit dibandingkan secara objektif.

Kedua permasalahan tersebut saling memengaruhi. Kebutuhan yang kurang jelas membuat estimasi biaya, jumlah tim, dan durasi pengerjaan tidak akurat, sehingga menaikkan risiko revisi dan sengketa. Sistem juga menyeimbangkan kepentingan berbeda. Owner menginginkan biaya terjangkau, talenta mengharapkan kesempatan adil, sementara platform menjaga kepercayaan sekaligus mencegah transaksi pindah ke luar.

Kompleksitas muncul dari pengelolaan status proyek dan aliran dana. KerjaCUS! memiliki 18 status proyek dengan aturan transisi yang divalidasi untuk memastikan dana hanya dicairkan setelah pekerjaan disetujui. Pada proyek berbasis tim, mekanisme escrow dibagi berdasarkan work package dan talenta memiliki milestone masing-masing. Pembagian fee harus tetap konsisten mulai dari penentuan pricing bracket proyek hingga pencairan setiap milestone. Menambah satu work package menggeser payout paket yang sudah ada, sehingga ketiga penulisan itu harus masuk dalam satu transaksi atau tidak sama sekali. Berbeda dengan platform berbasis bidding, KerjaCUS! menstandarkan kebutuhan proyek sejak awal dan melakukan pencocokan berdasarkan kompetensi sehingga proses menjadi lebih efisien dan adil.

PROCESSING PIPELINE AND ENGINEERING DEPTH
Alur pemrosesan KerjaCUS! menggabungkan model AI, aturan bisnis, dan validasi pengguna. Proses dimulai ketika owner mengisi formulir bertahap yang divalidasi pada setiap langkah dan berdiskusi dengan AI Chatbot. Sementara itu, talenta mengunggah CV, portofolio, dan ekspektasi tarif. Isi CV diekstraksi sesuai format memakai pypdfium2 untuk PDF, python-docx untuk DOCX, dan python-pptx untuk PPTX. Hasil ekstraksi diubah menjadi data terstruktur menggunakan response_schema Gemini, kemudian divalidasi silang dengan data yang diisi secara manual oleh talenta.

AI Chatbot menggali informasi hingga mencapai completeness score yang ditentukan. Selanjutnya, sistem menghasilkan BRD dan PRD yang memuat pembagian work package, dependensi pekerjaan, estimasi jam kerja, serta jumlah anggota tim yang dihitung berdasarkan total beban kerja dengan batas minimal satu dan maksimal delapan orang. Dependensi antar-work package dijaga tetap Directed Acyclic Graph lewat penelusuran depth-first search yang menolak siklus, referensi ke paket tak dikenal, referensi ke dirinya sendiri, maupun dependensi duplikat. Keputusan akhir, termasuk persetujuan dokumen, pemilihan talenta, dan persetujuan milestone, tetap berada di tangan owner.

Dari sisi rekayasa perangkat lunak, KerjaCUS! menggunakan arsitektur microservice berbasis Turborepo dan Bun. Lima dari enam layanan backend berkomunikasi melalui NATS JetStream dengan outbox pattern, idempotent consumer, dan dead-letter queue, sedangkan auth-service berdiri sendiri karena tidak menerbitkan domain event. Traefik jadi gateway, XState v5 mengelola transisi status secara type-safe, dan double-entry ledger memastikan seluruh transaksi keuangan seimbang serta dapat diaudit. Keandalan sistem telah diverifikasi melalui 272 kasus uji otomatis berisi 1.920 verifikasi, terdiri atas 162 kasus TDD unit, 65 kontrak API ATDD, dan 45 skenario BDD.

E. ALGORITHM QUALITY & USER EXPERIENCE

ALGORITHM OR RULE QUALITY AND DECISION TRANSPARENCY
KerjaCUS! menggunakan algoritma berbasis aturan (rule-based) agar proses rekomendasi talenta bersifat transparan, konsisten, dan mudah diaudit. Setiap kandidat diberi skor berdasarkan empat komponen, yaitu skill match (30%), pemerataan kesempatan (35%), rekam jejak (20%), dan rating (15%). Data yang digunakan berasal dari kebutuhan keterampilan proyek serta profil talenta yang mencakup daftar keterampilan, jumlah proyek aktif dan selesai, tingkat ketepatan waktu, kepuasan owner, dan rating.

Komponen skill match dihitung secara bertahap. Sistem terlebih dahulu mencari kecocokan persis beserta alias keterampilan, kemudian menghitung kemiripan teks menggunakan algoritma Jaro-Winkler dengan ambang 0,85. Tahap berikutnya memanfaatkan cosine similarity melalui pgvector dengan ambang 0,7. Meskipun mekanisme ini telah tersedia, tahap embedding belum aktif karena kolom embedding pada taksonomi keterampilan belum diisi. Akibatnya, variasi penulisan seperti React dan React.js saat ini masih ditangani menggunakan Jaro-Winkler. Nilai pemerataan dihitung dari jumlah proyek aktif dan selesai sehingga talenta baru memiliki peluang lebih besar memperoleh proyek pertama. Rekam jejak berasal dari kombinasi ketepatan waktu dan kepuasan owner, sedangkan rating dihitung dari rata-rata penilaian yang telah dinormalisasi. Talenta tanpa riwayat proyek tetap diberikan nilai awal agar dapat bersaing.

Setelah seluruh komponen dihitung, sistem menghasilkan daftar rekomendasi yang diurutkan berdasarkan skor akhir. Talenta tanpa kecocokan keterampilan tidak direkomendasikan karena keterampilan merupakan persyaratan utama. Selain itu, sistem menerapkan strategi epsilon-greedy, yaitu 70% rekomendasi berasal dari kandidat dengan skor tertinggi, sedangkan 30% dialokasikan bagi talenta dengan pengalaman minim tetapi memiliki keterampilan yang relevan. Owner hanya melihat skor total, nilai skill match, dan penanda kandidat eksplorasi, sedangkan komponen pemerataan, rekam jejak, dan rating hanya dapat diakses admin untuk menjaga anonimitas talenta. Ke depan, setelah data historis mencukupi, sistem akan mengadopsi model machine learning berbasis CatBoost dengan algoritma berbasis aturan sebagai mekanisme cadangan.

USER FLOW, USABILITY TESTING, AND PRODUCT ITERATION
Alur penggunaan KerjaCUS! dirancang untuk mendukung kebutuhan owner dan talenta. Owner memulai dengan membuat akun, mengajukan proyek melalui formulir bertahap yang didampingi AI Chatbot hingga informasi dinilai cukup. Sebelum BRD dibuat, sistem menampilkan ringkasan ruang lingkup untuk ditinjau. Owner dapat memilih membeli BRD, melanjutkan ke PRD, atau langsung ke tahap pengembangan. Setelah rekomendasi talenta anonim ditampilkan, owner memilih kandidat, melakukan pembayaran melalui escrow, memantau progres melalui Gantt chart, menyetujui setiap milestone, dan menerima invoice. Di sisi lain, talenta mengunggah CV dan portofolio, memverifikasi hasil ekstraksi data, melihat proyek yang sesuai dengan kompetensinya, mengajukan lamaran, mencatat waktu kerja, dan menerima pencairan dana setelah milestone disetujui.

Evaluasi dilakukan lewat dogfooding pada prototipe fungsional dengan menjalankan seluruh alur end-to-end, serta pengujian oleh dua owner dan dua talenta di lingkungan produksi. Selain itu, sistem telah melalui 272 kasus uji otomatis dengan 1.920 verifikasi yang mencakup state machine, algoritma pencocokan, perhitungan harga, kontrol akses, dan paywall dokumen. Pengujian ini mengidentifikasi masalah penting, seperti tombol penandatanganan kontrak yang menghambat escrow, mekanisme OTP yang membuat kode cepat kedaluwarsa, serta tautan kontak talenta yang masih terlihat sebelum kesepakatan. Temuan tersebut jadi dasar perbaikan berikutnya. Selanjutnya, tim akan melaksanakan uji usability melalui pilot terbatas di komunitas kampus.

Untuk meminimalkan kesalahan pengguna, sistem menerapkan validasi mulai dari pemeriksaan formulir, konfirmasi ringkasan proyek, completeness score, validasi hasil parsing CV, hingga guard XState yang mencegah transisi status tidak valid. Selain itu, tersedia dua kali revisi gratis pada setiap milestone dan mekanisme escrow dengan auto-release setelah 14 hari untuk melindungi kedua belah pihak.

F. TEAM READINESS FOR STARTUP

TEAM CAPABILITY AND EXECUTION OWNERSHIP
Tim KerjaCUS! terdiri atas empat anggota dengan pembagian tanggung jawab yang jelas sesuai keahlian masing-masing. Bryan Philinathaniel Hutagalung sebagai Ketua sekaligus Lead Software Engineer bertanggung jawab atas perancangan arsitektur microservice, integrasi antarlayanan, serta pengembangan pipeline AI yang mencakup chatbot untuk scoping, parsing CV, dan generasi BRD maupun PRD. Implementasi yang telah dihasilkan meliputi arsitektur monorepo enam layanan, mesin pencocokan talenta, serta pipeline AI sebagai inti sistem.

Shazya Audrea Taufik berperan sebagai Analis dan Software Engineer dengan fokus pada analisis kebutuhan, perancangan basis data relasional yang terdiri atas 45 tabel, implementasi double-entry ledger, serta pengembangan backend dan API. Tamara Mayranda Lubis sebagai Project Manager dan Business Strategist bertanggung jawab menyusun rencana kerja, melakukan validasi pasar, mengembangkan model bisnis, dan membangun strategi kemitraan. Sementara itu, Yovanka Sandrina Maharaja sebagai Product Designer dan Software Engineer mengembangkan antarmuka web maupun admin panel serta merancang pengalaman pengguna yang mudah dipahami dan diakses.

Seluruh anggota memiliki latar belakang software engineering sehingga mampu berkolaborasi dalam aspek teknis maupun bisnis. Keputusan terkait arsitektur dan pemilihan teknologi dipimpin oleh Ketua sebagai tech lead, sedangkan keputusan mengenai prioritas fitur, model bisnis, dan strategi go-to-market dipimpin oleh Project Manager. Keputusan lintas fungsi diambil secara bersama berdasarkan hasil pengujian dan validasi pasar.

Pada tahap pengembangan berikutnya, Ketua akan memimpin implementasi model machine learning untuk meningkatkan kualitas pencocokan talenta serta integrasi payment gateway produksi. Project Manager berfokus pada pelaksanaan pilot dan akuisisi pengguna, sedangkan Product Designer menyempurnakan alur penggunaan berdasarkan umpan balik dari hasil pilot.

CONTINUATION READINESS
KerjaCUS! memiliki rencana pengembangan untuk 6 sampai 12 bulan ke depan. Karena fitur inti sudah tersedia, fokusnya bukan menambah fitur melainkan menyiapkan sistem menerima transaksi dan data nyata: Midtrans produksi, kuota AI berbayar, backup, enkripsi penyimpanan, dan pendaftaran PSE. Setelah itu tim menjalankan pilot terbatas bersama komunitas kampus dan startup di Bandung serta Jakarta.
Target tahun pertama mengikuti model keuangan, yaitu 160 talenta terverifikasi, sekitar 110 owner yang mengajukan BRD, dan 17 proyek selesai. Angka 500 talenta dan 150 proyek kumulatif ada di model yang sama, tetapi baru tercapai sekitar pertengahan 2029. Match success rate didefinisikan sebagai persentase proyek yang memperoleh talenta yang disetujui owner dalam waktu 72 jam setelah proses pencocokan dimulai, dengan target di atas 30%. Sementara itu, efisiensi scoping diukur dari waktu yang dibutuhkan sejak proyek dibuat hingga BRD disetujui, dibandingkan proses manual yang berdasarkan hasil wawancara membutuhkan beberapa hari. Setelah data proyek mencukupi, sistem akan mengadopsi model machine learning berbasis CatBoost untuk meningkatkan kualitas rekomendasi sekaligus mengevaluasi pemerataan peluang menggunakan Gini coefficient.
Pembagian tanggung jawab mengikuti peran masing-masing. Supaya berkelanjutan setelah hackathon, pengembangan memakai teknologi open source dan self-hosted agar biaya operasional rendah, didukung advisor legal, payment gateway berlisensi, serta mitra kampus dan inkubator.

G. BUSINESS PLAN & ROI

QUANTIFIED VALUE, BUSINESS MODEL, AND ROI
KerjaCUS! melibatkan beberapa pemangku kepentingan dalam ekosistemnya. Owner berperan mengajukan dan membiayai proyek, sedangkan talenta mengerjakan proyek sesuai kompetensinya. Mekanisme escrow dikelola oleh payment gateway berlisensi, sementara perguruan tinggi dan komunitas menjadi sumber utama talenta. Regulator turut berperan memastikan operasional platform berjalan sesuai ketentuan yang berlaku.

Bagi owner, KerjaCUS! membantu menyusun kebutuhan proyek secara lebih terstruktur melalui BRD dan PRD, sehingga estimasi biaya, ruang lingkup, dan timeline menjadi lebih jelas. Proses scoping yang sebelumnya membutuhkan beberapa hari dapat diselesaikan dalam hitungan menit. Sementara itu, talenta memperoleh akses ke proyek yang sesuai dengan kompetensinya tanpa harus bersaing melalui perang harga. Talenta juga menerima seluruh nilai pekerjaan yang dialokasikan kepadanya serta memperoleh portofolio terverifikasi setelah proyek selesai.

Model pendapatan KerjaCUS! berasal dari tiga sumber, yaitu margin dari setiap proyek, penjualan dokumen BRD dan PRD secara terpisah, serta talent placement fee. Biaya operasional utama meliputi layanan AI, infrastruktur cloud, pengembangan produk, pemasaran, kepatuhan hukum, dan biaya transaksi payment gateway. Seiring bertambahnya jumlah pengguna, biaya operasional per transaksi diperkirakan akan semakin efisien melalui pemanfaatan teknologi open-source dan caching.

Proyeksi mengikuti bauran proyek pada model keuangan. Sekitar 45% merupakan proyek kecil senilai Rp4 juta, 32% proyek senilai Rp10 juta, 17% proyek senilai Rp23 juta, dan sisanya proyek sekitar Rp50 juta, dengan rata-rata Rp11,91 juta. Tiap tier dikenai bracket masing-masing sebesar 23,5%, 28,5%, 43,5%, dan 48,5% sehingga take rate gabungannya 37,7%. Pada tahun pertama setelah rilis, model memproyeksikan 17 proyek selesai, GMV sekitar Rp202 juta, dan total pendapatan sekitar Rp194 juta termasuk penjualan BRD dan PRD. Volume 150 proyek kumulatif baru tercapai sekitar pertengahan 2029 dengan komisi sekitar Rp674 juta. Selama tahap pilot, tim juga akan mengevaluasi apakah struktur margin pada proyek bernilai besar memengaruhi minat owner maupun retensi talenta. Jika diperlukan, skema margin akan disesuaikan sebelum platform dikembangkan dalam skala yang lebih luas.

ADOPTION, GROWTH STRATEGY, AND COMPETITIVE MOAT
Strategi akuisisi pengguna KerjaCUS! dilakukan secara bertahap dengan menargetkan kedua sisi marketplace. Dari sisi owner, pengguna awal difokuskan pada UMKM, startup tahap awal, dan inkubator bisnis melalui pendekatan B2B secara langsung. Sementara itu, dari sisi talenta, perekrutan dilakukan melalui kerja sama dengan perguruan tinggi, komunitas teknologi, dan komunitas pencari kerja. Akuisisi pengguna didukung oleh berbagai kanal, seperti direct outreach, kemitraan, media sosial, dan konten edukasi. Pilot awal akan dilaksanakan di Bandung dan Jakarta yang memiliki ekosistem startup cukup berkembang. Seluruh layanan dapat diakses langsung melalui browser tanpa memerlukan instalasi aplikasi.

Pengembangan produk juga dilakukan secara bertahap. Fokus awal adalah menyempurnakan sistem yang sudah berjalan agar siap digunakan pada lingkungan produksi, kemudian melaksanakan pilot berbayar dengan pengguna terbatas. Setelah jumlah data proyek mencukupi, sistem akan mengadopsi model machine learning untuk meningkatkan kualitas rekomendasi talenta. Pada tahap berikutnya, KerjaCUS! akan diperluas ke wilayah dan bidang engineering lainnya. Arsitektur microservice memungkinkan penambahan layanan baru tanpa mengubah layanan yang sudah ada sehingga pengembangan dapat dilakukan secara lebih fleksibel.

Keunggulan utama KerjaCUS! adalah membantu owner menyusun kebutuhan proyek sejak tahap awal menggunakan AI, bukan hanya mencocokkan talenta seperti marketplace freelance pada umumnya. Selain itu, sistem menetapkan harga tanpa proses bidding sehingga owner memperoleh biaya yang lebih pasti, sementara algoritma pemerataan memberikan peluang yang lebih adil bagi talenta baru. Seiring bertambahnya jumlah proyek, data kebutuhan, kompetensi, dan hasil proyek yang terkumpul akan memperkaya basis data platform sehingga kualitas rekomendasi terus meningkat dan menjadi keunggulan kompetitif KerjaCUS! dalam jangka panjang
