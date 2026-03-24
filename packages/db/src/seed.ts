import { uuidv7 } from 'uuidv7'
import { getDb } from './client'
import {
  accounts,
  account as authAccount,
  brdDocuments,
  chatConversations,
  chatMessages,
  chatParticipants,
  contracts,
  disputes,
  ledgerEntries,
  milestoneComments,
  milestones,
  notifications,
  platformSettings,
  prdDocuments,
  projectActivities,
  projectApplications,
  projectAssignments,
  projectStatusLogs,
  projects,
  reviews,
  revisionRequests,
  skills,
  talentPlacementRequests,
  talentProfiles,
  talentSkills,
  tasks,
  timeLogs,
  transactionEvents,
  transactions,
  user,
  workPackageDependencies,
  workPackages,
} from './schema'

async function seed() {
  const db = getDb(process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)

  console.log('Seeding database...')

  // Clean all tables using TRUNCATE CASCADE
  console.log('  Cleaning previous seed data...')
  await db.execute(`TRUNCATE TABLE
    time_logs, tasks, milestone_files, milestone_comments, revision_requests,
    chat_messages, chat_participants, chat_conversations,
    ledger_entries, accounts, transaction_events, transactions,
    project_applications, project_assignments, contracts,
    milestones, work_package_dependencies, work_packages, task_dependencies,
    brd_documents, prd_documents, project_activities, project_status_logs,
    disputes, reviews, notifications,
    talent_skills, talent_assessments, talent_penalties, talent_profiles,
    talent_placement_requests,
    projects, phone_verifications, platform_settings, admin_audit_logs,
    outbox_events, dead_letter_events, ai_interactions,
    "user", session, account, verification, skills
    CASCADE`)

  // ========== FIXED IDs ==========
  const adminId = '00000000-0000-7000-8000-000000000001'
  const admin2Id = '00000000-0000-7000-8000-000000000002'
  const owner1Id = '00000000-0000-7000-8000-000000000010'
  const owner2Id = '00000000-0000-7000-8000-000000000011'
  const owner3Id = '00000000-0000-7000-8000-000000000012'
  const talent1Id = '00000000-0000-7000-8000-000000000020'
  const talent2Id = '00000000-0000-7000-8000-000000000021'
  const talent3Id = '00000000-0000-7000-8000-000000000022'
  const talent4Id = '00000000-0000-7000-8000-000000000023'
  const talent5Id = '00000000-0000-7000-8000-000000000024'
  const talent6Id = '00000000-0000-7000-8000-000000000025'
  const talent7Id = '00000000-0000-7000-8000-000000000026'

  const tp1Id = '00000000-0000-7000-8000-000000000030'
  const tp2Id = '00000000-0000-7000-8000-000000000031'
  const tp3Id = '00000000-0000-7000-8000-000000000032'
  const tp4Id = '00000000-0000-7000-8000-000000000033'
  const tp5Id = '00000000-0000-7000-8000-000000000034'
  const tp6Id = '00000000-0000-7000-8000-000000000035'
  const tp7Id = '00000000-0000-7000-8000-000000000036'

  const project1Id = '00000000-0000-7000-8000-000000000040'
  const project2Id = '00000000-0000-7000-8000-000000000041'
  const project3Id = '00000000-0000-7000-8000-000000000042'
  const project4Id = '00000000-0000-7000-8000-000000000043'
  const project5Id = '00000000-0000-7000-8000-000000000044'
  const project6Id = '00000000-0000-7000-8000-000000000045'
  const project7Id = '00000000-0000-7000-8000-000000000046'
  const project8Id = '00000000-0000-7000-8000-000000000047'
  const project9Id = '00000000-0000-7000-8000-000000000048'
  const project10Id = '00000000-0000-7000-8000-000000000049'

  const wpkg1Id = '00000000-0000-7000-8000-000000000050'
  const wpkg2Id = '00000000-0000-7000-8000-000000000051'
  const wpkg3Id = '00000000-0000-7000-8000-000000000052'
  const wpkg4Id = '00000000-0000-7000-8000-000000000053'
  const wpkg5Id = '00000000-0000-7000-8000-000000000054'
  const wpkg6Id = '00000000-0000-7000-8000-000000000055'

  const assign1Id = '00000000-0000-7000-8000-000000000060'
  const assign2Id = '00000000-0000-7000-8000-000000000061'
  const assign3Id = '00000000-0000-7000-8000-000000000062'
  const assign4Id = '00000000-0000-7000-8000-000000000063'

  const ms1Id = '00000000-0000-7000-8000-000000000070'
  const ms2Id = '00000000-0000-7000-8000-000000000071'
  const ms3Id = '00000000-0000-7000-8000-000000000072'
  const ms4Id = '00000000-0000-7000-8000-000000000073'
  const ms5Id = '00000000-0000-7000-8000-000000000074'
  const ms6Id = '00000000-0000-7000-8000-000000000075'
  const ms7Id = '00000000-0000-7000-8000-000000000076'
  const ms8Id = '00000000-0000-7000-8000-000000000077'
  const ms9Id = '00000000-0000-7000-8000-000000000078'
  const ms10Id = '00000000-0000-7000-8000-000000000079'
  const ms11Id = '00000000-0000-7000-8000-00000000007a'
  const ms12Id = '00000000-0000-7000-8000-00000000007b'

  const task1Id = '00000000-0000-7000-8000-000000000080'
  const task2Id = '00000000-0000-7000-8000-000000000081'
  const task3Id = '00000000-0000-7000-8000-000000000082'
  const task4Id = '00000000-0000-7000-8000-000000000083'
  const task5Id = '00000000-0000-7000-8000-000000000084'
  const task6Id = '00000000-0000-7000-8000-000000000085'
  const task7Id = '00000000-0000-7000-8000-000000000086'
  const task8Id = '00000000-0000-7000-8000-000000000087'
  const task9Id = '00000000-0000-7000-8000-000000000088'
  const task10Id = '00000000-0000-7000-8000-000000000089'

  const txn1Id = '00000000-0000-7000-8000-000000000090'
  const txn2Id = '00000000-0000-7000-8000-000000000091'
  const txn3Id = '00000000-0000-7000-8000-000000000092'
  const txn4Id = '00000000-0000-7000-8000-000000000093'
  const txn5Id = '00000000-0000-7000-8000-000000000094'
  const txn6Id = '00000000-0000-7000-8000-000000000095'
  const txn7Id = '00000000-0000-7000-8000-000000000096'
  const txn8Id = '00000000-0000-7000-8000-000000000097'
  const txn9Id = '00000000-0000-7000-8000-000000000098'
  const txn10Id = '00000000-0000-7000-8000-000000000099'
  const txn11Id = '00000000-0000-7000-8000-00000000009a'
  const txn12Id = '00000000-0000-7000-8000-00000000009b'

  const platformAccId = '00000000-0000-7000-8000-0000000000a0'
  const escrowAccId = '00000000-0000-7000-8000-0000000000a1'
  const owner1AccId = '00000000-0000-7000-8000-0000000000a2'
  const owner2AccId = '00000000-0000-7000-8000-0000000000a3'
  const talent1AccId = '00000000-0000-7000-8000-0000000000a4'
  const talent2AccId = '00000000-0000-7000-8000-0000000000a5'
  const talent3AccId = '00000000-0000-7000-8000-0000000000a6'

  const conv1Id = '00000000-0000-7000-8000-0000000000b0'
  const conv2Id = '00000000-0000-7000-8000-0000000000b1'
  const conv3Id = '00000000-0000-7000-8000-0000000000b2'
  const conv4Id = '00000000-0000-7000-8000-0000000000b3'

  // ========== 1. USERS (12 users) ==========
  console.log('  Seeding users...')
  const usersData = [
    {
      id: adminId,
      email: 'admin@bytz.id',
      name: 'Rizky Adminanto',
      phone: '+6281200000001',
      phoneVerified: true,
      role: 'admin' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: admin2Id,
      email: 'superadmin@bytz.id',
      name: 'Mega Susanti',
      phone: '+6281200000002',
      phoneVerified: true,
      role: 'admin' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner1Id,
      email: 'ahmad@kopinusantara.id',
      name: 'Ahmad Fadillah',
      phone: '+6281312345678',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner2Id,
      email: 'siti@traveloka.com',
      name: 'Siti Nurhaliza',
      phone: '+6285678901234',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner3Id,
      email: 'rahmat@gudangcerdas.co.id',
      name: 'Rahmat Hidayat',
      phone: '+6281455667788',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: talent1Id,
      email: 'budi@example.com',
      name: 'Budi Setiawan',
      phone: '+6281398765432',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: talent2Id,
      email: 'dewi@example.com',
      name: 'Dewi Lestari',
      phone: '+6287812345678',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: talent3Id,
      email: 'eko@example.com',
      name: 'Eko Prasetyo',
      phone: '+6282198765432',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: talent4Id,
      email: 'fitri@example.com',
      name: 'Fitri Handayani',
      phone: '+6289912345678',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: talent5Id,
      email: 'gunawan@example.com',
      name: 'Gunawan Wibowo',
      phone: '+6281567890123',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: talent6Id,
      email: 'hana@example.com',
      name: 'Hana Permata',
      phone: '+6285711223344',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'en' as const,
    },
    {
      id: talent7Id,
      email: 'irfan@example.com',
      name: 'Irfan Maulana',
      phone: '+6281344556677',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
  ]
  for (const u of usersData) {
    await db.insert(user).values(u).onConflictDoNothing()
  }

  // ========== 2. BETTER AUTH ACCOUNTS ==========
  console.log('  Seeding auth accounts...')
  const seedPassword = 'Password123!'
  // Better Auth uses scrypt: "salt_hex:derived_key_hex"
  // Use @noble/hashes (same library Better Auth uses)
  const { scryptAsync } = await import('@noble/hashes/scrypt.js')
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(saltBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const keyBytes = await scryptAsync(seedPassword.normalize('NFKC'), saltHex, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
  })
  const keyHex = Array.from(keyBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const hashedPassword = `${saltHex}:${keyHex}`
  for (const u of usersData) {
    await db
      .insert(authAccount)
      .values({
        id: `acc-${u.id}`,
        accountId: u.id,
        providerId: 'credential',
        userId: u.id,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
  }

  // ========== 3. SKILLS (35 skills) ==========
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
  const allSkills = await db.select({ id: skills.id, name: skills.name }).from(skills)
  const skillIds: Record<string, string> = {}
  for (const s of allSkills) {
    skillIds[s.name] = s.id
  }

  // ========== 4. TALENT PROFILES (7 profiles) ==========
  console.log('  Seeding talent profiles...')
  const talentProfilesData = [
    {
      id: tp1Id,
      userId: talent1Id,
      bio: 'Fullstack developer berpengalaman 5 tahun. Spesialisasi di React, Node.js, dan PostgreSQL. Pernah mengerjakan proyek untuk beberapa startup fintech di Jakarta.',
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
      id: tp2Id,
      userId: talent2Id,
      bio: 'UI/UX Designer dengan passion di mobile-first design. 4 tahun pengalaman di agency digital dan in-house design team. Terbiasa user research dan usability testing.',
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
      id: tp3Id,
      userId: talent3Id,
      bio: 'Backend engineer specializing in Go and Python microservices. Experienced with high-traffic systems and distributed architectures at scale.',
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
      id: tp4Id,
      userId: talent4Id,
      bio: 'Mobile developer (React Native & Flutter). Sudah publish 10+ apps di Play Store dan App Store. Spesialis cross-platform mobile.',
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
      id: tp5Id,
      userId: talent5Id,
      bio: 'Fresh graduate yang antusias belajar. Menguasai React dan Node.js dari bootcamp Hacktiv8 dan proyek personal.',
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
    {
      id: tp6Id,
      userId: talent6Id,
      bio: 'Data scientist dan ML engineer. Pengalaman membangun recommendation systems dan NLP pipelines untuk startup e-commerce dan healthtech.',
      yearsOfExperience: 4,
      tier: 'mid' as const,
      educationUniversity: 'Institut Teknologi Sepuluh Nopember',
      educationMajor: 'Teknik Informatika',
      educationYear: 2020,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce', 'healthcare', 'saas'],
      totalProjectsCompleted: 6,
      totalProjectsActive: 1,
      averageRating: 4.5,
      portfolioLinks: [
        { platform: 'GitHub', url: 'https://github.com/hanapermata' },
        { platform: 'LinkedIn', url: 'https://linkedin.com/in/hanapermata' },
      ],
    },
    {
      id: tp7Id,
      userId: talent7Id,
      bio: 'DevOps engineer berpengalaman dengan AWS, Docker, dan Kubernetes. Suka automasi infrastructure dan CI/CD pipeline.',
      yearsOfExperience: 5,
      tier: 'senior' as const,
      educationUniversity: 'Universitas Padjadjaran',
      educationMajor: 'Teknik Informatika',
      educationYear: 2019,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['fintech', 'logistics', 'saas'],
      totalProjectsCompleted: 10,
      totalProjectsActive: 0,
      averageRating: 4.7,
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/irfanmaulana' }],
    },
  ]
  for (const tp of talentProfilesData) {
    await db.insert(talentProfiles).values(tp).onConflictDoNothing()
  }

  // ========== 5. TALENT SKILLS ==========
  console.log('  Seeding talent skills...')
  const talentSkillsData = [
    // Budi - fullstack
    { talentId: tp1Id, skillName: 'React', proficiency: 'expert' as const, primary: true },
    { talentId: tp1Id, skillName: 'Node.js', proficiency: 'expert' as const, primary: true },
    { talentId: tp1Id, skillName: 'TypeScript', proficiency: 'advanced' as const, primary: false },
    { talentId: tp1Id, skillName: 'PostgreSQL', proficiency: 'advanced' as const, primary: false },
    { talentId: tp1Id, skillName: 'Docker', proficiency: 'intermediate' as const, primary: false },
    { talentId: tp1Id, skillName: 'Next.js', proficiency: 'advanced' as const, primary: false },
    // Dewi - designer
    { talentId: tp2Id, skillName: 'Figma', proficiency: 'expert' as const, primary: true },
    { talentId: tp2Id, skillName: 'UI Design', proficiency: 'expert' as const, primary: true },
    { talentId: tp2Id, skillName: 'UX Design', proficiency: 'advanced' as const, primary: false },
    {
      talentId: tp2Id,
      skillName: 'Adobe XD',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    // Eko - backend
    { talentId: tp3Id, skillName: 'Go', proficiency: 'expert' as const, primary: true },
    { talentId: tp3Id, skillName: 'Python', proficiency: 'expert' as const, primary: true },
    { talentId: tp3Id, skillName: 'PostgreSQL', proficiency: 'advanced' as const, primary: false },
    { talentId: tp3Id, skillName: 'Docker', proficiency: 'advanced' as const, primary: false },
    {
      talentId: tp3Id,
      skillName: 'Kubernetes',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    { talentId: tp3Id, skillName: 'Redis', proficiency: 'advanced' as const, primary: false },
    // Fitri - mobile
    { talentId: tp4Id, skillName: 'React Native', proficiency: 'expert' as const, primary: true },
    { talentId: tp4Id, skillName: 'Flutter', proficiency: 'advanced' as const, primary: true },
    {
      talentId: tp4Id,
      skillName: 'TypeScript',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    { talentId: tp4Id, skillName: 'Kotlin', proficiency: 'intermediate' as const, primary: false },
    // Gunawan - junior fullstack
    { talentId: tp5Id, skillName: 'React', proficiency: 'intermediate' as const, primary: true },
    { talentId: tp5Id, skillName: 'Node.js', proficiency: 'beginner' as const, primary: false },
    {
      talentId: tp5Id,
      skillName: 'Tailwind CSS',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    {
      talentId: tp5Id,
      skillName: 'HTML/CSS',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    // Hana - data/ML
    { talentId: tp6Id, skillName: 'Python', proficiency: 'expert' as const, primary: true },
    {
      talentId: tp6Id,
      skillName: 'Machine Learning',
      proficiency: 'advanced' as const,
      primary: true,
    },
    { talentId: tp6Id, skillName: 'TensorFlow', proficiency: 'advanced' as const, primary: false },
    {
      talentId: tp6Id,
      skillName: 'Data Analysis',
      proficiency: 'advanced' as const,
      primary: false,
    },
    {
      talentId: tp6Id,
      skillName: 'PostgreSQL',
      proficiency: 'intermediate' as const,
      primary: false,
    },
    // Irfan - devops
    { talentId: tp7Id, skillName: 'Docker', proficiency: 'expert' as const, primary: true },
    { talentId: tp7Id, skillName: 'Kubernetes', proficiency: 'expert' as const, primary: true },
    { talentId: tp7Id, skillName: 'AWS', proficiency: 'advanced' as const, primary: false },
    { talentId: tp7Id, skillName: 'CI/CD', proficiency: 'advanced' as const, primary: false },
    { talentId: tp7Id, skillName: 'Go', proficiency: 'intermediate' as const, primary: false },
  ]
  for (const ws of talentSkillsData) {
    const sid = skillIds[ws.skillName]
    if (sid) {
      await db
        .insert(talentSkills)
        .values({
          talentId: ws.talentId,
          skillId: sid,
          proficiencyLevel: ws.proficiency,
          isPrimary: ws.primary,
        })
        .onConflictDoNothing()
    }
  }

  // ========== 6. PROJECTS (10 projects) ==========
  console.log('  Seeding projects...')
  const projectsData = [
    {
      id: project1Id,
      ownerId: owner1Id,
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
      talentPayout: 41600000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
    },
    {
      id: project2Id,
      ownerId: owner1Id,
      title: 'Mobile App Booking Lapangan Futsal',
      description:
        'Aplikasi mobile untuk booking lapangan futsal secara online. Fitur: cari lapangan terdekat, booking real-time, pembayaran online, notifikasi reminder, riwayat booking.',
      category: 'mobile_app' as const,
      status: 'matching' as const,
      budgetMin: 20000000,
      budgetMax: 35000000,
      estimatedTimelineDays: 45,
      teamSize: 2,
      finalPrice: 30000000,
      platformFee: 7500000,
      talentPayout: 22500000,
      preferences: { requiredSkills: ['React Native', 'Node.js'] },
    },
    {
      id: project3Id,
      ownerId: owner2Id,
      title: 'Dashboard Analytics Penjualan',
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
      talentPayout: null,
      preferences: { requiredSkills: ['React', 'Python', 'PostgreSQL'] },
    },
    {
      id: project4Id,
      ownerId: owner2Id,
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
      talentPayout: 11250000,
      preferences: { requiredSkills: ['Figma', 'UI Design', 'UX Design'] },
    },
    {
      id: project5Id,
      ownerId: owner3Id,
      title: 'Sistem Manajemen Inventori Gudang',
      description:
        'Aplikasi web untuk manajemen stok gudang. Fitur: barcode scanning, stok real-time, purchase order, supplier management, laporan bulanan, alert stok minimum.',
      category: 'web_app' as const,
      status: 'brd_approved' as const,
      budgetMin: 25000000,
      budgetMax: 40000000,
      estimatedTimelineDays: 45,
      teamSize: 2,
      finalPrice: 38000000,
      platformFee: 7600000,
      talentPayout: 30400000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
    },
    {
      id: project6Id,
      ownerId: owner2Id,
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
      talentPayout: null,
      preferences: {},
    },
    {
      id: project7Id,
      ownerId: owner1Id,
      title: 'Chatbot Customer Service dengan AI',
      description:
        'Chatbot berbasis AI untuk layanan pelanggan e-commerce. Integrasi WhatsApp Business API, sentiment analysis, auto-escalation ke agen manusia.',
      category: 'data_ai' as const,
      status: 'scoping' as const,
      budgetMin: 20000000,
      budgetMax: 40000000,
      estimatedTimelineDays: 45,
      teamSize: 2,
      finalPrice: null,
      platformFee: null,
      talentPayout: null,
      preferences: { requiredSkills: ['Python', 'Machine Learning', 'Node.js'] },
    },
    {
      id: project8Id,
      ownerId: owner3Id,
      title: 'Aplikasi Mobile Kasir UMKM',
      description:
        'Aplikasi kasir (POS) untuk UMKM warung dan toko kelontong. Fitur: pencatatan penjualan, manajemen stok sederhana, laporan harian, struk digital via WhatsApp.',
      category: 'mobile_app' as const,
      status: 'completed' as const,
      budgetMin: 8000000,
      budgetMax: 15000000,
      estimatedTimelineDays: 30,
      teamSize: 1,
      finalPrice: 12000000,
      platformFee: 3000000,
      talentPayout: 9000000,
      preferences: { requiredSkills: ['Flutter'] },
    },
    {
      id: project9Id,
      ownerId: owner2Id,
      title: 'Website Company Profile Restoran',
      description:
        'Website company profile untuk jaringan restoran Padang. Menampilkan menu, lokasi cabang, online reservation, galeri foto, dan testimoni pelanggan.',
      category: 'web_app' as const,
      status: 'cancelled' as const,
      budgetMin: 5000000,
      budgetMax: 10000000,
      estimatedTimelineDays: 14,
      teamSize: 1,
      finalPrice: 7500000,
      platformFee: 2250000,
      talentPayout: 5250000,
      preferences: { requiredSkills: ['React', 'Tailwind CSS'] },
    },
    {
      id: project10Id,
      ownerId: owner3Id,
      title: 'Platform Manajemen Proyek Internal',
      description:
        'Aplikasi web untuk manajemen proyek tim internal. Fitur: Kanban board, Gantt chart, time tracking, file sharing, role-based access, integrasi Slack & Google Workspace.',
      category: 'web_app' as const,
      status: 'in_progress' as const,
      budgetMin: 40000000,
      budgetMax: 70000000,
      estimatedTimelineDays: 75,
      teamSize: 2,
      finalPrice: 62000000,
      platformFee: 9300000,
      talentPayout: 52700000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL', 'Docker'] },
    },
  ]
  for (const p of projectsData) {
    await db.insert(projects).values(p).onConflictDoNothing()
  }

  // ========== 7. PROJECT STATUS LOGS (10+ logs) ==========
  console.log('  Seeding status logs...')
  const statusLogs = [
    { projectId: project1Id, from: null, to: 'draft', by: owner1Id },
    { projectId: project1Id, from: 'draft', to: 'scoping', by: owner1Id },
    { projectId: project1Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { projectId: project1Id, from: 'brd_generated', to: 'brd_approved', by: owner1Id },
    { projectId: project1Id, from: 'brd_approved', to: 'matching', by: adminId },
    { projectId: project1Id, from: 'matching', to: 'in_progress', by: adminId },
    { projectId: project2Id, from: null, to: 'draft', by: owner1Id },
    { projectId: project2Id, from: 'draft', to: 'matching', by: adminId },
    { projectId: project3Id, from: null, to: 'draft', by: owner2Id },
    { projectId: project3Id, from: 'draft', to: 'brd_generated', by: adminId },
    { projectId: project4Id, from: null, to: 'draft', by: owner2Id },
    { projectId: project4Id, from: 'draft', to: 'completed', by: adminId },
    { projectId: project5Id, from: null, to: 'draft', by: owner3Id },
    { projectId: project5Id, from: 'draft', to: 'brd_approved', by: owner3Id },
    { projectId: project6Id, from: null, to: 'draft', by: owner2Id },
    { projectId: project7Id, from: null, to: 'draft', by: owner1Id },
    { projectId: project7Id, from: 'draft', to: 'scoping', by: owner1Id },
    { projectId: project8Id, from: null, to: 'draft', by: owner3Id },
    { projectId: project8Id, from: 'draft', to: 'completed', by: adminId },
    { projectId: project9Id, from: null, to: 'draft', by: owner2Id },
    { projectId: project9Id, from: 'draft', to: 'cancelled', by: owner2Id },
    { projectId: project10Id, from: null, to: 'draft', by: owner3Id },
    { projectId: project10Id, from: 'draft', to: 'in_progress', by: adminId },
  ]
  for (const log of statusLogs) {
    await db
      .insert(projectStatusLogs)
      .values({
        id: uuidv7(),
        projectId: log.projectId,
        fromStatus: log.from as typeof projectStatusLogs.$inferInsert.fromStatus,
        toStatus: log.to as typeof projectStatusLogs.$inferInsert.toStatus,
        changedBy: log.by,
        reason: log.from ? `Status changed from ${log.from} to ${log.to}` : 'Project created',
      })
      .onConflictDoNothing()
  }

  // ========== 8. BRD DOCUMENTS ==========
  console.log('  Seeding BRD documents...')
  await db
    .insert(brdDocuments)
    .values([
      {
        id: uuidv7(),
        projectId: project1Id,
        version: 1,
        status: 'approved',
        price: 2500000,
        content: {
          executiveSummary:
            'Platform e-commerce untuk UMKM kopi Indonesia yang memungkinkan penjual mengelola toko online dan pembeli mendapatkan kopi berkualitas dari seluruh Nusantara.',
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
      },
      {
        id: uuidv7(),
        projectId: project3Id,
        version: 1,
        status: 'review',
        price: 1500000,
        content: {
          executiveSummary:
            'Dashboard analytics untuk monitoring performa bisnis secara real-time dengan visualisasi data interaktif.',
          businessObjectives: [
            'Mengurangi waktu pembuatan laporan 80%',
            'Meningkatkan data-driven decision making',
          ],
          scope: 'Web dashboard dengan visualisasi data dan automated reporting.',
          functionalRequirements: [
            { title: 'Data Visualization', content: 'Charts interaktif, heatmaps, drill-down' },
            { title: 'Automated Reports', content: 'Laporan harian/mingguan/bulanan via email' },
          ],
          nonFunctionalRequirements: ['Load time < 3 detik untuk complex queries'],
          estimatedPriceMin: 15000000,
          estimatedPriceMax: 25000000,
          estimatedTimelineDays: 30,
          estimatedTeamSize: 1,
          riskAssessment: ['Kompleksitas integrasi data dari multiple sources'],
        },
      },
      {
        id: uuidv7(),
        projectId: project5Id,
        version: 1,
        status: 'approved',
        price: 2000000,
        content: {
          executiveSummary:
            'Sistem manajemen inventori gudang berbasis web untuk efisiensi operasional logistik.',
          businessObjectives: [
            'Mengurangi shrinkage (kehilangan stok) dari 5% ke 1%',
            'Mempercepat proses stock opname 70%',
          ],
          scope: 'Web app untuk manajemen stok, purchase order, dan reporting.',
          functionalRequirements: [
            { title: 'Barcode Scanning', content: 'Scan barcode via camera atau scanner USB' },
            {
              title: 'Stock Management',
              content: 'Stok real-time, alert minimum, transfer antar gudang',
            },
            {
              title: 'Purchase Order',
              content: 'PO creation, approval workflow, supplier management',
            },
          ],
          nonFunctionalRequirements: ['Offline-capable untuk scanning', 'Response time < 1 detik'],
          estimatedPriceMin: 25000000,
          estimatedPriceMax: 40000000,
          estimatedTimelineDays: 45,
          estimatedTeamSize: 2,
          riskAssessment: ['Kompatibilitas barcode scanner hardware', 'Offline sync complexity'],
        },
      },
    ])
    .onConflictDoNothing()

  // ========== 9. PRD DOCUMENTS ==========
  console.log('  Seeding PRD documents...')
  await db
    .insert(prdDocuments)
    .values({
      id: uuidv7(),
      projectId: project1Id,
      version: 1,
      status: 'approved',
      price: 5000000,
      content: {
        techStack: {
          frontend: 'React + TypeScript + Tailwind CSS',
          backend: 'Hono + Node.js',
          database: 'PostgreSQL',
          payment: 'Midtrans',
        },
        teamComposition: {
          teamSize: 3,
          workPackages: [
            {
              title: 'Backend API Development',
              requiredSkills: ['Node.js', 'PostgreSQL'],
              estimatedHours: 160,
              amount: 18000000,
            },
            {
              title: 'Frontend Development',
              requiredSkills: ['React', 'TypeScript', 'Tailwind CSS'],
              estimatedHours: 140,
              amount: 16000000,
            },
            {
              title: 'UI/UX Design',
              requiredSkills: ['Figma', 'UI Design'],
              estimatedHours: 80,
              amount: 8000000,
            },
          ],
        },
        milestones: [
          'Database Schema & API Foundation',
          'Payment Gateway Integration',
          'Product & Order API',
          'Landing Page & Auth UI',
          'Product Catalog & Cart UI',
          'Complete Design System & Mockups',
        ],
        architecture:
          'Microservice dengan API Gateway, background job processing, real-time notifications',
      },
    })
    .onConflictDoNothing()

  // ========== 10. WORK PACKAGES ==========
  console.log('  Seeding work packages...')
  await db
    .insert(workPackages)
    .values([
      // Project 1 - KopiNusantara (3 work packages)
      {
        id: wpkg1Id,
        projectId: project1Id,
        title: 'Backend API Development',
        description: 'REST API, database design, authentication, payment integration',
        orderIndex: 0,
        requiredSkills: ['Node.js', 'PostgreSQL'],
        estimatedHours: 160,
        amount: 18000000,
        talentPayout: 14400000,
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
        talentPayout: 12800000,
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
        talentPayout: 6400000,
        status: 'completed' as const,
      },
      // Project 10 - Platform Manajemen (2 work packages)
      {
        id: wpkg4Id,
        projectId: project10Id,
        title: 'Fullstack Web Development',
        description:
          'Backend API, frontend React, database design, real-time features via WebSocket',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 200,
        amount: 35000000,
        talentPayout: 29750000,
        status: 'in_progress' as const,
      },
      {
        id: wpkg5Id,
        projectId: project10Id,
        title: 'DevOps & Infrastructure',
        description: 'Docker setup, CI/CD pipeline, monitoring, deployment automation',
        orderIndex: 1,
        requiredSkills: ['Docker', 'AWS', 'CI/CD'],
        estimatedHours: 100,
        amount: 18000000,
        talentPayout: 15300000,
        status: 'in_progress' as const,
      },
      // Project 4 - Redesign Travel (completed, 1 work package)
      {
        id: wpkg6Id,
        projectId: project4Id,
        title: 'UI/UX Redesign Aplikasi Travel',
        description: 'User research, wireframing, visual design, prototype, design handoff',
        orderIndex: 0,
        requiredSkills: ['Figma', 'UI Design', 'UX Design'],
        estimatedHours: 80,
        amount: 11250000,
        talentPayout: 11250000,
        status: 'completed' as const,
      },
    ])
    .onConflictDoNothing()

  // ========== 11. WORK PACKAGE DEPENDENCIES ==========
  console.log('  Seeding work package dependencies...')
  await db
    .insert(workPackageDependencies)
    .values([
      {
        id: uuidv7(),
        workPackageId: wpkg2Id,
        dependsOnWorkPackageId: wpkg3Id,
        type: 'finish_to_start' as const,
      },
    ])
    .onConflictDoNothing()

  // ========== 12. PROJECT ASSIGNMENTS ==========
  console.log('  Seeding assignments...')
  await db
    .insert(projectAssignments)
    .values([
      {
        id: assign1Id,
        projectId: project1Id,
        talentId: tp3Id,
        workPackageId: wpkg1Id,
        roleLabel: 'Backend Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-02-01'),
      },
      {
        id: assign2Id,
        projectId: project1Id,
        talentId: tp1Id,
        workPackageId: wpkg2Id,
        roleLabel: 'Frontend Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-02-01'),
      },
      {
        id: assign3Id,
        projectId: project1Id,
        talentId: tp2Id,
        workPackageId: wpkg3Id,
        roleLabel: 'UI/UX Designer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2026-02-01'),
        completedAt: new Date('2026-02-10'),
      },
      {
        id: assign4Id,
        projectId: project10Id,
        talentId: tp1Id,
        workPackageId: wpkg4Id,
        roleLabel: 'Fullstack Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      {
        id: uuidv7(),
        projectId: project10Id,
        talentId: tp7Id,
        workPackageId: wpkg5Id,
        roleLabel: 'DevOps Engineer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      {
        id: uuidv7(),
        projectId: project4Id,
        talentId: tp2Id,
        workPackageId: wpkg6Id,
        roleLabel: 'UI/UX Designer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2025-12-01'),
        completedAt: new Date('2025-12-21'),
      },
    ])
    .onConflictDoNothing()

  // ========== 13. CONTRACTS ==========
  console.log('  Seeding contracts...')
  await db
    .insert(contracts)
    .values([
      {
        id: uuidv7(),
        projectId: project1Id,
        assignmentId: assign1Id,
        type: 'standard_nda' as const,
        content: {
          parties: { owner: 'Ahmad Fadillah', talent: 'Eko Prasetyo' },
          scope: 'Backend API development untuk Platform E-commerce KopiNusantara',
          confidentiality:
            'Semua informasi proyek bersifat rahasia selama 2 tahun setelah proyek selesai',
          ipTransfer: 'Semua hasil kerja menjadi milik owner setelah pembayaran selesai',
        },
        signedByOwner: true,
        signedByTalent: true,
        signedAt: new Date('2026-01-30'),
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        assignmentId: assign1Id,
        type: 'ip_transfer' as const,
        content: {
          parties: { owner: 'Ahmad Fadillah', talent: 'Eko Prasetyo' },
          scope: 'Transfer hak kekayaan intelektual atas source code Backend API KopiNusantara',
          transferDate: 'Setelah milestone terakhir di-approve dan pembayaran dicairkan',
        },
        signedByOwner: true,
        signedByTalent: true,
        signedAt: new Date('2026-01-30'),
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        assignmentId: assign2Id,
        type: 'standard_nda' as const,
        content: {
          parties: { owner: 'Ahmad Fadillah', talent: 'Budi Setiawan' },
          scope: 'Frontend development untuk Platform E-commerce KopiNusantara',
          confidentiality:
            'Semua informasi proyek bersifat rahasia selama 2 tahun setelah proyek selesai',
          ipTransfer: 'Semua hasil kerja menjadi milik owner setelah pembayaran selesai',
        },
        signedByOwner: true,
        signedByTalent: true,
        signedAt: new Date('2026-01-30'),
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        assignmentId: assign3Id,
        type: 'standard_nda' as const,
        content: {
          parties: { owner: 'Ahmad Fadillah', talent: 'Dewi Lestari' },
          scope: 'UI/UX Design untuk Platform E-commerce KopiNusantara',
          confidentiality:
            'Semua informasi proyek bersifat rahasia selama 2 tahun setelah proyek selesai',
          ipTransfer: 'Semua design assets menjadi milik owner setelah pembayaran selesai',
        },
        signedByOwner: true,
        signedByTalent: true,
        signedAt: new Date('2026-01-30'),
      },
      {
        id: uuidv7(),
        projectId: project10Id,
        assignmentId: assign4Id,
        type: 'standard_nda' as const,
        content: {
          parties: { owner: 'Rahmat Hidayat', talent: 'Budi Setiawan' },
          scope: 'Fullstack development untuk Platform Manajemen Proyek Internal',
          confidentiality:
            'Semua informasi proyek bersifat rahasia selama 2 tahun setelah proyek selesai',
          ipTransfer: 'Semua hasil kerja menjadi milik owner setelah pembayaran selesai',
        },
        signedByOwner: true,
        signedByTalent: true,
        signedAt: new Date('2026-02-28'),
      },
    ])
    .onConflictDoNothing()

  // ========== 14. MILESTONES (12 milestones) ==========
  console.log('  Seeding milestones...')
  await db
    .insert(milestones)
    .values([
      // Project 1 - Backend (Eko)
      {
        id: ms1Id,
        projectId: project1Id,
        workPackageId: wpkg1Id,
        assignedTalentId: tp3Id,
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
        id: ms2Id,
        projectId: project1Id,
        workPackageId: wpkg1Id,
        assignedTalentId: tp3Id,
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
        id: ms3Id,
        projectId: project1Id,
        workPackageId: wpkg1Id,
        assignedTalentId: tp3Id,
        title: 'Product & Order API',
        description: 'CRUD products, orders, cart, search, filtering',
        milestoneType: 'individual' as const,
        orderIndex: 2,
        amount: 6000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-15'),
      },
      // Project 1 - Frontend (Budi)
      {
        id: ms4Id,
        projectId: project1Id,
        workPackageId: wpkg2Id,
        assignedTalentId: tp1Id,
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
        id: ms5Id,
        projectId: project1Id,
        workPackageId: wpkg2Id,
        assignedTalentId: tp1Id,
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
        id: ms6Id,
        projectId: project1Id,
        workPackageId: wpkg2Id,
        assignedTalentId: tp1Id,
        title: 'Dashboard Penjual UI',
        description: 'Seller dashboard, product management, sales analytics charts',
        milestoneType: 'individual' as const,
        orderIndex: 2,
        amount: 5500000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-20'),
      },
      // Project 1 - Design (Dewi)
      {
        id: ms7Id,
        projectId: project1Id,
        workPackageId: wpkg3Id,
        assignedTalentId: tp2Id,
        title: 'Design System & All Mockups',
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
      // Project 1 - Integration milestone
      {
        id: ms8Id,
        projectId: project1Id,
        workPackageId: null,
        assignedTalentId: null,
        title: 'Frontend-Backend Integration Testing',
        description: 'End-to-end integration testing seluruh fitur marketplace',
        milestoneType: 'integration' as const,
        orderIndex: 3,
        amount: 5000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-25'),
      },
      // Project 10 - Fullstack (Budi)
      {
        id: ms9Id,
        projectId: project10Id,
        workPackageId: wpkg4Id,
        assignedTalentId: tp1Id,
        title: 'Core API & Kanban Board',
        description: 'Database schema, REST API, Kanban board UI with drag-and-drop',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 15000000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-20'),
      },
      {
        id: ms10Id,
        projectId: project10Id,
        workPackageId: wpkg4Id,
        assignedTalentId: tp1Id,
        title: 'Gantt Chart & Time Tracking',
        description: 'Interactive Gantt chart, time tracking dengan timer',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 20000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-15'),
      },
      // Project 10 - DevOps (Irfan)
      {
        id: ms11Id,
        projectId: project10Id,
        workPackageId: wpkg5Id,
        assignedTalentId: tp7Id,
        title: 'Docker & CI/CD Setup',
        description: 'Dockerize all services, GitHub Actions CI/CD, staging deployment',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 10000000,
        status: 'revision_requested' as const,
        revisionCount: 1,
        dueDate: new Date('2026-03-15'),
        submittedAt: new Date('2026-03-14'),
      },
      // Project 4 - Completed design (Dewi)
      {
        id: ms12Id,
        projectId: project4Id,
        workPackageId: wpkg6Id,
        assignedTalentId: tp2Id,
        title: 'Complete Redesign Package',
        description: 'User research report, wireframes, hi-fi mockups, prototype, design handoff',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 11250000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2025-12-20'),
        submittedAt: new Date('2025-12-18'),
        completedAt: new Date('2025-12-20'),
      },
    ])
    .onConflictDoNothing()

  // ========== 15. MILESTONE COMMENTS ==========
  console.log('  Seeding milestone comments...')
  await db
    .insert(milestoneComments)
    .values([
      {
        id: uuidv7(),
        milestoneId: ms1Id,
        userId: owner1Id,
        content: 'Database schema sangat rapi. Terima kasih Eko, approved!',
      },
      {
        id: uuidv7(),
        milestoneId: ms4Id,
        userId: owner1Id,
        content:
          'Landing page bagus, tapi tolong perbaiki responsif di mobile. Form login agak berantakan di layar kecil.',
      },
      {
        id: uuidv7(),
        milestoneId: ms4Id,
        userId: talent1Id,
        content:
          'Siap, saya akan perbaiki responsive layout untuk mobile. Estimasi selesai 2 hari.',
      },
      {
        id: uuidv7(),
        milestoneId: ms7Id,
        userId: owner1Id,
        content:
          'Design system sangat konsisten dan warnanya tepat. Prototype interaktifnya membantu sekali. Approved!',
      },
      {
        id: uuidv7(),
        milestoneId: ms11Id,
        userId: owner3Id,
        content:
          'CI/CD pipeline masih gagal di step deployment ke staging. Tolong dicek konfigurasi Docker Compose-nya.',
      },
    ])
    .onConflictDoNothing()

  // ========== 16. REVISION REQUESTS ==========
  console.log('  Seeding revision requests...')
  await db
    .insert(revisionRequests)
    .values([
      {
        id: uuidv7(),
        milestoneId: ms4Id,
        requestedBy: owner1Id,
        description:
          'Perbaiki responsive layout pada halaman login dan register untuk ukuran layar mobile (< 640px). Form input terlalu besar dan button tidak accessible.',
        severity: 'minor' as const,
        isPaid: false,
        status: 'completed' as const,
        completedAt: new Date('2026-02-18'),
      },
      {
        id: uuidv7(),
        milestoneId: ms11Id,
        requestedBy: owner3Id,
        description:
          'Docker Compose staging deployment gagal karena port conflict dan missing environment variables. Perlu fix dan dokumentasi environment setup.',
        severity: 'moderate' as const,
        isPaid: false,
        status: 'in_progress' as const,
      },
      {
        id: uuidv7(),
        milestoneId: ms12Id,
        requestedBy: owner2Id,
        description:
          'Tambahkan satu halaman tambahan untuk fitur promo yang belum ada di scope awal. Ini di luar scope PRD.',
        severity: 'major' as const,
        isPaid: true,
        feeAmount: 1500000,
        status: 'completed' as const,
        talentResponse: 'Bisa dikerjakan, estimasi 3 hari kerja tambahan.',
        completedAt: new Date('2025-12-19'),
      },
    ])
    .onConflictDoNothing()

  // ========== 17. TASKS (10 tasks) ==========
  console.log('  Seeding tasks...')
  await db
    .insert(tasks)
    .values([
      {
        id: task1Id,
        milestoneId: ms2Id,
        assignedTalentId: tp3Id,
        title: 'Setup Midtrans sandbox environment',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 6,
        startDate: new Date('2026-02-16'),
        endDate: new Date('2026-02-18'),
      },
      {
        id: task2Id,
        milestoneId: ms2Id,
        assignedTalentId: tp3Id,
        title: 'Implement webhook handlers',
        orderIndex: 1,
        status: 'in_progress' as const,
        estimatedHours: 16,
        actualHours: 10,
        startDate: new Date('2026-02-19'),
      },
      {
        id: task3Id,
        milestoneId: ms2Id,
        assignedTalentId: tp3Id,
        title: 'Implement escrow logic',
        orderIndex: 2,
        status: 'pending' as const,
        estimatedHours: 12,
        actualHours: null,
        startDate: new Date('2026-02-24'),
      },
      {
        id: task4Id,
        milestoneId: ms4Id,
        assignedTalentId: tp1Id,
        title: 'Build responsive header & navigation',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 7,
        startDate: new Date('2026-02-01'),
        endDate: new Date('2026-02-03'),
      },
      {
        id: task5Id,
        milestoneId: ms4Id,
        assignedTalentId: tp1Id,
        title: 'Implement auth forms & OAuth',
        orderIndex: 1,
        status: 'completed' as const,
        estimatedHours: 12,
        actualHours: 11,
        startDate: new Date('2026-02-04'),
        endDate: new Date('2026-02-08'),
      },
      {
        id: task6Id,
        milestoneId: ms4Id,
        assignedTalentId: tp1Id,
        title: 'Build landing page hero section',
        orderIndex: 2,
        status: 'completed' as const,
        estimatedHours: 6,
        actualHours: 5,
        startDate: new Date('2026-02-09'),
        endDate: new Date('2026-02-10'),
      },
      {
        id: task7Id,
        milestoneId: ms9Id,
        assignedTalentId: tp1Id,
        title: 'Database schema design for project management',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 10,
        actualHours: 8,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-04'),
      },
      {
        id: task8Id,
        milestoneId: ms9Id,
        assignedTalentId: tp1Id,
        title: 'REST API endpoints for tasks and projects',
        orderIndex: 1,
        status: 'in_progress' as const,
        estimatedHours: 20,
        actualHours: 12,
        startDate: new Date('2026-03-05'),
      },
      {
        id: task9Id,
        milestoneId: ms9Id,
        assignedTalentId: tp1Id,
        title: 'Kanban board UI with drag-and-drop',
        orderIndex: 2,
        status: 'pending' as const,
        estimatedHours: 16,
        actualHours: null,
        startDate: new Date('2026-03-12'),
      },
      {
        id: task10Id,
        milestoneId: ms11Id,
        assignedTalentId: tp7Id,
        title: 'Dockerize all application services',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 12,
        actualHours: 14,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-07'),
      },
    ])
    .onConflictDoNothing()

  // ========== 18. TIME LOGS (10+ entries) ==========
  console.log('  Seeding time logs...')
  await db
    .insert(timeLogs)
    .values([
      {
        id: uuidv7(),
        taskId: task1Id,
        talentId: tp3Id,
        startedAt: new Date('2026-02-16T09:00:00Z'),
        endedAt: new Date('2026-02-16T12:30:00Z'),
        durationMinutes: 210,
        description: 'Setup Midtrans sandbox environment & API keys',
      },
      {
        id: uuidv7(),
        taskId: task1Id,
        talentId: tp3Id,
        startedAt: new Date('2026-02-17T09:00:00Z'),
        endedAt: new Date('2026-02-17T12:00:00Z'),
        durationMinutes: 180,
        description: 'Implement payment creation flow',
      },
      {
        id: uuidv7(),
        taskId: task2Id,
        talentId: tp3Id,
        startedAt: new Date('2026-02-19T09:00:00Z'),
        endedAt: new Date('2026-02-19T14:00:00Z'),
        durationMinutes: 300,
        description: 'Webhook signature verification & status mapping',
      },
      {
        id: uuidv7(),
        taskId: task2Id,
        talentId: tp3Id,
        startedAt: new Date('2026-02-20T09:00:00Z'),
        endedAt: new Date('2026-02-20T12:30:00Z'),
        durationMinutes: 210,
        description: 'Webhook retry logic & idempotency handling',
      },
      {
        id: uuidv7(),
        taskId: task4Id,
        talentId: tp1Id,
        startedAt: new Date('2026-02-01T08:00:00Z'),
        endedAt: new Date('2026-02-01T16:00:00Z'),
        durationMinutes: 480,
        description: 'Header component, responsive nav, mobile menu',
      },
      {
        id: uuidv7(),
        taskId: task5Id,
        talentId: tp1Id,
        startedAt: new Date('2026-02-04T09:00:00Z'),
        endedAt: new Date('2026-02-04T17:00:00Z'),
        durationMinutes: 480,
        description: 'Login form, register form with validation',
      },
      {
        id: uuidv7(),
        taskId: task5Id,
        talentId: tp1Id,
        startedAt: new Date('2026-02-05T09:00:00Z'),
        endedAt: new Date('2026-02-05T14:00:00Z'),
        durationMinutes: 300,
        description: 'Google OAuth integration & session management',
      },
      {
        id: uuidv7(),
        taskId: task6Id,
        talentId: tp1Id,
        startedAt: new Date('2026-02-09T09:00:00Z'),
        endedAt: new Date('2026-02-09T14:00:00Z'),
        durationMinutes: 300,
        description: 'Hero section, feature highlights, CTA buttons',
      },
      {
        id: uuidv7(),
        taskId: task7Id,
        talentId: tp1Id,
        startedAt: new Date('2026-03-01T09:00:00Z'),
        endedAt: new Date('2026-03-01T17:00:00Z'),
        durationMinutes: 480,
        description: 'ERD design, Drizzle schema, seed data',
      },
      {
        id: uuidv7(),
        taskId: task8Id,
        talentId: tp1Id,
        startedAt: new Date('2026-03-05T09:00:00Z'),
        endedAt: new Date('2026-03-05T17:00:00Z'),
        durationMinutes: 480,
        description: 'CRUD endpoints for projects and tasks',
      },
      {
        id: uuidv7(),
        taskId: task10Id,
        talentId: tp7Id,
        startedAt: new Date('2026-03-01T09:00:00Z'),
        endedAt: new Date('2026-03-01T18:00:00Z'),
        durationMinutes: 540,
        description: 'Multi-stage Dockerfile untuk semua services',
      },
      {
        id: uuidv7(),
        taskId: task10Id,
        talentId: tp7Id,
        startedAt: new Date('2026-03-02T09:00:00Z'),
        endedAt: new Date('2026-03-02T17:00:00Z'),
        durationMinutes: 480,
        description: 'Docker Compose orchestration & health checks',
      },
    ])
    .onConflictDoNothing()

  // ========== 19. PAYMENT ACCOUNTS ==========
  console.log('  Seeding payment accounts...')
  await db
    .insert(accounts)
    .values([
      {
        id: platformAccId,
        ownerType: 'platform' as const,
        accountType: 'revenue' as const,
        name: 'Platform Revenue',
        balance: 17150000,
        currency: 'IDR',
      },
      {
        id: escrowAccId,
        ownerType: 'escrow' as const,
        accountType: 'asset' as const,
        name: 'Escrow Holding',
        balance: 89000000,
        currency: 'IDR',
      },
      {
        id: owner1AccId,
        ownerType: 'owner' as const,
        ownerId: owner1Id,
        accountType: 'liability' as const,
        name: 'Ahmad Fadillah - Client Account',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: owner2AccId,
        ownerType: 'owner' as const,
        ownerId: owner2Id,
        accountType: 'liability' as const,
        name: 'Siti Nurhaliza - Client Account',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: talent1AccId,
        ownerType: 'talent' as const,
        ownerId: talent1Id,
        accountType: 'asset' as const,
        name: 'Budi Setiawan - Talent Payout',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: talent2AccId,
        ownerType: 'talent' as const,
        ownerId: talent2Id,
        accountType: 'asset' as const,
        name: 'Dewi Lestari - Talent Payout',
        balance: 17650000,
        currency: 'IDR',
      },
      {
        id: talent3AccId,
        ownerType: 'talent' as const,
        ownerId: talent3Id,
        accountType: 'asset' as const,
        name: 'Eko Prasetyo - Talent Payout',
        balance: 4800000,
        currency: 'IDR',
      },
    ])
    .onConflictDoNothing()

  // ========== 20. TRANSACTIONS (12 transactions) ==========
  console.log('  Seeding transactions...')
  await db
    .insert(transactions)
    .values([
      // Project 1 - Escrow in
      {
        id: txn1Id,
        projectId: project1Id,
        type: 'escrow_in' as const,
        amount: 52000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026021001',
        idempotencyKey: uuidv7(),
      },
      // Project 1 - Escrow release for milestone 1 (Eko - backend)
      {
        id: txn2Id,
        projectId: project1Id,
        milestoneId: ms1Id,
        talentId: tp3Id,
        type: 'escrow_release' as const,
        amount: 4800000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // Project 1 - Escrow release for milestone 7 (Dewi - design)
      {
        id: txn3Id,
        projectId: project1Id,
        milestoneId: ms7Id,
        talentId: tp2Id,
        type: 'escrow_release' as const,
        amount: 6400000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // Project 1 - BRD payment
      {
        id: txn4Id,
        projectId: project1Id,
        type: 'brd_payment' as const,
        amount: 2500000,
        status: 'completed' as const,
        paymentMethod: 'qris',
        paymentGatewayRef: 'MTR-2026012001',
        idempotencyKey: uuidv7(),
      },
      // Project 1 - PRD payment
      {
        id: txn5Id,
        projectId: project1Id,
        type: 'prd_payment' as const,
        amount: 5000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026012501',
        idempotencyKey: uuidv7(),
      },
      // Project 3 - BRD payment
      {
        id: txn6Id,
        projectId: project3Id,
        type: 'brd_payment' as const,
        amount: 1500000,
        status: 'completed' as const,
        paymentMethod: 'qris',
        paymentGatewayRef: 'MTR-2026030501',
        idempotencyKey: uuidv7(),
      },
      // Project 4 - Escrow in (completed project)
      {
        id: txn7Id,
        projectId: project4Id,
        type: 'escrow_in' as const,
        amount: 15000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2025120101',
        idempotencyKey: uuidv7(),
      },
      // Project 4 - Escrow release (completed)
      {
        id: txn8Id,
        projectId: project4Id,
        milestoneId: ms12Id,
        talentId: tp2Id,
        type: 'escrow_release' as const,
        amount: 11250000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // Project 9 - Refund (cancelled project)
      {
        id: txn9Id,
        projectId: project9Id,
        type: 'refund' as const,
        amount: 7500000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-REF-2026031501',
        idempotencyKey: uuidv7(),
      },
      // Project 10 - Escrow in
      {
        id: txn10Id,
        projectId: project10Id,
        type: 'escrow_in' as const,
        amount: 62000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026030101',
        idempotencyKey: uuidv7(),
      },
      // Project 5 - BRD payment
      {
        id: txn11Id,
        projectId: project5Id,
        type: 'brd_payment' as const,
        amount: 2000000,
        status: 'completed' as const,
        paymentMethod: 'e_wallet',
        paymentGatewayRef: 'MTR-2026021501',
        idempotencyKey: uuidv7(),
      },
      // Project 8 - Escrow in (completed)
      {
        id: txn12Id,
        projectId: project8Id,
        type: 'escrow_in' as const,
        amount: 12000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2025110101',
        idempotencyKey: uuidv7(),
      },
    ])
    .onConflictDoNothing()

  // ========== 21. TRANSACTION EVENTS ==========
  console.log('  Seeding transaction events...')
  await db
    .insert(transactionEvents)
    .values([
      {
        id: uuidv7(),
        transactionId: txn1Id,
        eventType: 'escrow_created' as const,
        previousStatus: null,
        newStatus: 'completed' as const,
        amount: 52000000,
        performedBy: owner1Id,
      },
      {
        id: uuidv7(),
        transactionId: txn2Id,
        eventType: 'milestone_approved' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 4800000,
        performedBy: owner1Id,
      },
      {
        id: uuidv7(),
        transactionId: txn2Id,
        eventType: 'funds_released' as const,
        previousStatus: 'completed' as const,
        newStatus: 'completed' as const,
        amount: 4800000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn3Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 6400000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn9Id,
        eventType: 'refund_initiated' as const,
        previousStatus: null,
        newStatus: 'completed' as const,
        amount: 7500000,
        performedBy: adminId,
      },
    ])
    .onConflictDoNothing()

  // ========== 22. LEDGER ENTRIES ==========
  console.log('  Seeding ledger entries...')
  await db
    .insert(ledgerEntries)
    .values([
      // Escrow deposit project 1
      {
        id: uuidv7(),
        transactionId: txn1Id,
        accountId: owner1AccId,
        entryType: 'debit' as const,
        amount: 52000000,
        description: 'Escrow deposit untuk proyek KopiNusantara',
      },
      {
        id: uuidv7(),
        transactionId: txn1Id,
        accountId: escrowAccId,
        entryType: 'credit' as const,
        amount: 52000000,
        description: 'Escrow received untuk proyek KopiNusantara',
      },
      // Release to Eko (milestone 1)
      {
        id: uuidv7(),
        transactionId: txn2Id,
        accountId: escrowAccId,
        entryType: 'debit' as const,
        amount: 4800000,
        description: 'Release escrow milestone Database Schema (Eko)',
      },
      {
        id: uuidv7(),
        transactionId: txn2Id,
        accountId: talent3AccId,
        entryType: 'credit' as const,
        amount: 4800000,
        description: 'Payout milestone Database Schema ke Eko',
      },
      // Release to Dewi (milestone 7)
      {
        id: uuidv7(),
        transactionId: txn3Id,
        accountId: escrowAccId,
        entryType: 'debit' as const,
        amount: 6400000,
        description: 'Release escrow milestone Design System (Dewi)',
      },
      {
        id: uuidv7(),
        transactionId: txn3Id,
        accountId: talent2AccId,
        entryType: 'credit' as const,
        amount: 6400000,
        description: 'Payout milestone Design System ke Dewi',
      },
    ])
    .onConflictDoNothing()

  // ========== 23. REVIEWS (10 reviews) ==========
  console.log('  Seeding reviews...')
  await db
    .insert(reviews)
    .values([
      {
        id: uuidv7(),
        projectId: project4Id,
        reviewerId: owner2Id,
        revieweeId: talent2Id,
        rating: 5,
        comment:
          'Desain sangat bagus dan sesuai brief. Komunikasi lancar, revisi cepat. Sangat merekomendasikan!',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: project4Id,
        reviewerId: talent2Id,
        revieweeId: owner2Id,
        rating: 5,
        comment: 'Owner yang kooperatif, brief jelas, feedback tepat waktu. Senang bekerja sama!',
        type: 'talent_to_owner' as const,
      },
      {
        id: uuidv7(),
        projectId: project8Id,
        reviewerId: owner3Id,
        revieweeId: talent4Id,
        rating: 4,
        comment:
          'Aplikasi kasir berjalan baik, fitur lengkap. Ada sedikit delay di awal tapi overall puas.',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: project8Id,
        reviewerId: talent4Id,
        revieweeId: owner3Id,
        rating: 5,
        comment: 'Owner sangat jelas requirement-nya dan responsif saat proses development. Top!',
        type: 'talent_to_owner' as const,
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        reviewerId: owner1Id,
        revieweeId: talent3Id,
        rating: 5,
        comment:
          'Eko sangat profesional, API design rapi dan well-documented. Database schema solid.',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        reviewerId: owner1Id,
        revieweeId: talent2Id,
        rating: 5,
        comment:
          'Design system dari Dewi sangat membantu development. Mockup detail dan prototype interaktif.',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        reviewerId: talent3Id,
        revieweeId: owner1Id,
        rating: 4,
        comment:
          'Ahmad kooperatif dan cepat approve milestone. Kadang request perubahan mendadak tapi masih reasonable.',
        type: 'talent_to_owner' as const,
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        reviewerId: talent1Id,
        revieweeId: owner1Id,
        rating: 4,
        comment:
          'Proyek menarik dan owner responsif. Brief awal sudah lengkap berkat BRD/PRD yang bagus.',
        type: 'talent_to_owner' as const,
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        reviewerId: talent2Id,
        revieweeId: owner1Id,
        rating: 5,
        comment:
          'Owner memberikan feedback yang konstruktif dan menghargai proses design. Komunikasi sangat baik.',
        type: 'talent_to_owner' as const,
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        reviewerId: owner1Id,
        revieweeId: talent1Id,
        rating: 4,
        comment:
          'Budi solid di frontend, responsive design bagus. Kadang agak lambat di milestone pertama tapi membaik.',
        type: 'owner_to_talent' as const,
      },
    ])
    .onConflictDoNothing()

  // ========== 24. NOTIFICATIONS (12 notifications) ==========
  console.log('  Seeding notifications...')
  await db
    .insert(notifications)
    .values([
      {
        id: uuidv7(),
        userId: owner1Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disubmit',
        message: 'Budi Setiawan telah mensubmit milestone "Landing Page & Auth UI" untuk review.',
        link: `/projects/${project1Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner1Id,
        type: 'payment' as const,
        title: 'Pembayaran Berhasil',
        message: 'Escrow Rp 52.000.000 untuk proyek KopiNusantara berhasil diterima.',
        link: '/payments',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent1Id,
        type: 'project_match' as const,
        title: 'Proyek Baru Cocok',
        message:
          'Proyek "Sistem Manajemen Inventori Gudang" cocok dengan skill Anda. Lihat detail?',
        link: `/projects/${project5Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent2Id,
        type: 'payment' as const,
        title: 'Dana Cair',
        message:
          'Pembayaran Rp 6.400.000 untuk milestone "Design System" telah dicairkan ke rekening Anda.',
        link: '/payments',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent3Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disetujui',
        message: 'Milestone "Database Schema & API Foundation" telah disetujui oleh owner.',
        link: `/projects/${project1Id}/milestones`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'system' as const,
        title: 'Talent Baru Terdaftar',
        message: 'Gunawan Wibowo telah mendaftar sebagai talent dan menunggu verifikasi CV.',
        link: '/admin/users',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'dispute' as const,
        title: 'Dispute Baru',
        message:
          'Owner Siti melaporkan dispute pada proyek "Dashboard Analytics" terkait keterlambatan.',
        link: '/admin/disputes',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner1Id,
        type: 'team_formation' as const,
        title: 'Tim Terbentuk',
        message: 'Semua posisi untuk proyek KopiNusantara telah terisi. Proyek siap dimulai!',
        link: `/projects/${project1Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent4Id,
        type: 'assignment_offer' as const,
        title: 'Tawaran Proyek Baru',
        message:
          'Anda mendapat tawaran untuk mengerjakan "Mobile App Booking Lapangan Futsal". Lihat detail.',
        link: `/projects/${project2Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner3Id,
        type: 'milestone_update' as const,
        title: 'Revisi Diminta',
        message: 'Milestone "Docker & CI/CD Setup" memerlukan revisi. Cek detail feedback.',
        link: `/projects/${project10Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent7Id,
        type: 'milestone_update' as const,
        title: 'Revisi Diminta',
        message:
          'Owner meminta revisi pada milestone "Docker & CI/CD Setup". Silakan cek feedback.',
        link: `/projects/${project10Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner2Id,
        type: 'payment' as const,
        title: 'Refund Diproses',
        message:
          'Refund Rp 7.500.000 untuk proyek "Website Company Profile Restoran" telah diproses.',
        link: '/payments',
        isRead: true,
      },
    ])
    .onConflictDoNothing()

  // ========== 25. CHAT CONVERSATIONS & PARTICIPANTS ==========
  console.log('  Seeding chat conversations...')
  await db
    .insert(chatConversations)
    .values([
      { id: conv1Id, projectId: project1Id, type: 'ai_scoping' as const },
      { id: conv2Id, projectId: project1Id, type: 'team_group' as const },
      { id: conv3Id, projectId: project7Id, type: 'ai_scoping' as const },
      { id: conv4Id, projectId: project10Id, type: 'owner_talent' as const },
    ])
    .onConflictDoNothing()

  console.log('  Seeding chat participants...')
  await db
    .insert(chatParticipants)
    .values([
      { id: uuidv7(), conversationId: conv1Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv2Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv2Id, userId: talent1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv2Id, userId: talent2Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv2Id, userId: talent3Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv3Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv4Id, userId: owner3Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv4Id, userId: talent1Id, role: 'member' as const },
    ])
    .onConflictDoNothing()

  // ========== 26. CHAT MESSAGES ==========
  console.log('  Seeding chat messages...')
  await db
    .insert(chatMessages)
    .values([
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'ai' as const,
        content:
          'Halo! Saya akan membantu Anda mendefinisikan kebutuhan proyek. Bisa ceritakan tentang platform e-commerce kopi yang ingin Anda buat?',
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Saya ingin membuat marketplace online khusus kopi Indonesia. Target pengguna UMKM kopi dari berbagai daerah.',
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'ai' as const,
        content:
          'Menarik! Beberapa pertanyaan: 1) Apakah ingin fitur subscription/langganan kopi? 2) Integrasi dengan kurir mana saja? 3) Apakah perlu fitur review/rating?',
        metadata: { completenessScore: 45, model: 'gpt-4o-mini' },
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Ya, fitur subscription bulanan untuk kopi. Integrasi JNE, J&T, dan SiCepat. Review dan rating pasti perlu.',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: talent3Id,
        content:
          'Tim, saya sudah selesai setup database schema. Silakan review entity relationship diagram di link ini.',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content:
          'Terima kasih Eko. Saya akan mulai integrasi frontend dengan API setelah endpoint auth ready.',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: talent2Id,
        content:
          'Design system sudah finalize. Saya share Figma link ke semua. Tolong follow design tokens ya.',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Terima kasih tim! Progressnya bagus. Saya sudah review mockup dari Dewi dan sangat puas.',
      },
      {
        id: uuidv7(),
        conversationId: conv3Id,
        senderType: 'ai' as const,
        content:
          'Halo! Saya akan membantu mendefinisikan kebutuhan chatbot customer service Anda. Platform apa yang ingin diintegrasikan?',
      },
      {
        id: uuidv7(),
        conversationId: conv3Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Kami butuh chatbot yang terintegrasi dengan WhatsApp Business API. Fokus utama: menjawab pertanyaan soal produk kopi dan status pesanan.',
      },
      {
        id: uuidv7(),
        conversationId: conv4Id,
        senderType: 'user' as const,
        senderId: owner3Id,
        content: 'Halo Budi, bagaimana progress untuk Kanban board? Apakah ada blocker?',
      },
      {
        id: uuidv7(),
        conversationId: conv4Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content:
          'Halo Pak Rahmat, API endpoint untuk tasks sudah hampir selesai. Drag-and-drop belum mulai, estimasi selesai minggu depan.',
      },
    ])
    .onConflictDoNothing()

  // ========== 27. DISPUTES ==========
  console.log('  Seeding disputes...')
  await db
    .insert(disputes)
    .values([
      {
        id: uuidv7(),
        projectId: project3Id,
        initiatedBy: owner2Id,
        againstUserId: talent3Id,
        reason:
          'Talent tidak responsif selama 5 hari dan progress milestone terhenti tanpa pemberitahuan.',
        evidenceUrls: ['https://storage.bytz.id/evidence/screenshot-chat-1.png'],
        status: 'open' as const,
      },
      {
        id: uuidv7(),
        projectId: project9Id,
        initiatedBy: owner2Id,
        againstUserId: talent5Id,
        reason:
          'Proyek dibatalkan karena talent tidak memenuhi timeline yang disepakati setelah 2 minggu.',
        evidenceUrls: ['https://storage.bytz.id/evidence/timeline-log.png'],
        status: 'resolved' as const,
        resolution: 'Full refund ke owner. Talent mendapat warning di record internal.',
        resolutionType: 'funds_to_owner' as const,
        resolvedBy: adminId,
        resolvedAt: new Date('2026-03-15'),
      },
    ])
    .onConflictDoNothing()

  // ========== 28. PROJECT APPLICATIONS (10+ applications) ==========
  console.log('  Seeding project applications...')
  await db
    .insert(projectApplications)
    .values([
      {
        id: uuidv7(),
        projectId: project2Id,
        talentId: tp4Id,
        status: 'pending' as const,
        coverNote:
          'Saya tertarik dengan proyek mobile booking ini. Sudah punya pengalaman di 3 proyek booking serupa menggunakan React Native.',
        recommendationScore: 0.87,
      },
      {
        id: uuidv7(),
        projectId: project2Id,
        talentId: tp5Id,
        status: 'pending' as const,
        coverNote:
          'Meskipun fresh graduate, saya sangat antusias dan sudah buat app booking sederhana sebagai portfolio.',
        recommendationScore: 0.65,
      },
      {
        id: uuidv7(),
        projectId: project5Id,
        talentId: tp1Id,
        status: 'pending' as const,
        coverNote:
          'Full-stack web app adalah spesialisasi saya. Sistem inventori mirip dengan proyek yang pernah saya kerjakan untuk warehouse di Surabaya.',
        recommendationScore: 0.82,
      },
      {
        id: uuidv7(),
        projectId: project5Id,
        talentId: tp3Id,
        status: 'pending' as const,
        coverNote:
          'Saya bisa handle backend untuk sistem inventori. Punya pengalaman membangun warehouse management system sebelumnya.',
        recommendationScore: 0.78,
      },
      {
        id: uuidv7(),
        projectId: project2Id,
        talentId: tp1Id,
        status: 'withdrawn' as const,
        coverNote:
          'Tertarik dengan proyek booking futsal, tapi ternyata jadwal saya bentrok dengan proyek lain.',
        recommendationScore: 0.75,
      },
      {
        id: uuidv7(),
        projectId: project7Id,
        talentId: tp6Id,
        status: 'pending' as const,
        coverNote:
          'Chatbot AI adalah spesialisasi saya. Sudah pernah build NLP pipeline untuk customer service dan sentiment analysis.',
        recommendationScore: 0.91,
      },
      {
        id: uuidv7(),
        projectId: project7Id,
        talentId: tp3Id,
        status: 'pending' as const,
        coverNote:
          'Saya bisa handle backend integration untuk WhatsApp Business API dan microservice architecture.',
        recommendationScore: 0.84,
      },
      {
        id: uuidv7(),
        projectId: project5Id,
        talentId: tp7Id,
        status: 'rejected' as const,
        coverNote: 'Saya bisa handle deployment dan infrastructure untuk sistem inventori.',
        recommendationScore: 0.45,
      },
      {
        id: uuidv7(),
        projectId: project3Id,
        talentId: tp6Id,
        status: 'pending' as const,
        coverNote:
          'Dashboard analytics adalah bidang saya. Bisa pakai Python untuk data processing dan React untuk visualisasi.',
        recommendationScore: 0.88,
      },
      {
        id: uuidv7(),
        projectId: project6Id,
        talentId: tp5Id,
        status: 'pending' as const,
        coverNote:
          'Landing page sederhana cocok untuk project pertama saya. Saya bisa deliver dalam 10 hari.',
        recommendationScore: 0.72,
      },
    ])
    .onConflictDoNothing()

  // ========== 29. PROJECT ACTIVITIES ==========
  console.log('  Seeding project activities...')
  await db
    .insert(projectActivities)
    .values([
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: adminId,
        type: 'status_changed' as const,
        title: 'Status proyek berubah ke In Progress',
        metadata: { fromStatus: 'matching', toStatus: 'in_progress' },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: talent3Id,
        type: 'milestone_submitted' as const,
        title: 'Eko mensubmit milestone "Database Schema & API Foundation"',
        metadata: { milestoneId: ms1Id },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: owner1Id,
        type: 'milestone_approved' as const,
        title: 'Ahmad menyetujui milestone "Database Schema & API Foundation"',
        metadata: { milestoneId: ms1Id },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: adminId,
        type: 'payment_released' as const,
        title: 'Dana Rp 4.800.000 dicairkan ke Eko Prasetyo',
        metadata: { milestoneId: ms1Id, amount: 4800000 },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: talent2Id,
        type: 'milestone_submitted' as const,
        title: 'Dewi mensubmit milestone "Design System & All Mockups"',
        metadata: { milestoneId: ms7Id },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: owner1Id,
        type: 'milestone_approved' as const,
        title: 'Ahmad menyetujui milestone "Design System & All Mockups"',
        metadata: { milestoneId: ms7Id },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: talent1Id,
        type: 'milestone_submitted' as const,
        title: 'Budi mensubmit milestone "Landing Page & Auth UI"',
        metadata: { milestoneId: ms4Id },
      },
      {
        id: uuidv7(),
        projectId: project1Id,
        userId: owner1Id,
        type: 'revision_requested' as const,
        title: 'Ahmad meminta revisi pada milestone "Landing Page & Auth UI"',
        metadata: { milestoneId: ms4Id, reason: 'Perbaiki responsive layout mobile' },
      },
      {
        id: uuidv7(),
        projectId: project10Id,
        userId: adminId,
        type: 'team_formed' as const,
        title: 'Tim proyek Platform Manajemen Proyek Internal telah terbentuk',
        metadata: { teamSize: 2 },
      },
      {
        id: uuidv7(),
        projectId: project9Id,
        userId: owner2Id,
        type: 'status_changed' as const,
        title: 'Proyek dibatalkan oleh owner',
        metadata: { fromStatus: 'draft', toStatus: 'cancelled', reason: 'Budget reallocation' },
      },
    ])
    .onConflictDoNothing()

  // ========== 30. TALENT PLACEMENT REQUESTS ==========
  console.log('  Seeding talent placement requests...')
  await db
    .insert(talentPlacementRequests)
    .values([
      {
        id: uuidv7(),
        projectId: project4Id,
        ownerId: owner2Id,
        talentId: tp2Id,
        status: 'in_discussion' as const,
        estimatedAnnualSalary: 180000000,
        conversionFeePercentage: 12.5,
        conversionFeeAmount: 22500000,
        notes:
          'Siti tertarik merekrut Dewi sebagai in-house UI/UX designer setelah puas dengan hasil redesign travel app.',
      },
      {
        id: uuidv7(),
        projectId: project8Id,
        ownerId: owner3Id,
        talentId: tp4Id,
        status: 'requested' as const,
        estimatedAnnualSalary: 144000000,
        conversionFeePercentage: 15.0,
        conversionFeeAmount: 21600000,
        notes:
          'Rahmat ingin Fitri bergabung sebagai mobile developer tetap untuk maintenance dan fitur baru aplikasi kasir.',
      },
    ])
    .onConflictDoNothing()

  // ========== 31. PLATFORM SETTINGS ==========
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
    { key: 'max_team_size', value: 8, description: 'Maksimum talent per proyek' },
    {
      key: 'matching_sla_single_hours',
      value: 72,
      description: 'SLA matching single worker (jam)',
    },
    { key: 'matching_sla_team_days', value: 14, description: 'SLA matching team project (hari)' },
    {
      key: 'worker_inactive_warning_days',
      value: 7,
      description: 'Hari tanpa aktivitas sebelum warning',
    },
    {
      key: 'milestone_review_deadline_days',
      value: 14,
      description: 'Hari deadline review milestone oleh owner',
    },
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

  console.log('Seed completed successfully!')
  console.log(`
  Created:
    - 12 users (2 admins, 3 owners, 7 talents)
    - 12 auth accounts (credential)
    - 35 skills across 7 categories
    - 7 talent profiles with 34 skill assignments
    - 10 projects (draft, scoping, brd_generated, brd_approved, matching, in_progress x2, completed x2, cancelled)
    - 23 project status logs
    - 3 BRD documents + 1 PRD document
    - 6 work packages with 1 dependency
    - 6 project assignments
    - 5 contracts (NDA + IP transfer)
    - 12 milestones (approved, in_progress, submitted, pending, revision_requested)
    - 5 milestone comments + 3 revision requests
    - 10 tasks
    - 12 time log entries
    - 7 payment accounts + 12 transactions + 5 transaction events + 6 ledger entries
    - 10 reviews
    - 12 notifications
    - 4 chat conversations + 8 participants + 12 messages
    - 2 disputes (open + resolved)
    - 10 project applications
    - 10 project activities
    - 2 talent placement requests
    - 12 platform settings
  `)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
