import { uuidv7 } from 'uuidv7'
import { getDb } from './client'
import {
  accounts,
  brdDocuments,
  chatConversations,
  chatMessages,
  disputes,
  milestones,
  notifications,
  platformSettings,
  projectApplications,
  projectAssignments,
  projectStatusLogs,
  projects,
  reviews,
  skills,
  tasks,
  timeLogs,
  transactions,
  user,
  workerProfiles,
  workerSkills,
  workPackages,
} from './schema'

async function seed() {
  const db = getDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)

  console.log('Seeding database...')

  // Clean all tables using TRUNCATE CASCADE (handles FK dependencies)
  console.log('  Cleaning previous seed data...')
  const client = getDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)
  await client.execute(`TRUNCATE TABLE
    time_logs, tasks, milestone_files, milestone_comments, revision_requests,
    chat_messages, chat_participants, chat_conversations,
    ledger_entries, accounts, transaction_events, transactions,
    project_applications, project_assignments, contracts,
    milestones, work_package_dependencies, work_packages, task_dependencies,
    brd_documents, prd_documents, project_activities, project_status_logs,
    disputes, reviews, notifications,
    worker_skills, worker_assessments, worker_penalties, worker_profiles,
    projects, phone_verifications, platform_settings, admin_audit_logs,
    outbox_events, dead_letter_events, ai_interactions,
    talent_placement_requests,
    "user", session, account, verification, skills
    CASCADE`)

  // ========== FIXED IDs for idempotent re-runs ==========
  const adminId = '00000000-0000-7000-8000-000000000001'
  const client1Id = '00000000-0000-7000-8000-000000000002'
  const client2Id = '00000000-0000-7000-8000-000000000003'
  const worker1Id = '00000000-0000-7000-8000-000000000004'
  const worker2Id = '00000000-0000-7000-8000-000000000005'
  const worker3Id = '00000000-0000-7000-8000-000000000006'
  const worker4Id = '00000000-0000-7000-8000-000000000007'
  const worker5Id = '00000000-0000-7000-8000-000000000008'

  const wp1Id = '00000000-0000-7000-8000-000000000011'
  const wp2Id = '00000000-0000-7000-8000-000000000012'
  const wp3Id = '00000000-0000-7000-8000-000000000013'
  const wp4Id = '00000000-0000-7000-8000-000000000014'
  const wp5Id = '00000000-0000-7000-8000-000000000015'

  const project1Id = '00000000-0000-7000-8000-000000000021'
  const project2Id = '00000000-0000-7000-8000-000000000022'
  const project3Id = '00000000-0000-7000-8000-000000000023'
  const project4Id = '00000000-0000-7000-8000-000000000024'
  const project5Id = '00000000-0000-7000-8000-000000000025'
  const project6Id = '00000000-0000-7000-8000-000000000026'

  // ========== 1. USERS ==========
  console.log('  Seeding users...')
  const usersData = [
    {
      id: adminId,
      email: 'admin@bytz.id',
      name: 'Rizky Administrator',
      phone: '+6281200000001',
      phoneVerified: true,
      role: 'admin' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: client1Id,
      email: 'ahmad@example.com',
      name: 'Ahmad Fadillah',
      phone: '+6281312345678',
      phoneVerified: true,
      role: 'client' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: client2Id,
      email: 'siti@example.com',
      name: 'Siti Nurhaliza',
      phone: '+6285678901234',
      phoneVerified: true,
      role: 'client' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: worker1Id,
      email: 'budi@example.com',
      name: 'Budi Setiawan',
      phone: '+6281398765432',
      phoneVerified: true,
      role: 'worker' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: worker2Id,
      email: 'dewi@example.com',
      name: 'Dewi Lestari',
      phone: '+6287812345678',
      phoneVerified: true,
      role: 'worker' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: worker3Id,
      email: 'eko@example.com',
      name: 'Eko Prasetyo',
      phone: '+6282198765432',
      phoneVerified: true,
      role: 'worker' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: worker4Id,
      email: 'fitri@example.com',
      name: 'Fitri Handayani',
      phone: '+6289912345678',
      phoneVerified: true,
      role: 'worker' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: worker5Id,
      email: 'gunawan@example.com',
      name: 'Gunawan Wibowo',
      phone: '+6281567890123',
      phoneVerified: true,
      role: 'worker' as const,
      isVerified: true,
      locale: 'id' as const,
    },
  ]
  for (const u of usersData) {
    await db.insert(user).values(u).onConflictDoNothing()
  }

  // ========== 2. SKILLS ==========
  console.log('  Seeding skills...')
  const skillData = [
    { name: 'React', category: 'frontend' as const, aliases: ['ReactJS', 'React.js'] },
    { name: 'Vue.js', category: 'frontend' as const, aliases: ['Vue', 'VueJS'] },
    { name: 'Angular', category: 'frontend' as const, aliases: ['AngularJS'] },
    { name: 'Next.js', category: 'frontend' as const, aliases: ['NextJS'] },
    { name: 'TypeScript', category: 'frontend' as const, aliases: ['TS'] },
    { name: 'Tailwind CSS', category: 'frontend' as const, aliases: ['TailwindCSS'] },
    { name: 'HTML/CSS', category: 'frontend' as const, aliases: ['HTML', 'CSS'] },
    { name: 'Node.js', category: 'backend' as const, aliases: ['NodeJS', 'Node'] },
    { name: 'Express', category: 'backend' as const, aliases: ['Express.js'] },
    { name: 'Hono', category: 'backend' as const, aliases: [] },
    { name: 'Python', category: 'backend' as const, aliases: [] },
    { name: 'FastAPI', category: 'backend' as const, aliases: [] },
    { name: 'Django', category: 'backend' as const, aliases: [] },
    { name: 'Go', category: 'backend' as const, aliases: ['Golang'] },
    { name: 'PostgreSQL', category: 'backend' as const, aliases: ['Postgres', 'PG'] },
    { name: 'MongoDB', category: 'backend' as const, aliases: ['Mongo'] },
    { name: 'Redis', category: 'backend' as const, aliases: [] },
    { name: 'PHP', category: 'backend' as const, aliases: ['Laravel'] },
    { name: 'React Native', category: 'mobile' as const, aliases: ['RN'] },
    { name: 'Flutter', category: 'mobile' as const, aliases: [] },
    { name: 'Swift', category: 'mobile' as const, aliases: ['SwiftUI'] },
    { name: 'Kotlin', category: 'mobile' as const, aliases: [] },
    { name: 'Figma', category: 'design' as const, aliases: [] },
    { name: 'Adobe XD', category: 'design' as const, aliases: ['XD'] },
    { name: 'UI Design', category: 'design' as const, aliases: ['User Interface Design'] },
    { name: 'UX Design', category: 'design' as const, aliases: ['User Experience Design'] },
    { name: 'Machine Learning', category: 'data' as const, aliases: ['ML'] },
    { name: 'Data Analysis', category: 'data' as const, aliases: ['Data Analytics'] },
    { name: 'TensorFlow', category: 'data' as const, aliases: ['TF'] },
    { name: 'PyTorch', category: 'data' as const, aliases: [] },
    { name: 'Docker', category: 'devops' as const, aliases: [] },
    { name: 'Kubernetes', category: 'devops' as const, aliases: ['K8s'] },
    { name: 'AWS', category: 'devops' as const, aliases: ['Amazon Web Services'] },
    { name: 'GCP', category: 'devops' as const, aliases: ['Google Cloud Platform'] },
    { name: 'CI/CD', category: 'devops' as const, aliases: [] },
  ]
  for (const skill of skillData) {
    await db
      .insert(skills)
      .values({ id: uuidv7(), ...skill })
      .onConflictDoNothing()
  }
  // Query actual IDs from DB (handles re-runs where inserts are skipped)
  const allSkills = await db.select({ id: skills.id, name: skills.name }).from(skills)
  const skillIds: Record<string, string> = {}
  for (const s of allSkills) {
    skillIds[s.name] = s.id
  }

  // ========== 3. WORKER PROFILES ==========
  console.log('  Seeding worker profiles...')
  const workerProfiles_ = [
    {
      id: wp1Id,
      userId: worker1Id,
      bio: 'Fullstack developer berpengalaman 5 tahun. Spesialisasi di React, Node.js, dan PostgreSQL. Pernah mengerjakan proyek untuk beberapa startup fintech.',
      yearsOfExperience: 5,
      tier: 'senior' as const,
      educationUniversity: 'Institut Teknologi Bandung',
      educationMajor: 'Teknik Informatika',
      educationYear: 2019,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['fintech', 'e-commerce', 'saas'],
      totalProjectsCompleted: 12,
      totalProjectsActive: 1,
      averageRating: 4.8,
      portfolioLinks: [
        { platform: 'GitHub', url: 'https://github.com/budisetiawan' },
        { platform: 'LinkedIn', url: 'https://linkedin.com/in/budisetiawan' },
      ],
    },
    {
      id: wp2Id,
      userId: worker2Id,
      bio: 'UI/UX Designer dengan passion di mobile-first design. 4 tahun pengalaman di agency digital dan in-house design team.',
      yearsOfExperience: 4,
      tier: 'mid' as const,
      educationUniversity: 'Universitas Indonesia',
      educationMajor: 'Desain Komunikasi Visual',
      educationYear: 2020,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce', 'healthcare', 'education'],
      totalProjectsCompleted: 8,
      totalProjectsActive: 0,
      averageRating: 4.6,
      portfolioLinks: [
        { platform: 'Dribbble', url: 'https://dribbble.com/dewilestari' },
        { platform: 'Behance', url: 'https://behance.net/dewilestari' },
      ],
    },
    {
      id: wp3Id,
      userId: worker3Id,
      bio: 'Backend engineer specializing in Go and Python microservices. Experienced with high-traffic systems and distributed architectures.',
      yearsOfExperience: 6,
      tier: 'senior' as const,
      educationUniversity: 'Universitas Gadjah Mada',
      educationMajor: 'Ilmu Komputer',
      educationYear: 2018,
      availabilityStatus: 'busy' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['fintech', 'logistics', 'saas'],
      totalProjectsCompleted: 15,
      totalProjectsActive: 2,
      averageRating: 4.9,
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/ekoprasetyo' }],
    },
    {
      id: wp4Id,
      userId: worker4Id,
      bio: 'Mobile developer (React Native & Flutter). Sudah publish 10+ apps di Play Store dan App Store.',
      yearsOfExperience: 3,
      tier: 'mid' as const,
      educationUniversity: 'Universitas Brawijaya',
      educationMajor: 'Sistem Informasi',
      educationYear: 2021,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce', 'education', 'healthcare'],
      totalProjectsCompleted: 5,
      totalProjectsActive: 0,
      averageRating: 4.4,
      portfolioLinks: [
        { platform: 'GitHub', url: 'https://github.com/fitrihandayani' },
        { platform: 'LinkedIn', url: 'https://linkedin.com/in/fitrihandayani' },
      ],
    },
    {
      id: wp5Id,
      userId: worker5Id,
      bio: 'Fresh graduate yang antusias belajar. Menguasai React dan Node.js dari bootcamp dan proyek personal.',
      yearsOfExperience: 1,
      tier: 'junior' as const,
      educationUniversity: 'Universitas Diponegoro',
      educationMajor: 'Teknik Komputer',
      educationYear: 2024,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce'],
      totalProjectsCompleted: 0,
      totalProjectsActive: 0,
      averageRating: null,
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/gunawanwibowo' }],
    },
  ]
  for (const wp of workerProfiles_) {
    await db.insert(workerProfiles).values(wp).onConflictDoNothing()
  }

  // ========== 4. WORKER SKILLS ==========
  console.log('  Seeding worker skills...')
  const workerSkillsData = [
    // Budi — fullstack
    { workerId: wp1Id, skillName: 'React', proficiency: 'expert' as const, primary: true },
    { workerId: wp1Id, skillName: 'Node.js', proficiency: 'expert' as const, primary: true },
    { workerId: wp1Id, skillName: 'TypeScript', proficiency: 'advanced' as const, primary: false },
    { workerId: wp1Id, skillName: 'PostgreSQL', proficiency: 'advanced' as const, primary: false },
    { workerId: wp1Id, skillName: 'Docker', proficiency: 'intermediate' as const, primary: false },
    // Dewi — designer
    { workerId: wp2Id, skillName: 'Figma', proficiency: 'expert' as const, primary: true },
    { workerId: wp2Id, skillName: 'UI Design', proficiency: 'expert' as const, primary: true },
    { workerId: wp2Id, skillName: 'UX Design', proficiency: 'advanced' as const, primary: false },
    {
      workerId: wp2Id,
      skillName: 'Adobe XD',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    // Eko — backend
    { workerId: wp3Id, skillName: 'Go', proficiency: 'expert' as const, primary: true },
    { workerId: wp3Id, skillName: 'Python', proficiency: 'expert' as const, primary: true },
    { workerId: wp3Id, skillName: 'PostgreSQL', proficiency: 'advanced' as const, primary: false },
    { workerId: wp3Id, skillName: 'Docker', proficiency: 'advanced' as const, primary: false },
    {
      workerId: wp3Id,
      skillName: 'Kubernetes',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    // Fitri — mobile
    { workerId: wp4Id, skillName: 'React Native', proficiency: 'expert' as const, primary: true },
    { workerId: wp4Id, skillName: 'Flutter', proficiency: 'advanced' as const, primary: true },
    {
      workerId: wp4Id,
      skillName: 'TypeScript',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    // Gunawan — junior fullstack
    { workerId: wp5Id, skillName: 'React', proficiency: 'intermediate' as const, primary: true },
    { workerId: wp5Id, skillName: 'Node.js', proficiency: 'beginner' as const, primary: false },
    {
      workerId: wp5Id,
      skillName: 'Tailwind CSS',
      proficiency: 'intermediate' as const,
      primary: false,
    },
  ]
  for (const ws of workerSkillsData) {
    const sid = skillIds[ws.skillName]
    if (sid) {
      await db
        .insert(workerSkills)
        .values({
          workerId: ws.workerId,
          skillId: sid,
          proficiencyLevel: ws.proficiency,
          isPrimary: ws.primary,
        })
        .onConflictDoNothing()
    }
  }

  // ========== 5. PROJECTS ==========
  console.log('  Seeding projects...')
  const projectsData = [
    {
      id: project1Id,
      clientId: client1Id,
      title: 'Platform E-commerce KopiNusantara',
      description:
        'Marketplace online untuk UMKM kopi Indonesia. Fitur: katalog produk, keranjang belanja, pembayaran online (VA, QRIS, e-wallet), dashboard penjual, review & rating, tracking pengiriman.',
      category: 'web_app' as const,
      status: 'in_progress' as const,
      budgetMin: 35000000,
      budgetMax: 55000000,
      estimatedTimelineDays: 60,
      teamSize: 3,
      finalPrice: 52000000,
      platformFee: 10400000,
      workerPayout: 41600000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
    },
    {
      id: project2Id,
      clientId: client1Id,
      title: 'Mobile App Booking Lapangan Futsal',
      description:
        'Aplikasi mobile untuk booking lapangan futsal secara online. Fitur: cari lapangan terdekat, booking real-time, pembayaran online, notifikasi reminder, riwayat booking, rating lapangan.',
      category: 'mobile_app' as const,
      status: 'matching' as const,
      budgetMin: 20000000,
      budgetMax: 35000000,
      estimatedTimelineDays: 45,
      teamSize: 2,
      finalPrice: 30000000,
      platformFee: 7500000,
      workerPayout: 22500000,
      preferences: { requiredSkills: ['React Native', 'Node.js'] },
    },
    {
      id: project3Id,
      clientId: client2Id,
      title: 'Dashboard Analytics Internal',
      description:
        'Dashboard analytics untuk monitoring performa bisnis. Visualisasi data penjualan, customer insights, inventory tracking, dan reporting otomatis per periode.',
      category: 'data_ai' as const,
      status: 'brd_generated' as const,
      budgetMin: 15000000,
      budgetMax: 25000000,
      estimatedTimelineDays: 30,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      workerPayout: null,
      preferences: { requiredSkills: ['React', 'Python', 'PostgreSQL'] },
    },
    {
      id: project4Id,
      clientId: client2Id,
      title: 'Redesign UI/UX Aplikasi Travel',
      description:
        'Redesign total UI/UX untuk aplikasi booking travel. Meliputi: user research, wireframing, prototyping di Figma, design system, handoff ke developer.',
      category: 'ui_ux_design' as const,
      status: 'completed' as const,
      budgetMin: 10000000,
      budgetMax: 18000000,
      estimatedTimelineDays: 21,
      teamSize: 1,
      finalPrice: 15000000,
      platformFee: 3750000,
      workerPayout: 11250000,
      preferences: { requiredSkills: ['Figma', 'UI Design', 'UX Design'] },
    },
    {
      id: project5Id,
      clientId: client1Id,
      title: 'Sistem Manajemen Inventori Gudang',
      description:
        'Aplikasi web untuk manajemen stok gudang. Fitur: barcode scanning, stok real-time, purchase order, supplier management, laporan bulanan, alert stok minimum.',
      category: 'web_app' as const,
      status: 'prd_approved' as const,
      budgetMin: 25000000,
      budgetMax: 40000000,
      estimatedTimelineDays: 45,
      teamSize: 2,
      finalPrice: 38000000,
      platformFee: 7600000,
      workerPayout: 30400000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
    },
    {
      id: project6Id,
      clientId: client2Id,
      title: 'Landing Page Startup Edtech',
      description:
        'Landing page modern untuk startup edtech. Desain responsif, animasi scroll, integrasi form pendaftaran, SEO optimization.',
      category: 'web_app' as const,
      status: 'draft' as const,
      budgetMin: 3000000,
      budgetMax: 8000000,
      estimatedTimelineDays: 14,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      workerPayout: null,
      preferences: {},
    },
  ]
  for (const p of projectsData) {
    await db.insert(projects).values(p).onConflictDoNothing()
  }

  // ========== 6. PROJECT STATUS LOGS ==========
  console.log('  Seeding status logs...')
  for (const p of projectsData) {
    await db
      .insert(projectStatusLogs)
      .values({
        id: uuidv7(),
        projectId: p.id,
        fromStatus: 'draft',
        toStatus: p.status,
        changedBy: p.clientId,
        reason: 'Project created',
      })
      .onConflictDoNothing()
  }

  // ========== 7. BRD DOCUMENTS ==========
  console.log('  Seeding BRD documents...')
  await db
    .insert(brdDocuments)
    .values({
      id: uuidv7(),
      projectId: project1Id,
      version: 1,
      status: 'approved',
      price: 2500000,
      content: {
        executiveSummary:
          'Platform e-commerce untuk UMKM kopi Indonesia yang memungkinkan penjual mengelola toko online dengan mudah dan pembeli mendapatkan kopi berkualitas dari seluruh Indonesia.',
        businessObjectives: [
          'Meningkatkan penjualan UMKM kopi 50% dalam 1 tahun',
          'Mencapai 10.000 pengguna aktif dalam 6 bulan',
          'Mengurangi biaya distribusi kopi 30%',
        ],
        scope:
          'Web application responsif dengan fitur marketplace, payment gateway, dan dashboard analytics.',
        functionalRequirements: [
          { title: 'Manajemen Toko', content: 'CRUD toko, profil penjual, verifikasi identitas' },
          {
            title: 'Katalog Produk',
            content: 'CRUD produk, kategori, filter, pencarian, galeri foto',
          },
          {
            title: 'Keranjang & Checkout',
            content: 'Cart, multiple payment (VA, QRIS, e-wallet), ongkir',
          },
          {
            title: 'Dashboard Analytics',
            content: 'Penjualan harian/mingguan, top produk, konversi',
          },
        ],
        nonFunctionalRequirements: [
          'Response time < 2 detik',
          'Uptime 99.5%',
          'Support 1000 concurrent users',
        ],
        estimatedPriceMin: 35000000,
        estimatedPriceMax: 55000000,
        estimatedTimelineDays: 60,
        estimatedTeamSize: 3,
        riskAssessment: [
          'Timeline ketat untuk scope yang luas',
          'Integrasi payment gateway butuh testing ekstra',
        ],
      },
    })
    .onConflictDoNothing()

  await db
    .insert(brdDocuments)
    .values({
      id: uuidv7(),
      projectId: project3Id,
      version: 1,
      status: 'review',
      price: 1500000,
      content: {
        executiveSummary: 'Dashboard analytics untuk monitoring performa bisnis secara real-time.',
        businessObjectives: ['Reduce reporting time by 80%', 'Enable data-driven decisions'],
        scope: 'Web dashboard with data visualization and automated reporting.',
        functionalRequirements: [
          { title: 'Data Visualization', content: 'Charts, graphs, heatmaps' },
        ],
        nonFunctionalRequirements: ['Load time < 3 seconds for complex queries'],
        estimatedPriceMin: 15000000,
        estimatedPriceMax: 25000000,
        estimatedTimelineDays: 30,
        estimatedTeamSize: 1,
        riskAssessment: ['Data integration complexity'],
      },
    })
    .onConflictDoNothing()

  // ========== 8. WORK PACKAGES (for project1 — in_progress) ==========
  console.log('  Seeding work packages...')
  const wpkg1Id = uuidv7()
  const wpkg2Id = uuidv7()
  const wpkg3Id = uuidv7()
  await db
    .insert(workPackages)
    .values([
      {
        id: wpkg1Id,
        projectId: project1Id,
        title: 'Backend API Development',
        description: 'REST API, database design, authentication, payment integration',
        orderIndex: 0,
        requiredSkills: ['Node.js', 'PostgreSQL'],
        estimatedHours: 160,
        amount: 18000000,
        workerPayout: 14400000,
        status: 'in_progress' as const,
      },
      {
        id: wpkg2Id,
        projectId: project1Id,
        title: 'Frontend Development',
        description: 'React SPA, responsive design, state management, API integration',
        orderIndex: 1,
        requiredSkills: ['React', 'TypeScript', 'Tailwind CSS'],
        estimatedHours: 140,
        amount: 16000000,
        workerPayout: 12800000,
        status: 'in_progress' as const,
      },
      {
        id: wpkg3Id,
        projectId: project1Id,
        title: 'UI/UX Design',
        description: 'Wireframes, mockups, design system, prototyping di Figma',
        orderIndex: 2,
        requiredSkills: ['Figma', 'UI Design'],
        estimatedHours: 80,
        amount: 8000000,
        workerPayout: 6400000,
        status: 'in_progress' as const,
      },
    ])
    .onConflictDoNothing()

  // ========== 9. PROJECT ASSIGNMENTS ==========
  console.log('  Seeding assignments...')
  for (const assignment of [
    {
      id: uuidv7(),
      projectId: project1Id,
      workerId: wp3Id,
      workPackageId: wpkg1Id,
      roleLabel: 'Backend Developer',
      acceptanceStatus: 'accepted' as const,
      status: 'active' as const,
      startedAt: new Date('2026-02-01'),
    },
    {
      id: uuidv7(),
      projectId: project1Id,
      workerId: wp1Id,
      workPackageId: wpkg2Id,
      roleLabel: 'Frontend Developer',
      acceptanceStatus: 'accepted' as const,
      status: 'active' as const,
      startedAt: new Date('2026-02-01'),
    },
    {
      id: uuidv7(),
      projectId: project1Id,
      workerId: wp2Id,
      workPackageId: wpkg3Id,
      roleLabel: 'UI/UX Designer',
      acceptanceStatus: 'accepted' as const,
      status: 'active' as const,
      startedAt: new Date('2026-02-01'),
    },
  ]) {
    await db.insert(projectAssignments).values(assignment).onConflictDoNothing()
  }

  // ========== 10. MILESTONES ==========
  console.log('  Seeding milestones...')
  const ms1 = uuidv7(),
    ms2 = uuidv7(),
    ms3 = uuidv7(),
    ms4 = uuidv7(),
    ms5 = uuidv7(),
    ms6 = uuidv7()
  await db
    .insert(milestones)
    .values([
      {
        id: ms1,
        projectId: project1Id,
        workPackageId: wpkg1Id,
        assignedWorkerId: wp3Id,
        title: 'Database Schema & API Foundation',
        description: 'Design database, setup Hono API, authentication endpoints',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 6000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-02-15'),
        submittedAt: new Date('2026-02-14'),
        completedAt: new Date('2026-02-15'),
      },
      {
        id: ms2,
        projectId: project1Id,
        workPackageId: wpkg1Id,
        assignedWorkerId: wp3Id,
        title: 'Payment Gateway Integration',
        description: 'Midtrans integration, escrow logic, webhook handlers',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 6000000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-01'),
      },
      {
        id: ms3,
        projectId: project1Id,
        workPackageId: wpkg1Id,
        assignedWorkerId: wp3Id,
        title: 'Product & Order API',
        description: 'CRUD products, orders, cart, search, filtering',
        milestoneType: 'individual' as const,
        orderIndex: 2,
        amount: 6000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-15'),
      },
      {
        id: ms4,
        projectId: project1Id,
        workPackageId: wpkg2Id,
        assignedWorkerId: wp1Id,
        title: 'Landing Page & Auth UI',
        description: 'Homepage, login, register, responsive layout',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 5000000,
        status: 'submitted' as const,
        revisionCount: 1,
        dueDate: new Date('2026-02-20'),
        submittedAt: new Date('2026-02-19'),
      },
      {
        id: ms5,
        projectId: project1Id,
        workPackageId: wpkg2Id,
        assignedWorkerId: wp1Id,
        title: 'Product Catalog & Cart UI',
        description: 'Product listing, detail, cart, checkout flow',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 5500000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-05'),
      },
      {
        id: ms6,
        projectId: project1Id,
        workPackageId: wpkg3Id,
        assignedWorkerId: wp2Id,
        title: 'Complete Design System & Mockups',
        description: 'Design system, all page mockups, interactive prototype',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 8000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-02-10'),
        submittedAt: new Date('2026-02-09'),
        completedAt: new Date('2026-02-10'),
      },
    ])
    .onConflictDoNothing()

  // ========== 11. TASKS ==========
  console.log('  Seeding tasks...')
  const task1 = uuidv7(),
    task2 = uuidv7(),
    task3 = uuidv7(),
    task4 = uuidv7()
  await db
    .insert(tasks)
    .values([
      {
        id: task1,
        milestoneId: ms2,
        assignedWorkerId: wp3Id,
        title: 'Setup Midtrans sandbox',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 6,
        startDate: new Date('2026-02-16'),
        endDate: new Date('2026-02-18'),
      },
      {
        id: task2,
        milestoneId: ms2,
        assignedWorkerId: wp3Id,
        title: 'Implement webhook handlers',
        orderIndex: 1,
        status: 'in_progress' as const,
        estimatedHours: 16,
        actualHours: 10,
        startDate: new Date('2026-02-19'),
      },
      {
        id: task3,
        milestoneId: ms4,
        assignedWorkerId: wp1Id,
        title: 'Build responsive header & navigation',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 7,
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-02-03'),
      },
      {
        id: task4,
        milestoneId: ms4,
        assignedWorkerId: wp1Id,
        title: 'Implement auth forms & OAuth',
        orderIndex: 1,
        status: 'completed' as const,
        estimatedHours: 12,
        actualHours: 11,
        startDate: new Date('2026-02-04'),
        endDate: new Date('2026-02-08'),
      },
    ])
    .onConflictDoNothing()

  // ========== 12. TIME LOGS ==========
  console.log('  Seeding time logs...')
  await db
    .insert(timeLogs)
    .values([
      {
        id: uuidv7(),
        taskId: task1,
        workerId: wp3Id,
        startedAt: new Date('2026-02-16T09:00:00Z'),
        endedAt: new Date('2026-02-16T12:30:00Z'),
        durationMinutes: 210,
        description: 'Setup Midtrans sandbox environment & API keys',
      },
      {
        id: uuidv7(),
        taskId: task1,
        workerId: wp3Id,
        startedAt: new Date('2026-02-17T09:00:00Z'),
        endedAt: new Date('2026-02-17T12:00:00Z'),
        durationMinutes: 180,
        description: 'Implement payment creation flow',
      },
      {
        id: uuidv7(),
        taskId: task2,
        workerId: wp3Id,
        startedAt: new Date('2026-02-19T09:00:00Z'),
        endedAt: new Date('2026-02-19T14:00:00Z'),
        durationMinutes: 300,
        description: 'Webhook signature verification & status mapping',
      },
      {
        id: uuidv7(),
        taskId: task3,
        workerId: wp1Id,
        startedAt: new Date('2026-02-01T08:00:00Z'),
        endedAt: new Date('2026-02-01T16:00:00Z'),
        durationMinutes: 480,
        description: 'Header component, responsive nav, mobile menu',
      },
      {
        id: uuidv7(),
        taskId: task4,
        workerId: wp1Id,
        startedAt: new Date('2026-02-04T09:00:00Z'),
        endedAt: new Date('2026-02-04T17:00:00Z'),
        durationMinutes: 480,
        description: 'Login form, register form with validation',
      },
    ])
    .onConflictDoNothing()

  // ========== 13. TRANSACTIONS & ACCOUNTS ==========
  console.log('  Seeding transactions...')
  const platformAccId = uuidv7()
  const escrowAccId = uuidv7()
  await db
    .insert(accounts)
    .values([
      {
        id: platformAccId,
        ownerType: 'platform' as const,
        accountType: 'revenue' as const,
        name: 'Platform Revenue',
        balance: 14150000,
        currency: 'IDR',
      },
      {
        id: escrowAccId,
        ownerType: 'escrow' as const,
        accountType: 'asset' as const,
        name: 'Escrow Holding',
        balance: 52000000,
        currency: 'IDR',
      },
    ])
    .onConflictDoNothing()

  const txn1 = uuidv7(),
    txn2 = uuidv7(),
    txn3 = uuidv7(),
    txn4 = uuidv7()
  await db
    .insert(transactions)
    .values([
      {
        id: txn1,
        projectId: project1Id,
        type: 'escrow_in' as const,
        amount: 52000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026021001',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn2,
        projectId: project1Id,
        milestoneId: ms1,
        workerId: wp3Id,
        type: 'escrow_release' as const,
        amount: 4800000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn3,
        projectId: project1Id,
        milestoneId: ms6,
        workerId: wp2Id,
        type: 'escrow_release' as const,
        amount: 6400000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn4,
        projectId: project3Id,
        type: 'brd_payment' as const,
        amount: 1500000,
        status: 'completed' as const,
        paymentMethod: 'qris',
        paymentGatewayRef: 'MTR-2026030501',
        idempotencyKey: uuidv7(),
      },
    ])
    .onConflictDoNothing()

  // ========== 14. REVIEWS ==========
  console.log('  Seeding reviews...')
  await db
    .insert(reviews)
    .values([
      {
        id: uuidv7(),
        projectId: project4Id,
        reviewerId: client2Id,
        revieweeId: worker2Id,
        rating: 5,
        comment:
          'Desain sangat bagus dan sesuai brief. Komunikasi lancar, revisi cepat. Sangat merekomendasikan!',
        type: 'client_to_worker' as const,
      },
      {
        id: uuidv7(),
        projectId: project4Id,
        reviewerId: worker2Id,
        revieweeId: client2Id,
        rating: 5,
        comment: 'Client yang kooperatif, brief jelas, feedback tepat waktu. Senang bekerja sama!',
        type: 'worker_to_client' as const,
      },
    ])
    .onConflictDoNothing()

  // ========== 15. NOTIFICATIONS ==========
  console.log('  Seeding notifications...')
  await db
    .insert(notifications)
    .values([
      {
        id: uuidv7(),
        userId: client1Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disubmit',
        message: 'Budi Setiawan telah mensubmit milestone "Landing Page & Auth UI" untuk review.',
        link: `/projects/${project1Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: client1Id,
        type: 'payment' as const,
        title: 'Pembayaran Berhasil',
        message: 'Escrow Rp 52.000.000 untuk proyek KopiNusantara berhasil diterima.',
        link: `/payments`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: worker1Id,
        type: 'project_match' as const,
        title: 'Proyek Baru Cocok',
        message: 'Proyek "Sistem Manajemen Inventori" cocok dengan skill Anda. Lihat detail?',
        link: `/projects/${project5Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: worker2Id,
        type: 'payment' as const,
        title: 'Dana Cair',
        message:
          'Pembayaran Rp 6.400.000 untuk milestone Design System telah dicairkan ke rekening Anda.',
        link: `/payments`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: worker3Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disetujui',
        message: 'Milestone "Database Schema & API Foundation" telah disetujui oleh client.',
        link: `/projects/${project1Id}/milestones`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'system' as const,
        title: 'Worker Baru Terdaftar',
        message: 'Gunawan Wibowo telah mendaftar sebagai worker dan menunggu verifikasi CV.',
        link: `/admin/users`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'dispute' as const,
        title: 'Dispute Baru',
        message:
          'Client Siti melaporkan dispute pada proyek "Dashboard Analytics" terkait keterlambatan.',
        link: `/admin/disputes`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: client1Id,
        type: 'team_formation' as const,
        title: 'Tim Terbentuk',
        message: 'Semua posisi untuk proyek KopiNusantara telah terisi. Proyek siap dimulai!',
        link: `/projects/${project1Id}`,
        isRead: true,
      },
    ])
    .onConflictDoNothing()

  // ========== 16. CHAT CONVERSATIONS ==========
  console.log('  Seeding chat conversations...')
  const conv1 = uuidv7()
  const conv2 = uuidv7()
  await db
    .insert(chatConversations)
    .values([
      { id: conv1, projectId: project1Id, type: 'ai_scoping' as const },
      { id: conv2, projectId: project1Id, type: 'team_group' as const },
    ])
    .onConflictDoNothing()

  await db
    .insert(chatMessages)
    .values([
      {
        id: uuidv7(),
        conversationId: conv1,
        senderType: 'ai' as const,
        content:
          'Halo! Saya akan membantu Anda mendefinisikan kebutuhan proyek. Bisa ceritakan tentang platform e-commerce kopi yang ingin Anda buat?',
      },
      {
        id: uuidv7(),
        conversationId: conv1,
        senderType: 'user' as const,
        senderId: client1Id,
        content:
          'Saya ingin membuat marketplace online khusus kopi Indonesia. Target pengguna UMKM kopi dari berbagai daerah.',
      },
      {
        id: uuidv7(),
        conversationId: conv1,
        senderType: 'ai' as const,
        content:
          'Menarik! Beberapa pertanyaan: 1) Apakah ingin fitur subscription/langganan kopi? 2) Integrasi dengan kurir mana saja? 3) Apakah perlu fitur review/rating?',
      },
      {
        id: uuidv7(),
        conversationId: conv2,
        senderType: 'user' as const,
        senderId: worker3Id,
        content:
          'Tim, saya sudah selesai setup database schema. Silakan review entity relationship diagram di link ini.',
      },
      {
        id: uuidv7(),
        conversationId: conv2,
        senderType: 'user' as const,
        senderId: worker1Id,
        content:
          'Terima kasih Eko. Saya akan mulai integrasi frontend dengan API setelah endpoint auth ready.',
      },
      {
        id: uuidv7(),
        conversationId: conv2,
        senderType: 'user' as const,
        senderId: worker2Id,
        content:
          'Design system sudah finalize. Saya share Figma link ke semua. Tolong follow design tokens ya.',
      },
    ])
    .onConflictDoNothing()

  // ========== 17. DISPUTES ==========
  console.log('  Seeding disputes...')
  await db
    .insert(disputes)
    .values({
      id: uuidv7(),
      projectId: project3Id,
      initiatedBy: client2Id,
      againstUserId: worker3Id,
      reason:
        'Worker tidak responsif selama 5 hari dan progress milestone terhenti tanpa pemberitahuan.',
      evidenceUrls: ['https://storage.bytz.id/evidence/screenshot-chat-1.png'],
      status: 'open' as const,
    })
    .onConflictDoNothing()

  // ========== 18. PLATFORM SETTINGS ==========
  console.log('  Seeding platform settings...')
  const settingsData = [
    {
      key: 'margin_rate_below_10m',
      value: { min: 0.25, max: 0.3 },
      description: 'Margin rate untuk proyek < Rp 10 juta',
    },
    {
      key: 'margin_rate_10m_50m',
      value: { min: 0.2, max: 0.25 },
      description: 'Margin rate untuk proyek Rp 10-50 juta',
    },
    {
      key: 'margin_rate_50m_100m',
      value: { min: 0.15, max: 0.2 },
      description: 'Margin rate untuk proyek Rp 50-100 juta',
    },
    {
      key: 'margin_rate_above_100m',
      value: { min: 0.1, max: 0.15 },
      description: 'Margin rate untuk proyek > Rp 100 juta',
    },
    {
      key: 'exploration_rate',
      value: 0.3,
      description: 'Epsilon-greedy exploration rate untuk matching',
    },
    {
      key: 'auto_release_days',
      value: 14,
      description: 'Hari otomatis release escrow setelah submit',
    },
    { key: 'free_revision_rounds', value: 2, description: 'Jumlah revisi gratis per milestone' },
    { key: 'max_team_size', value: 8, description: 'Maksimum worker per proyek' },
  ]
  for (const s of settingsData) {
    await db
      .insert(platformSettings)
      .values({
        id: uuidv7(),
        key: s.key,
        value: s.value,
        description: s.description,
        updatedBy: adminId,
      })
      .onConflictDoNothing()
  }

  // ========== 19. PROJECT APPLICATIONS ==========
  console.log('  Seeding project applications...')
  await db
    .insert(projectApplications)
    .values([
      {
        id: uuidv7(),
        projectId: project2Id,
        workerId: wp4Id,
        status: 'pending' as const,
        coverNote:
          'Saya tertarik dengan proyek mobile booking ini. Sudah punya pengalaman di 3 proyek booking serupa.',
        recommendationScore: 0.87,
      },
      {
        id: uuidv7(),
        projectId: project2Id,
        workerId: wp5Id,
        status: 'pending' as const,
        coverNote:
          'Meskipun fresh graduate, saya sangat antusias dan sudah buat app booking sederhana sebagai portfolio.',
        recommendationScore: 0.65,
      },
      {
        id: uuidv7(),
        projectId: project5Id,
        workerId: wp1Id,
        status: 'pending' as const,
        coverNote:
          'Full-stack web app adalah spesialisasi saya. Sistem inventori mirip dengan proyek yang pernah saya kerjakan.',
        recommendationScore: 0.82,
      },
    ])
    .onConflictDoNothing()

  console.log('Seed completed successfully!')
  console.log(`
  Created:
    - 8 users (1 admin, 2 clients, 5 workers)
    - 35 skills across 7 categories
    - 5 worker profiles with skills
    - 6 projects with varied statuses
    - 3 work packages for active project
    - 6 milestones with varied statuses
    - 4 tasks
    - 5 time log entries
    - 2 accounts + 4 transactions
    - 2 reviews
    - 8 notifications
    - 2 chat conversations + 6 messages
    - 1 dispute
    - 8 platform settings
    - 3 project applications
  `)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
