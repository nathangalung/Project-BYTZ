import { uuidv7 } from 'uuidv7'
import { getDb } from './client'
import {
  accounts,
  adminAuditLogs,
  aiInteractions,
  account as authAccount,
  brdDocuments,
  chatConversations,
  chatMessages,
  chatParticipants,
  contracts,
  deadLetterEvents,
  disputes,
  ledgerEntries,
  milestoneComments,
  milestoneFiles,
  milestones,
  notifications,
  outboxEvents,
  phoneVerifications,
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
  talentAssessments,
  talentPenalties,
  talentPlacementRequests,
  talentProfiles,
  talentSkills,
  taskDependencies,
  tasks,
  timeLogs,
  transactionEvents,
  transactions,
  user,
  userNotificationPreferences,
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
    disputes, reviews, notifications, user_notification_preferences,
    talent_skills, talent_assessments, talent_penalties, talent_profiles,
    talent_placement_requests,
    projects, phone_verifications, platform_settings, admin_audit_logs,
    outbox_events, dead_letter_events, ai_interactions,
    "user", session, account, verification, skills
    CASCADE`)

  // =====================================================================
  // FIXED IDs
  // =====================================================================

  // Users - Admins (2)
  const adminId = '00000000-0000-7000-8000-000000000001'
  const admin2Id = '00000000-0000-7000-8000-000000000002'

  // Users - Owners (10)
  const owner1Id = '00000000-0000-7000-8000-000000000010'
  const owner2Id = '00000000-0000-7000-8000-000000000011'
  const owner3Id = '00000000-0000-7000-8000-000000000012'
  const owner4Id = '00000000-0000-7000-8000-000000000013'
  const owner5Id = '00000000-0000-7000-8000-000000000014'
  const owner6Id = '00000000-0000-7000-8000-000000000015'
  const owner7Id = '00000000-0000-7000-8000-000000000016'
  const owner8Id = '00000000-0000-7000-8000-000000000017'
  const owner9Id = '00000000-0000-7000-8000-000000000018'
  const owner10Id = '00000000-0000-7000-8000-000000000019'

  // Users - Talents (8)
  const talent1Id = '00000000-0000-7000-8000-000000000020'
  const talent2Id = '00000000-0000-7000-8000-000000000021'
  const talent3Id = '00000000-0000-7000-8000-000000000022'
  const talent4Id = '00000000-0000-7000-8000-000000000023'
  const talent5Id = '00000000-0000-7000-8000-000000000024'
  const talent6Id = '00000000-0000-7000-8000-000000000025'
  const talent7Id = '00000000-0000-7000-8000-000000000026'
  const talent8Id = '00000000-0000-7000-8000-000000000027'

  // Talent Profiles
  const tp1Id = '00000000-0000-7000-8000-000000000030'
  const tp2Id = '00000000-0000-7000-8000-000000000031'
  const tp3Id = '00000000-0000-7000-8000-000000000032'
  const tp4Id = '00000000-0000-7000-8000-000000000033'
  const tp5Id = '00000000-0000-7000-8000-000000000034'
  const tp6Id = '00000000-0000-7000-8000-000000000035'
  const tp7Id = '00000000-0000-7000-8000-000000000036'
  const tp8Id = '00000000-0000-7000-8000-000000000037'

  // Projects (25)
  const p1Id = '00000000-0000-7000-8000-000000000040' // owner1 - completed
  const p2Id = '00000000-0000-7000-8000-000000000041' // owner1 - in_progress
  const p3Id = '00000000-0000-7000-8000-000000000042' // owner1 - draft
  const p4Id = '00000000-0000-7000-8000-000000000043' // owner2 - completed
  const p5Id = '00000000-0000-7000-8000-000000000044' // owner2 - brd_approved
  const p6Id = '00000000-0000-7000-8000-000000000045' // owner3 - matching
  const p7Id = '00000000-0000-7000-8000-000000000046' // owner4 - brd_generated
  const p8Id = '00000000-0000-7000-8000-000000000047' // owner5 - prd_approved
  const p9Id = '00000000-0000-7000-8000-000000000048' // owner6 - disputed
  const p10Id = '00000000-0000-7000-8000-000000000049' // owner7 - in_progress
  const p11Id = '00000000-0000-7000-8000-00000000004a' // owner7 - on_hold
  const p12Id = '00000000-0000-7000-8000-00000000004b' // owner8 - cancelled
  const p13Id = '00000000-0000-7000-8000-00000000004c' // owner9 - completed
  const p14Id = '00000000-0000-7000-8000-00000000004d' // owner10 - draft (new user)
  const p15Id = '00000000-0000-7000-8000-00000000004e' // owner1 - scoping (extra)
  const p16Id = '00000000-0000-7000-8000-00000000004f' // owner3 - brd_purchased
  const p17Id = '00000000-0000-7000-8000-000000000050' // owner4 - prd_generated
  const p18Id = '00000000-0000-7000-8000-000000000051' // owner5 - prd_purchased
  const p19Id = '00000000-0000-7000-8000-000000000052' // owner6 - matching (2nd)
  const p20Id = '00000000-0000-7000-8000-000000000053' // owner7 - team_forming
  const p21Id = '00000000-0000-7000-8000-000000000054' // owner8 - matched
  const p22Id = '00000000-0000-7000-8000-000000000055' // owner9 - in_progress (3rd)
  const p23Id = '00000000-0000-7000-8000-000000000056' // owner2 - partially_active
  const p24Id = '00000000-0000-7000-8000-000000000057' // owner3 - review
  const p25Id = '00000000-0000-7000-8000-000000000058' // owner5 - completed (3rd)

  // Work Packages
  const wp1Id = '00000000-0000-7000-8000-000000000060'
  const wp2Id = '00000000-0000-7000-8000-000000000061'
  const wp3Id = '00000000-0000-7000-8000-000000000062'
  const wp4Id = '00000000-0000-7000-8000-000000000063'
  const wp5Id = '00000000-0000-7000-8000-000000000064'
  const wp6Id = '00000000-0000-7000-8000-000000000065'
  const wp7Id = '00000000-0000-7000-8000-000000000066'
  const wp8Id = '00000000-0000-7000-8000-000000000067'
  const wp9Id = '00000000-0000-7000-8000-000000000068'
  const wp10Id = '00000000-0000-7000-8000-000000000069'
  const wp11Id = '00000000-0000-7000-8000-00000000006a'
  const wp12Id = '00000000-0000-7000-8000-00000000006b'
  const wp13Id = '00000000-0000-7000-8000-00000000006c'
  const wp14Id = '00000000-0000-7000-8000-00000000006d'
  const wp15Id = '00000000-0000-7000-8000-00000000006e'
  const wp16Id = '00000000-0000-7000-8000-00000000006f'
  const wp17Id = '00000000-0000-7000-8000-000000000070'
  const wp18Id = '00000000-0000-7000-8000-000000000071'
  const wp19Id = '00000000-0000-7000-8000-000000000072'
  const wp20Id = '00000000-0000-7000-8000-000000000073'
  const wp21Id = '00000000-0000-7000-8000-000000000074'
  const wp22Id = '00000000-0000-7000-8000-000000000075'

  // Assignments
  const asgn1Id = '00000000-0000-7000-8000-000000000080'
  const asgn2Id = '00000000-0000-7000-8000-000000000081'
  const asgn3Id = '00000000-0000-7000-8000-000000000082'
  const asgn4Id = '00000000-0000-7000-8000-000000000083'
  const asgn5Id = '00000000-0000-7000-8000-000000000084'
  const asgn6Id = '00000000-0000-7000-8000-000000000085'
  const asgn7Id = '00000000-0000-7000-8000-000000000086'
  const asgn8Id = '00000000-0000-7000-8000-000000000087'
  const asgn9Id = '00000000-0000-7000-8000-000000000088'
  const asgn10Id = '00000000-0000-7000-8000-000000000089'
  const asgn11Id = '00000000-0000-7000-8000-00000000008a'
  const asgn12Id = '00000000-0000-7000-8000-00000000008b'
  const asgn13Id = '00000000-0000-7000-8000-00000000008c'
  const asgn14Id = '00000000-0000-7000-8000-00000000008d'
  const asgn15Id = '00000000-0000-7000-8000-00000000008e'
  const asgn16Id = '00000000-0000-7000-8000-00000000008f'

  // Milestones
  const ms1Id = '00000000-0000-7000-8000-000000000090'
  const ms2Id = '00000000-0000-7000-8000-000000000091'
  const ms3Id = '00000000-0000-7000-8000-000000000092'
  const ms4Id = '00000000-0000-7000-8000-000000000093'
  const ms5Id = '00000000-0000-7000-8000-000000000094'
  const ms6Id = '00000000-0000-7000-8000-000000000095'
  const ms7Id = '00000000-0000-7000-8000-000000000096'
  const ms8Id = '00000000-0000-7000-8000-000000000097'
  const ms9Id = '00000000-0000-7000-8000-000000000098'
  const ms10Id = '00000000-0000-7000-8000-000000000099'
  const ms11Id = '00000000-0000-7000-8000-00000000009a'
  const ms12Id = '00000000-0000-7000-8000-00000000009b'
  const ms13Id = '00000000-0000-7000-8000-00000000009c'
  const ms14Id = '00000000-0000-7000-8000-00000000009d'
  const ms15Id = '00000000-0000-7000-8000-00000000009e'
  const ms16Id = '00000000-0000-7000-8000-00000000009f'
  const ms17Id = '00000000-0000-7000-8000-0000000000a0'
  const ms18Id = '00000000-0000-7000-8000-0000000000a1'
  const ms19Id = '00000000-0000-7000-8000-0000000000a2'
  const ms20Id = '00000000-0000-7000-8000-0000000000a3'
  const ms21Id = '00000000-0000-7000-8000-0000000000a4'
  const ms22Id = '00000000-0000-7000-8000-0000000000a5'
  const ms23Id = '00000000-0000-7000-8000-0000000000a6'
  const ms24Id = '00000000-0000-7000-8000-0000000000a7'
  const ms25Id = '00000000-0000-7000-8000-0000000000a8'
  const ms26Id = '00000000-0000-7000-8000-0000000000a9'
  const ms27Id = '00000000-0000-7000-8000-0000000000aa'

  // Tasks
  const task1Id = '00000000-0000-7000-8000-0000000000b0'
  const task2Id = '00000000-0000-7000-8000-0000000000b1'
  const task3Id = '00000000-0000-7000-8000-0000000000b2'
  const task4Id = '00000000-0000-7000-8000-0000000000b3'
  const task5Id = '00000000-0000-7000-8000-0000000000b4'
  const task6Id = '00000000-0000-7000-8000-0000000000b5'
  const task7Id = '00000000-0000-7000-8000-0000000000b6'
  const task8Id = '00000000-0000-7000-8000-0000000000b7'
  const task9Id = '00000000-0000-7000-8000-0000000000b8'
  const task10Id = '00000000-0000-7000-8000-0000000000b9'
  const task11Id = '00000000-0000-7000-8000-0000000000ba'
  const task12Id = '00000000-0000-7000-8000-0000000000bb'
  const task13Id = '00000000-0000-7000-8000-0000000000bc'
  const task14Id = '00000000-0000-7000-8000-0000000000bd'
  const task15Id = '00000000-0000-7000-8000-0000000000be'

  // Transactions
  const txn1Id = '00000000-0000-7000-8000-0000000000c0'
  const txn2Id = '00000000-0000-7000-8000-0000000000c1'
  const txn3Id = '00000000-0000-7000-8000-0000000000c2'
  const txn4Id = '00000000-0000-7000-8000-0000000000c3'
  const txn5Id = '00000000-0000-7000-8000-0000000000c4'
  const txn6Id = '00000000-0000-7000-8000-0000000000c5'
  const txn7Id = '00000000-0000-7000-8000-0000000000c6'
  const txn8Id = '00000000-0000-7000-8000-0000000000c7'
  const txn9Id = '00000000-0000-7000-8000-0000000000c8'
  const txn10Id = '00000000-0000-7000-8000-0000000000c9'
  const txn11Id = '00000000-0000-7000-8000-0000000000ca'
  const txn12Id = '00000000-0000-7000-8000-0000000000cb'
  const txn13Id = '00000000-0000-7000-8000-0000000000cc'
  const txn14Id = '00000000-0000-7000-8000-0000000000cd'
  const txn15Id = '00000000-0000-7000-8000-0000000000ce'
  const txn16Id = '00000000-0000-7000-8000-0000000000cf'
  const txn17Id = '00000000-0000-7000-8000-0000000000d0'
  const txn18Id = '00000000-0000-7000-8000-0000000000d1'
  const txn19Id = '00000000-0000-7000-8000-0000000000d2'
  const txn20Id = '00000000-0000-7000-8000-0000000000d3'

  // Payment accounts
  const platformAccId = '00000000-0000-7000-8000-0000000000e0'
  const escrowAccId = '00000000-0000-7000-8000-0000000000e1'
  const owner1AccId = '00000000-0000-7000-8000-0000000000e2'
  const owner2AccId = '00000000-0000-7000-8000-0000000000e3'
  const owner3AccId = '00000000-0000-7000-8000-0000000000e4'
  const owner5AccId = '00000000-0000-7000-8000-0000000000e5'
  const owner7AccId = '00000000-0000-7000-8000-0000000000e6'
  const owner9AccId = '00000000-0000-7000-8000-0000000000e7'
  const talent1AccId = '00000000-0000-7000-8000-0000000000e8'
  const talent2AccId = '00000000-0000-7000-8000-0000000000e9'
  const talent5AccId = '00000000-0000-7000-8000-0000000000ea'
  const talent7AccId = '00000000-0000-7000-8000-0000000000eb'
  const talent8AccId = '00000000-0000-7000-8000-0000000000ec'

  // Conversations
  const conv1Id = '00000000-0000-7000-8000-0000000000f0'
  const conv2Id = '00000000-0000-7000-8000-0000000000f1'
  const conv3Id = '00000000-0000-7000-8000-0000000000f2'
  const conv4Id = '00000000-0000-7000-8000-0000000000f3'
  const conv5Id = '00000000-0000-7000-8000-0000000000f4'
  const conv6Id = '00000000-0000-7000-8000-0000000000f5'
  const conv7Id = '00000000-0000-7000-8000-0000000000f6'
  const conv8Id = '00000000-0000-7000-8000-0000000000f7'
  const conv9Id = '00000000-0000-7000-8000-0000000000f8'
  const conv10Id = '00000000-0000-7000-8000-0000000000f9'
  const conv11Id = '00000000-0000-7000-8000-0000000000fa'
  const conv12Id = '00000000-0000-7000-8000-0000000000fb'
  const conv13Id = '00000000-0000-7000-8000-0000000000fc'
  const conv14Id = '00000000-0000-7000-8000-0000000000fd'
  const conv15Id = '00000000-0000-7000-8000-0000000000fe'

  // Disputes
  const dispute1Id = '00000000-0000-7000-8000-000000000100'

  // =====================================================================
  // 1. USERS (20: 2 admins, 10 owners, 8 talents)
  // =====================================================================
  console.log('  Seeding users...')
  const usersData = [
    // Admins
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
    // Owners
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
      email: 'siti@digitalindo.com',
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
      id: owner4Id,
      email: 'diana@batikmodern.id',
      name: 'Diana Kartika',
      phone: '+6281567890001',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner5Id,
      email: 'farhan@sehatplus.co.id',
      name: 'Farhan Pratama',
      phone: '+6281678901234',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner6Id,
      email: 'lina@edustart.id',
      name: 'Lina Wijaya',
      phone: '+6281789012345',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner7Id,
      email: 'agus@logistikpro.co.id',
      name: 'Agus Santoso',
      phone: '+6281890123456',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner8Id,
      email: 'rina@kulinerjakarta.id',
      name: 'Rina Maharani',
      phone: '+6281901234567',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner9Id,
      email: 'hendri@proptech.id',
      name: 'Hendri Gunawan',
      phone: '+6282012345678',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    {
      id: owner10Id,
      email: 'maya@tanidigital.id',
      name: 'Maya Anggraeni',
      phone: '+6282123456789',
      phoneVerified: true,
      role: 'owner' as const,
      isVerified: true,
      locale: 'id' as const,
    },
    // Talents
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
    {
      id: talent8Id,
      email: 'joko@example.com',
      name: 'Joko Susilo',
      phone: '+6281455667700',
      phoneVerified: true,
      role: 'talent' as const,
      isVerified: true,
      locale: 'id' as const,
    },
  ]
  for (const u of usersData) {
    await db.insert(user).values(u).onConflictDoNothing()
  }

  // =====================================================================
  // 2. BETTER AUTH ACCOUNTS
  // =====================================================================
  console.log('  Seeding auth accounts...')
  const seedPassword = 'Password123!'
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

  // =====================================================================
  // 3. SKILLS (35 skills)
  // =====================================================================
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
  const sk: Record<string, string> = {}
  for (const s of allSkills) {
    sk[s.name] = s.id
  }

  // =====================================================================
  // 4. TALENT PROFILES (8 profiles)
  // =====================================================================
  console.log('  Seeding talent profiles...')
  // talent1: senior, 3 completed, high rating - ACTIVE
  // talent2: mid, 2 completed + 1 ongoing
  // talent3: junior, 1 completed
  // talent4: brand new, 0 projects
  // talent5: 1 completed + 1 ongoing - ACTIVE
  // talent6: suspended (penalty) - BAD
  // talent7: 2 completed, available - GOOD
  // talent8: 1 ongoing - BUSY
  const talentProfilesData = [
    {
      id: tp1Id,
      userId: talent1Id,
      bio: 'Fullstack developer berpengalaman 7 tahun. Spesialisasi di React, Node.js, dan PostgreSQL. Pernah handle proyek fintech dan e-commerce besar di Jakarta.',
      yearsOfExperience: 7,
      tier: 'senior' as const,
      educationUniversity: 'Institut Teknologi Bandung',
      educationMajor: 'Teknik Informatika',
      educationYear: 2017,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['fintech', 'e-commerce', 'saas'],
      totalProjectsCompleted: 3,
      totalProjectsActive: 0,
      averageRating: 4.8,
      portfolioLinks: [
        { platform: 'GitHub', url: 'https://github.com/budisetiawan' },
        { platform: 'LinkedIn', url: 'https://linkedin.com/in/budisetiawan' },
      ],
      location: 'Jakarta Selatan',
    },
    {
      id: tp2Id,
      userId: talent2Id,
      bio: 'UI/UX Designer dengan passion di mobile-first design. 4 tahun pengalaman di agency digital.',
      yearsOfExperience: 4,
      tier: 'mid' as const,
      educationUniversity: 'Universitas Indonesia',
      educationMajor: 'Desain Komunikasi Visual',
      educationYear: 2020,
      availabilityStatus: 'busy' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce', 'healthcare', 'education'],
      totalProjectsCompleted: 2,
      totalProjectsActive: 1,
      averageRating: 4.6,
      portfolioLinks: [
        { platform: 'Dribbble', url: 'https://dribbble.com/dewilestari' },
        { platform: 'Behance', url: 'https://behance.net/dewilestari' },
      ],
      location: 'Bandung',
    },
    {
      id: tp3Id,
      userId: talent3Id,
      bio: 'Junior backend developer, 1.5 tahun pengalaman. Baru selesai satu proyek di platform KerjaCUS.',
      yearsOfExperience: 1,
      tier: 'junior' as const,
      educationUniversity: 'Universitas Gadjah Mada',
      educationMajor: 'Ilmu Komputer',
      educationYear: 2023,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce'],
      totalProjectsCompleted: 1,
      totalProjectsActive: 0,
      averageRating: 4.0,
      location: 'Yogyakarta',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/ekoprasetyo' }],
    },
    {
      id: tp4Id,
      userId: talent4Id,
      bio: 'Fresh graduate dari Universitas Brawijaya. Baru bergabung, belum pernah dapat proyek di KerjaCUS. Menguasai React Native dan Flutter.',
      yearsOfExperience: 0,
      tier: 'junior' as const,
      educationUniversity: 'Universitas Brawijaya',
      educationMajor: 'Sistem Informasi',
      educationYear: 2025,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce', 'education'],
      totalProjectsCompleted: 0,
      totalProjectsActive: 0,
      averageRating: null,
      location: 'Surabaya',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/fitrihandayani' }],
    },
    {
      id: tp5Id,
      userId: talent5Id,
      bio: 'Backend engineer specializing in Go and Python. 3 tahun pengalaman, satu proyek selesai dan satu sedang berjalan.',
      yearsOfExperience: 3,
      tier: 'mid' as const,
      educationUniversity: 'Institut Teknologi Sepuluh Nopember',
      educationMajor: 'Teknik Informatika',
      educationYear: 2021,
      availabilityStatus: 'busy' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['fintech', 'logistics', 'saas'],
      totalProjectsCompleted: 1,
      totalProjectsActive: 1,
      averageRating: 4.3,
      location: 'Jakarta Barat',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/gunawanwibowo' }],
    },
    {
      id: tp6Id,
      userId: talent6Id,
      bio: 'Data scientist dan ML engineer. Disuspend karena tidak responsif pada proyek sebelumnya.',
      yearsOfExperience: 4,
      tier: 'mid' as const,
      educationUniversity: 'Universitas Padjadjaran',
      educationMajor: 'Matematika',
      educationYear: 2020,
      availabilityStatus: 'unavailable' as const,
      verificationStatus: 'suspended' as const,
      domainExpertise: ['e-commerce', 'healthcare', 'saas'],
      totalProjectsCompleted: 0,
      totalProjectsActive: 0,
      averageRating: 2.5,
      location: 'Semarang',
      pemerataPenalty: 1.0,
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/hanapermata' }],
    },
    {
      id: tp7Id,
      userId: talent7Id,
      bio: 'Fullstack developer berpengalaman 5 tahun. 2 proyek selesai di KerjaCUS, tersedia untuk proyek baru.',
      yearsOfExperience: 5,
      tier: 'senior' as const,
      educationUniversity: 'Universitas Diponegoro',
      educationMajor: 'Teknik Komputer',
      educationYear: 2019,
      availabilityStatus: 'available' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['fintech', 'logistics', 'saas'],
      totalProjectsCompleted: 2,
      totalProjectsActive: 0,
      averageRating: 4.7,
      location: 'Malang',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/irfanmaulana' }],
    },
    {
      id: tp8Id,
      userId: talent8Id,
      bio: 'Mobile developer (Flutter), 2 tahun pengalaman. Sedang mengerjakan satu proyek aktif.',
      yearsOfExperience: 2,
      tier: 'junior' as const,
      educationUniversity: 'Universitas Hasanuddin',
      educationMajor: 'Teknik Informatika',
      educationYear: 2022,
      availabilityStatus: 'busy' as const,
      verificationStatus: 'verified' as const,
      domainExpertise: ['e-commerce', 'education'],
      totalProjectsCompleted: 0,
      totalProjectsActive: 1,
      averageRating: null,
      location: 'Depok',
      portfolioLinks: [{ platform: 'GitHub', url: 'https://github.com/jokosusilo' }],
    },
  ]
  for (const tp of talentProfilesData) {
    await db.insert(talentProfiles).values(tp).onConflictDoNothing()
  }

  // =====================================================================
  // 5. TALENT SKILLS
  // =====================================================================
  console.log('  Seeding talent skills...')
  const talentSkillsData = [
    // Budi (tp1) - senior fullstack
    { tid: tp1Id, s: 'React', p: 'expert' as const, primary: true },
    { tid: tp1Id, s: 'Node.js', p: 'expert' as const, primary: true },
    { tid: tp1Id, s: 'TypeScript', p: 'advanced' as const, primary: false },
    { tid: tp1Id, s: 'PostgreSQL', p: 'advanced' as const, primary: false },
    { tid: tp1Id, s: 'Docker', p: 'intermediate' as const, primary: false },
    { tid: tp1Id, s: 'Next.js', p: 'advanced' as const, primary: false },
    // Dewi (tp2) - mid designer
    { tid: tp2Id, s: 'Figma', p: 'expert' as const, primary: true },
    { tid: tp2Id, s: 'UI Design', p: 'expert' as const, primary: true },
    { tid: tp2Id, s: 'UX Design', p: 'advanced' as const, primary: false },
    { tid: tp2Id, s: 'Adobe XD', p: 'intermediate' as const, primary: false },
    // Eko (tp3) - junior backend
    { tid: tp3Id, s: 'Node.js', p: 'intermediate' as const, primary: true },
    { tid: tp3Id, s: 'PostgreSQL', p: 'intermediate' as const, primary: false },
    { tid: tp3Id, s: 'PHP', p: 'advanced' as const, primary: false },
    { tid: tp3Id, s: 'HTML/CSS', p: 'intermediate' as const, primary: false },
    // Fitri (tp4) - brand new mobile dev
    { tid: tp4Id, s: 'React Native', p: 'intermediate' as const, primary: true },
    { tid: tp4Id, s: 'Flutter', p: 'intermediate' as const, primary: true },
    { tid: tp4Id, s: 'TypeScript', p: 'beginner' as const, primary: false },
    { tid: tp4Id, s: 'Kotlin', p: 'beginner' as const, primary: false },
    // Gunawan (tp5) - mid backend Go/Python
    { tid: tp5Id, s: 'Go', p: 'advanced' as const, primary: true },
    { tid: tp5Id, s: 'Python', p: 'advanced' as const, primary: true },
    { tid: tp5Id, s: 'PostgreSQL', p: 'intermediate' as const, primary: false },
    { tid: tp5Id, s: 'Docker', p: 'intermediate' as const, primary: false },
    { tid: tp5Id, s: 'Redis', p: 'intermediate' as const, primary: false },
    // Hana (tp6) - suspended data/ML
    { tid: tp6Id, s: 'Python', p: 'expert' as const, primary: true },
    { tid: tp6Id, s: 'Machine Learning', p: 'advanced' as const, primary: true },
    { tid: tp6Id, s: 'TensorFlow', p: 'advanced' as const, primary: false },
    { tid: tp6Id, s: 'Data Analysis', p: 'advanced' as const, primary: false },
    // Irfan (tp7) - senior fullstack
    { tid: tp7Id, s: 'React', p: 'advanced' as const, primary: true },
    { tid: tp7Id, s: 'Node.js', p: 'advanced' as const, primary: true },
    { tid: tp7Id, s: 'TypeScript', p: 'advanced' as const, primary: false },
    { tid: tp7Id, s: 'PostgreSQL', p: 'advanced' as const, primary: false },
    { tid: tp7Id, s: 'Docker', p: 'advanced' as const, primary: false },
    { tid: tp7Id, s: 'AWS', p: 'intermediate' as const, primary: false },
    // Joko (tp8) - junior mobile (Flutter)
    { tid: tp8Id, s: 'Flutter', p: 'advanced' as const, primary: true },
    { tid: tp8Id, s: 'Kotlin', p: 'intermediate' as const, primary: false },
    { tid: tp8Id, s: 'Node.js', p: 'beginner' as const, primary: false },
  ]
  for (const ws of talentSkillsData) {
    const sid = sk[ws.s]
    if (sid) {
      await db
        .insert(talentSkills)
        .values({ talentId: ws.tid, skillId: sid, proficiencyLevel: ws.p, isPrimary: ws.primary })
        .onConflictDoNothing()
    }
  }

  // =====================================================================
  // 6. PROJECTS (25 covering all 18 statuses)
  // =====================================================================
  console.log('  Seeding projects...')
  // Status distribution:
  // p1  = completed      (owner1)    p2  = in_progress   (owner1, team=2)
  // p3  = draft          (owner1)    p4  = completed      (owner2)
  // p5  = brd_approved   (owner2)    p6  = matching       (owner3)
  // p7  = brd_generated  (owner4)    p8  = prd_approved   (owner5)
  // p9  = disputed       (owner6)    p10 = in_progress    (owner7, team=2)
  // p11 = on_hold        (owner7)    p12 = cancelled      (owner8)
  // p13 = completed      (owner9)    p14 = draft          (owner10 - brand new)
  // p15 = scoping        (owner1)    p16 = brd_purchased  (owner3)
  // p17 = prd_generated  (owner4)    p18 = prd_purchased  (owner5)
  // p19 = matching       (owner6)    p20 = team_forming   (owner7, team=3)
  // p21 = matched        (owner8)    p22 = in_progress    (owner9)
  // p23 = partially_active (owner2, team=2)  p24 = review (owner3)
  // p25 = completed      (owner5)

  const projectsData = [
    {
      id: p1Id,
      ownerId: owner1Id,
      title: 'Platform E-commerce KopiNusantara',
      description:
        'Marketplace online untuk UMKM kopi Indonesia. Fitur: katalog produk, keranjang belanja, pembayaran online, dashboard penjual, review & rating.',
      category: 'web_app' as const,
      status: 'completed' as const,
      budgetMin: 35000000,
      budgetMax: 55000000,
      estimatedTimelineDays: 60,
      teamSize: 1,
      finalPrice: 45000000,
      platformFee: 9000000,
      talentPayout: 36000000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
      visibility: 'public_detail' as const,
      projectType: 'company' as const,
      companyName: 'PT KopiNusantara Digital',
      companyRole: 'CEO',
      progress: 100,
      completenessScore: 100,
      documentFileUrl: 'uploads/specs/p1-kopinusantara-spec.pdf',
    },
    {
      id: p2Id,
      ownerId: owner1Id,
      title: 'Mobile App Booking Lapangan Futsal',
      description:
        'Aplikasi mobile untuk booking lapangan futsal secara online. Real-time booking, pembayaran online, notifikasi reminder.',
      category: 'mobile_app' as const,
      status: 'in_progress' as const,
      budgetMin: 20000000,
      budgetMax: 35000000,
      estimatedTimelineDays: 45,
      teamSize: 2,
      finalPrice: 30000000,
      platformFee: 7500000,
      talentPayout: 22500000,
      preferences: { requiredSkills: ['React Native', 'Node.js'] },
      visibility: 'public_summary' as const,
      projectType: 'individual' as const,
      progress: 45,
      completenessScore: 90,
    },
    {
      id: p3Id,
      ownerId: owner1Id,
      title: 'Chatbot Customer Service AI',
      description:
        'Chatbot berbasis AI untuk layanan pelanggan e-commerce. Integrasi WhatsApp Business API.',
      category: 'data_ai' as const,
      status: 'draft' as const,
      budgetMin: 20000000,
      budgetMax: 40000000,
      estimatedTimelineDays: 45,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      talentPayout: null,
      preferences: {},
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 0,
    },
    {
      id: p4Id,
      ownerId: owner2Id,
      title: 'Redesign UI/UX Aplikasi Travel',
      description:
        'Redesign total UI/UX untuk aplikasi booking travel. User research, wireframing, prototyping di Figma, design system.',
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
      visibility: 'public_detail' as const,
      projectType: 'company' as const,
      companyName: 'PT Traveloka Lite',
      companyRole: 'Head of Design',
      progress: 100,
      completenessScore: 100,
      documentFileUrl: 'uploads/specs/p4-travel-redesign-brief.pdf',
    },
    {
      id: p5Id,
      ownerId: owner2Id,
      title: 'Dashboard Analytics Penjualan',
      description:
        'Dashboard analytics untuk monitoring performa bisnis. Visualisasi data penjualan, customer insights.',
      category: 'data_ai' as const,
      status: 'brd_approved' as const,
      budgetMin: 15000000,
      budgetMax: 25000000,
      estimatedTimelineDays: 30,
      teamSize: 1,
      finalPrice: 22000000,
      platformFee: 5500000,
      talentPayout: 16500000,
      preferences: { requiredSkills: ['React', 'Python', 'PostgreSQL'] },
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 82,
    },
    {
      id: p6Id,
      ownerId: owner3Id,
      title: 'Sistem Manajemen Inventori Gudang',
      description:
        'Aplikasi web untuk manajemen stok gudang. Barcode scanning, stok real-time, purchase order.',
      category: 'web_app' as const,
      status: 'matching' as const,
      budgetMin: 25000000,
      budgetMax: 40000000,
      estimatedTimelineDays: 45,
      teamSize: 1,
      finalPrice: 35000000,
      platformFee: 7000000,
      talentPayout: 28000000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
      visibility: 'public_detail' as const,
      projectType: 'company' as const,
      companyName: 'CV Gudang Cerdas',
      companyRole: 'COO',
      progress: 0,
      completenessScore: 88,
      documentFileUrl: 'uploads/specs/p6-inventori-gudang-spec.docx',
    },
    {
      id: p7Id,
      ownerId: owner4Id,
      title: 'E-commerce Batik Modern',
      description: 'Toko online untuk koleksi batik modern. Target pasar anak muda 18-35 tahun.',
      category: 'web_app' as const,
      status: 'brd_generated' as const,
      budgetMin: 20000000,
      budgetMax: 40000000,
      estimatedTimelineDays: 45,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      talentPayout: null,
      preferences: { requiredSkills: ['React', 'Node.js'] },
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 80,
    },
    {
      id: p8Id,
      ownerId: owner5Id,
      title: 'Dashboard Monitoring Kesehatan',
      description:
        'Dashboard real-time untuk monitoring data kesehatan pasien dari wearable devices.',
      category: 'data_ai' as const,
      status: 'prd_approved' as const,
      budgetMin: 40000000,
      budgetMax: 60000000,
      estimatedTimelineDays: 60,
      teamSize: 2,
      finalPrice: 55000000,
      platformFee: 8250000,
      talentPayout: 46750000,
      preferences: { requiredSkills: ['React', 'Python', 'Machine Learning'] },
      visibility: 'private' as const,
      projectType: 'company' as const,
      companyName: 'PT EduStart Indonesia',
      companyRole: 'CTO',
      progress: 0,
      completenessScore: 85,
    },
    {
      id: p9Id,
      ownerId: owner6Id,
      title: 'Platform LMS EduStart',
      description:
        'Learning Management System untuk kursus online. Upload video, quiz interaktif, sertifikat otomatis.',
      category: 'web_app' as const,
      status: 'disputed' as const,
      budgetMin: 30000000,
      budgetMax: 50000000,
      estimatedTimelineDays: 60,
      teamSize: 1,
      finalPrice: 42000000,
      platformFee: 8400000,
      talentPayout: 33600000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
      visibility: 'private' as const,
      projectType: 'company' as const,
      companyName: 'PT EduStart Indonesia',
      companyRole: 'CTO',
      progress: 30,
      completenessScore: 85,
    },
    {
      id: p10Id,
      ownerId: owner7Id,
      title: 'Platform Manajemen Proyek Internal',
      description:
        'Aplikasi web untuk manajemen proyek tim internal. Kanban board, Gantt chart, time tracking.',
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
      visibility: 'public_summary' as const,
      projectType: 'company' as const,
      companyName: 'PT ProManage Digital',
      companyRole: 'VP Engineering',
      progress: 60,
      completenessScore: 92,
    },
    {
      id: p11Id,
      ownerId: owner7Id,
      title: 'Sistem Tracking Armada Logistik',
      description: 'Web app untuk tracking posisi armada pengiriman real-time menggunakan GPS.',
      category: 'web_app' as const,
      status: 'on_hold' as const,
      budgetMin: 35000000,
      budgetMax: 55000000,
      estimatedTimelineDays: 60,
      teamSize: 1,
      finalPrice: 48000000,
      platformFee: 9600000,
      talentPayout: 38400000,
      preferences: { requiredSkills: ['React', 'Go', 'PostgreSQL'] },
      visibility: 'private' as const,
      projectType: 'company' as const,
      companyName: 'PT Armada Logistik',
      companyRole: 'IT Manager',
      progress: 20,
      completenessScore: 88,
    },
    {
      id: p12Id,
      ownerId: owner8Id,
      title: 'Aplikasi Reservasi Restoran',
      description: 'Sistem reservasi online untuk chain restoran. Table management, waitlist.',
      category: 'web_app' as const,
      status: 'cancelled' as const,
      budgetMin: 12000000,
      budgetMax: 20000000,
      estimatedTimelineDays: 30,
      teamSize: 1,
      finalPrice: 16000000,
      platformFee: 4000000,
      talentPayout: 12000000,
      preferences: { requiredSkills: ['React', 'Node.js'] },
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 82,
    },
    {
      id: p13Id,
      ownerId: owner9Id,
      title: 'Aplikasi Mobile Kasir UMKM',
      description:
        'Aplikasi kasir (POS) untuk UMKM. Pencatatan penjualan, manajemen stok, struk digital via WhatsApp.',
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
      visibility: 'public_summary' as const,
      projectType: 'individual' as const,
      progress: 100,
      completenessScore: 100,
    },
    {
      id: p14Id,
      ownerId: owner10Id,
      title: 'Marketplace Produk Pertanian',
      description: 'Marketplace B2B/B2C untuk produk pertanian segar. Direct-from-farm ordering.',
      category: 'web_app' as const,
      status: 'draft' as const,
      budgetMin: 20000000,
      budgetMax: 35000000,
      estimatedTimelineDays: 45,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      talentPayout: null,
      preferences: {},
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 0,
    },
    {
      id: p15Id,
      ownerId: owner1Id,
      title: 'Sistem Notifikasi Multi-Channel',
      description:
        'Platform notifikasi terintegrasi email, SMS, push notification untuk e-commerce.',
      category: 'web_app' as const,
      status: 'scoping' as const,
      budgetMin: 15000000,
      budgetMax: 25000000,
      estimatedTimelineDays: 30,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      talentPayout: null,
      preferences: { requiredSkills: ['Node.js', 'Redis'] },
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 45,
    },
    {
      id: p16Id,
      ownerId: owner3Id,
      title: 'Website Company Profile Gudang Cerdas',
      description: 'Website company profile dengan portfolio produk dan contact form.',
      category: 'web_app' as const,
      status: 'brd_purchased' as const,
      budgetMin: 5000000,
      budgetMax: 10000000,
      estimatedTimelineDays: 14,
      teamSize: 1,
      finalPrice: null,
      platformFee: null,
      talentPayout: null,
      preferences: { requiredSkills: ['React', 'Tailwind CSS'] },
      visibility: 'private' as const,
      projectType: 'company' as const,
      companyName: 'CV Gudang Cerdas',
      companyRole: 'Marketing Manager',
      progress: 0,
      completenessScore: 80,
    },
    {
      id: p17Id,
      ownerId: owner4Id,
      title: 'Marketplace Produk Handmade',
      description:
        'Marketplace khusus produk handmade dan kerajinan tangan Indonesia. Storefront, custom order.',
      category: 'web_app' as const,
      status: 'prd_generated' as const,
      budgetMin: 25000000,
      budgetMax: 45000000,
      estimatedTimelineDays: 60,
      teamSize: 2,
      finalPrice: 42000000,
      platformFee: 8400000,
      talentPayout: 33600000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 83,
    },
    {
      id: p18Id,
      ownerId: owner5Id,
      title: 'Mobile App Belajar Bahasa Daerah',
      description:
        'Aplikasi mobile gamifikasi untuk belajar bahasa daerah Indonesia. Quiz, flashcard, leaderboard.',
      category: 'mobile_app' as const,
      status: 'prd_purchased' as const,
      budgetMin: 15000000,
      budgetMax: 25000000,
      estimatedTimelineDays: 45,
      teamSize: 1,
      finalPrice: 22000000,
      platformFee: 5500000,
      talentPayout: 16500000,
      preferences: { requiredSkills: ['Flutter'] },
      visibility: 'private' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 85,
    },
    {
      id: p19Id,
      ownerId: owner6Id,
      title: 'Platform Ujian Online',
      description:
        'Platform untuk ujian online dengan proctoring sederhana. Timer, random question, auto-grading.',
      category: 'web_app' as const,
      status: 'matching' as const,
      budgetMin: 15000000,
      budgetMax: 25000000,
      estimatedTimelineDays: 40,
      teamSize: 1,
      finalPrice: 20000000,
      platformFee: 5000000,
      talentPayout: 15000000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
      visibility: 'public_detail' as const,
      projectType: 'company' as const,
      companyName: 'PT Inventori Plus',
      companyRole: 'Founder',
      progress: 0,
      completenessScore: 86,
    },
    {
      id: p20Id,
      ownerId: owner7Id,
      title: 'Platform Manajemen Properti SaaS',
      description:
        'SaaS untuk manajemen properti sewaan. Tenant management, rent collection, maintenance request.',
      category: 'web_app' as const,
      status: 'team_forming' as const,
      budgetMin: 45000000,
      budgetMax: 70000000,
      estimatedTimelineDays: 75,
      teamSize: 3,
      finalPrice: 65000000,
      platformFee: 9750000,
      talentPayout: 55250000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL', 'Figma'] },
      visibility: 'public_detail' as const,
      projectType: 'company' as const,
      companyName: 'PT ProManage Digital',
      companyRole: 'VP Engineering',
      progress: 0,
      completenessScore: 90,
    },
    {
      id: p21Id,
      ownerId: owner8Id,
      title: 'Aplikasi Loyalty & Rewards Restoran',
      description:
        'Aplikasi mobile loyalty program untuk restoran. Point collection, redeem rewards, push notification.',
      category: 'mobile_app' as const,
      status: 'matched' as const,
      budgetMin: 15000000,
      budgetMax: 25000000,
      estimatedTimelineDays: 40,
      teamSize: 1,
      finalPrice: 20000000,
      platformFee: 5000000,
      talentPayout: 15000000,
      preferences: { requiredSkills: ['Flutter'] },
      visibility: 'public_summary' as const,
      projectType: 'individual' as const,
      progress: 0,
      completenessScore: 88,
    },
    {
      id: p22Id,
      ownerId: owner9Id,
      title: 'Portal Listing Properti',
      description:
        'Website listing properti dengan pencarian advanced, virtual tour 360, kalkulator KPR.',
      category: 'web_app' as const,
      status: 'in_progress' as const,
      budgetMin: 30000000,
      budgetMax: 50000000,
      estimatedTimelineDays: 60,
      teamSize: 1,
      finalPrice: 45000000,
      platformFee: 9000000,
      talentPayout: 36000000,
      preferences: { requiredSkills: ['React', 'Node.js', 'PostgreSQL'] },
      visibility: 'public_summary' as const,
      projectType: 'individual' as const,
      progress: 35,
      completenessScore: 92,
    },
    {
      id: p23Id,
      ownerId: owner2Id,
      title: 'Dashboard Fleet Analytics',
      description:
        'Dashboard analytics untuk fleet management. Real-time monitoring, fuel consumption analysis.',
      category: 'data_ai' as const,
      status: 'partially_active' as const,
      budgetMin: 30000000,
      budgetMax: 50000000,
      estimatedTimelineDays: 60,
      teamSize: 2,
      finalPrice: 45000000,
      platformFee: 9000000,
      talentPayout: 36000000,
      preferences: { requiredSkills: ['React', 'Python', 'PostgreSQL'] },
      visibility: 'private' as const,
      projectType: 'company' as const,
      companyName: 'PT Data Analitik',
      companyRole: 'Head of Data',
      progress: 40,
      completenessScore: 90,
    },
    {
      id: p24Id,
      ownerId: owner3Id,
      title: 'Aplikasi Pencatatan Panen',
      description:
        'Aplikasi mobile sederhana untuk pencatatan hasil panen petani. Input harian, laporan.',
      category: 'mobile_app' as const,
      status: 'review' as const,
      budgetMin: 6000000,
      budgetMax: 12000000,
      estimatedTimelineDays: 25,
      teamSize: 1,
      finalPrice: 10000000,
      platformFee: 3000000,
      talentPayout: 7000000,
      preferences: { requiredSkills: ['Flutter'] },
      visibility: 'public_summary' as const,
      projectType: 'individual' as const,
      progress: 80,
      completenessScore: 95,
    },
    {
      id: p25Id,
      ownerId: owner5Id,
      title: 'Website Klinik Kesehatan',
      description: 'Website company profile dan appointment system untuk klinik kesehatan.',
      category: 'web_app' as const,
      status: 'completed' as const,
      budgetMin: 10000000,
      budgetMax: 20000000,
      estimatedTimelineDays: 30,
      teamSize: 1,
      finalPrice: 15000000,
      platformFee: 3750000,
      talentPayout: 11250000,
      preferences: { requiredSkills: ['React', 'Node.js'] },
      visibility: 'public_detail' as const,
      projectType: 'company' as const,
      companyName: 'Klinik Sehat Sejahtera',
      companyRole: 'Direktur',
      progress: 100,
      completenessScore: 100,
    },
  ]
  for (const p of projectsData) {
    await db.insert(projects).values(p).onConflictDoNothing()
  }

  // =====================================================================
  // 7. PROJECT STATUS LOGS
  // =====================================================================
  console.log('  Seeding project status logs...')
  type StatusType = typeof projectStatusLogs.$inferInsert.toStatus
  const logs: { pid: string; from: string | null; to: string; by: string }[] = [
    // p1 completed
    { pid: p1Id, from: null, to: 'draft', by: owner1Id },
    { pid: p1Id, from: 'draft', to: 'scoping', by: owner1Id },
    { pid: p1Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p1Id, from: 'brd_generated', to: 'brd_approved', by: owner1Id },
    { pid: p1Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p1Id, from: 'prd_generated', to: 'prd_approved', by: owner1Id },
    { pid: p1Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p1Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p1Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p1Id, from: 'in_progress', to: 'review', by: adminId },
    { pid: p1Id, from: 'review', to: 'completed', by: owner1Id },
    // p2 in_progress (team=2)
    { pid: p2Id, from: null, to: 'draft', by: owner1Id },
    { pid: p2Id, from: 'draft', to: 'scoping', by: owner1Id },
    { pid: p2Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p2Id, from: 'brd_generated', to: 'brd_approved', by: owner1Id },
    { pid: p2Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p2Id, from: 'prd_generated', to: 'prd_approved', by: owner1Id },
    { pid: p2Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p2Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p2Id, from: 'matched', to: 'in_progress', by: adminId },
    // p3 draft
    { pid: p3Id, from: null, to: 'draft', by: owner1Id },
    // p4 completed
    { pid: p4Id, from: null, to: 'draft', by: owner2Id },
    { pid: p4Id, from: 'draft', to: 'scoping', by: owner2Id },
    { pid: p4Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p4Id, from: 'brd_generated', to: 'brd_approved', by: owner2Id },
    { pid: p4Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p4Id, from: 'prd_generated', to: 'prd_approved', by: owner2Id },
    { pid: p4Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p4Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p4Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p4Id, from: 'in_progress', to: 'review', by: adminId },
    { pid: p4Id, from: 'review', to: 'completed', by: owner2Id },
    // p5 brd_approved
    { pid: p5Id, from: null, to: 'draft', by: owner2Id },
    { pid: p5Id, from: 'draft', to: 'scoping', by: owner2Id },
    { pid: p5Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p5Id, from: 'brd_generated', to: 'brd_approved', by: owner2Id },
    // p6 matching
    { pid: p6Id, from: null, to: 'draft', by: owner3Id },
    { pid: p6Id, from: 'draft', to: 'scoping', by: owner3Id },
    { pid: p6Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p6Id, from: 'brd_generated', to: 'brd_approved', by: owner3Id },
    { pid: p6Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p6Id, from: 'prd_generated', to: 'prd_approved', by: owner3Id },
    { pid: p6Id, from: 'prd_approved', to: 'matching', by: adminId },
    // p7 brd_generated
    { pid: p7Id, from: null, to: 'draft', by: owner4Id },
    { pid: p7Id, from: 'draft', to: 'scoping', by: owner4Id },
    { pid: p7Id, from: 'scoping', to: 'brd_generated', by: adminId },
    // p8 prd_approved
    { pid: p8Id, from: null, to: 'draft', by: owner5Id },
    { pid: p8Id, from: 'draft', to: 'scoping', by: owner5Id },
    { pid: p8Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p8Id, from: 'brd_generated', to: 'brd_approved', by: owner5Id },
    { pid: p8Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p8Id, from: 'prd_generated', to: 'prd_approved', by: owner5Id },
    // p9 disputed
    { pid: p9Id, from: null, to: 'draft', by: owner6Id },
    { pid: p9Id, from: 'draft', to: 'scoping', by: owner6Id },
    { pid: p9Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p9Id, from: 'brd_generated', to: 'brd_approved', by: owner6Id },
    { pid: p9Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p9Id, from: 'prd_generated', to: 'prd_approved', by: owner6Id },
    { pid: p9Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p9Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p9Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p9Id, from: 'in_progress', to: 'disputed', by: owner6Id },
    // p10 in_progress (team=2)
    { pid: p10Id, from: null, to: 'draft', by: owner7Id },
    { pid: p10Id, from: 'draft', to: 'scoping', by: owner7Id },
    { pid: p10Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p10Id, from: 'brd_generated', to: 'brd_approved', by: owner7Id },
    { pid: p10Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p10Id, from: 'prd_generated', to: 'prd_approved', by: owner7Id },
    { pid: p10Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p10Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p10Id, from: 'matched', to: 'in_progress', by: adminId },
    // p11 on_hold
    { pid: p11Id, from: null, to: 'draft', by: owner7Id },
    { pid: p11Id, from: 'draft', to: 'scoping', by: owner7Id },
    { pid: p11Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p11Id, from: 'brd_generated', to: 'brd_approved', by: owner7Id },
    { pid: p11Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p11Id, from: 'prd_generated', to: 'prd_approved', by: owner7Id },
    { pid: p11Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p11Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p11Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p11Id, from: 'in_progress', to: 'on_hold', by: owner7Id },
    // p12 cancelled
    { pid: p12Id, from: null, to: 'draft', by: owner8Id },
    { pid: p12Id, from: 'draft', to: 'scoping', by: owner8Id },
    { pid: p12Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p12Id, from: 'brd_generated', to: 'brd_approved', by: owner8Id },
    { pid: p12Id, from: 'brd_approved', to: 'cancelled', by: owner8Id },
    // p13 completed
    { pid: p13Id, from: null, to: 'draft', by: owner9Id },
    { pid: p13Id, from: 'draft', to: 'scoping', by: owner9Id },
    { pid: p13Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p13Id, from: 'brd_generated', to: 'brd_approved', by: owner9Id },
    { pid: p13Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p13Id, from: 'prd_generated', to: 'prd_approved', by: owner9Id },
    { pid: p13Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p13Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p13Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p13Id, from: 'in_progress', to: 'review', by: adminId },
    { pid: p13Id, from: 'review', to: 'completed', by: owner9Id },
    // p14 draft (owner10 brand new)
    { pid: p14Id, from: null, to: 'draft', by: owner10Id },
    // p15 scoping
    { pid: p15Id, from: null, to: 'draft', by: owner1Id },
    { pid: p15Id, from: 'draft', to: 'scoping', by: owner1Id },
    // p16 brd_purchased
    { pid: p16Id, from: null, to: 'draft', by: owner3Id },
    { pid: p16Id, from: 'draft', to: 'scoping', by: owner3Id },
    { pid: p16Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p16Id, from: 'brd_generated', to: 'brd_approved', by: owner3Id },
    { pid: p16Id, from: 'brd_approved', to: 'brd_purchased', by: owner3Id },
    // p17 prd_generated
    { pid: p17Id, from: null, to: 'draft', by: owner4Id },
    { pid: p17Id, from: 'draft', to: 'scoping', by: owner4Id },
    { pid: p17Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p17Id, from: 'brd_generated', to: 'brd_approved', by: owner4Id },
    { pid: p17Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    // p18 prd_purchased
    { pid: p18Id, from: null, to: 'draft', by: owner5Id },
    { pid: p18Id, from: 'draft', to: 'scoping', by: owner5Id },
    { pid: p18Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p18Id, from: 'brd_generated', to: 'brd_approved', by: owner5Id },
    { pid: p18Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p18Id, from: 'prd_generated', to: 'prd_approved', by: owner5Id },
    { pid: p18Id, from: 'prd_approved', to: 'prd_purchased', by: owner5Id },
    // p19 matching
    { pid: p19Id, from: null, to: 'draft', by: owner6Id },
    { pid: p19Id, from: 'draft', to: 'scoping', by: owner6Id },
    { pid: p19Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p19Id, from: 'brd_generated', to: 'brd_approved', by: owner6Id },
    { pid: p19Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p19Id, from: 'prd_generated', to: 'prd_approved', by: owner6Id },
    { pid: p19Id, from: 'prd_approved', to: 'matching', by: adminId },
    // p20 team_forming (team=3)
    { pid: p20Id, from: null, to: 'draft', by: owner7Id },
    { pid: p20Id, from: 'draft', to: 'scoping', by: owner7Id },
    { pid: p20Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p20Id, from: 'brd_generated', to: 'brd_approved', by: owner7Id },
    { pid: p20Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p20Id, from: 'prd_generated', to: 'prd_approved', by: owner7Id },
    { pid: p20Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p20Id, from: 'matching', to: 'team_forming', by: adminId },
    // p21 matched
    { pid: p21Id, from: null, to: 'draft', by: owner8Id },
    { pid: p21Id, from: 'draft', to: 'scoping', by: owner8Id },
    { pid: p21Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p21Id, from: 'brd_generated', to: 'brd_approved', by: owner8Id },
    { pid: p21Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p21Id, from: 'prd_generated', to: 'prd_approved', by: owner8Id },
    { pid: p21Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p21Id, from: 'matching', to: 'matched', by: adminId },
    // p22 in_progress
    { pid: p22Id, from: null, to: 'draft', by: owner9Id },
    { pid: p22Id, from: 'draft', to: 'scoping', by: owner9Id },
    { pid: p22Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p22Id, from: 'brd_generated', to: 'brd_approved', by: owner9Id },
    { pid: p22Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p22Id, from: 'prd_generated', to: 'prd_approved', by: owner9Id },
    { pid: p22Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p22Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p22Id, from: 'matched', to: 'in_progress', by: adminId },
    // p23 partially_active (team=2)
    { pid: p23Id, from: null, to: 'draft', by: owner2Id },
    { pid: p23Id, from: 'draft', to: 'scoping', by: owner2Id },
    { pid: p23Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p23Id, from: 'brd_generated', to: 'brd_approved', by: owner2Id },
    { pid: p23Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p23Id, from: 'prd_generated', to: 'prd_approved', by: owner2Id },
    { pid: p23Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p23Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p23Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p23Id, from: 'in_progress', to: 'partially_active', by: adminId },
    // p24 review
    { pid: p24Id, from: null, to: 'draft', by: owner3Id },
    { pid: p24Id, from: 'draft', to: 'scoping', by: owner3Id },
    { pid: p24Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p24Id, from: 'brd_generated', to: 'brd_approved', by: owner3Id },
    { pid: p24Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p24Id, from: 'prd_generated', to: 'prd_approved', by: owner3Id },
    { pid: p24Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p24Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p24Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p24Id, from: 'in_progress', to: 'review', by: adminId },
    // p25 completed
    { pid: p25Id, from: null, to: 'draft', by: owner5Id },
    { pid: p25Id, from: 'draft', to: 'scoping', by: owner5Id },
    { pid: p25Id, from: 'scoping', to: 'brd_generated', by: adminId },
    { pid: p25Id, from: 'brd_generated', to: 'brd_approved', by: owner5Id },
    { pid: p25Id, from: 'brd_approved', to: 'prd_generated', by: adminId },
    { pid: p25Id, from: 'prd_generated', to: 'prd_approved', by: owner5Id },
    { pid: p25Id, from: 'prd_approved', to: 'matching', by: adminId },
    { pid: p25Id, from: 'matching', to: 'matched', by: adminId },
    { pid: p25Id, from: 'matched', to: 'in_progress', by: adminId },
    { pid: p25Id, from: 'in_progress', to: 'review', by: adminId },
    { pid: p25Id, from: 'review', to: 'completed', by: owner5Id },
  ]
  for (const l of logs) {
    await db
      .insert(projectStatusLogs)
      .values({
        id: uuidv7(),
        projectId: l.pid,
        fromStatus: l.from as StatusType,
        toStatus: l.to as StatusType,
        changedBy: l.by,
        reason: l.from ? `Status changed from ${l.from} to ${l.to}` : 'Project created',
      })
      .onConflictDoNothing()
  }

  // =====================================================================
  // 8. BRD DOCUMENTS
  // =====================================================================
  console.log('  Seeding BRD documents...')
  const makeBrd = (
    pid: string,
    status: 'draft' | 'review' | 'approved' | 'paid',
    price: number,
    version: number,
    summary: string,
    objectives: string[],
    scope: string,
    reqs: { title: string; content: string }[],
    nfr: string[],
    timeline: number,
    teamSize: number,
    risks: string[],
  ) => ({
    id: uuidv7(),
    projectId: pid,
    version,
    status,
    price,
    content: {
      executiveSummary: summary,
      businessObjectives: objectives,
      scope,
      functionalRequirements: reqs,
      nonFunctionalRequirements: nfr,
      estimatedPriceMin: price * 8,
      estimatedPriceMax: price * 15,
      estimatedTimelineDays: timeline,
      estimatedTeamSize: teamSize,
      riskAssessment: risks,
    },
  })
  await db
    .insert(brdDocuments)
    .values([
      makeBrd(
        p1Id,
        'paid',
        2500000,
        2,
        'Platform e-commerce untuk UMKM kopi Indonesia.',
        ['Meningkatkan penjualan UMKM kopi 50%', 'Mencapai 10.000 pengguna aktif dalam 6 bulan'],
        'Web app responsif dengan marketplace, payment gateway, dan dashboard analytics.',
        [
          { title: 'Katalog Produk', content: 'CRUD produk, kategori, filter, pencarian' },
          { title: 'Keranjang & Checkout', content: 'Cart, multiple payment (VA, QRIS), ongkir' },
        ],
        ['Response time < 2 detik', 'Uptime 99.5%'],
        60,
        1,
        ['Timeline ketat', 'Integrasi payment gateway'],
      ),
      makeBrd(
        p2Id,
        'approved',
        2000000,
        1,
        'Aplikasi mobile booking lapangan futsal online.',
        ['Digitalisasi booking lapangan futsal'],
        'Mobile app cross-platform dengan real-time booking dan payment.',
        [{ title: 'Booking Real-time', content: 'Slot management, conflict prevention' }],
        ['Response time < 1 detik'],
        45,
        2,
        ['Sinkronisasi real-time'],
      ),
      makeBrd(
        p4Id,
        'paid',
        1500000,
        1,
        'Redesign UI/UX aplikasi booking travel.',
        ['Meningkatkan conversion rate 40%'],
        'Redesign total UI/UX dengan user research dan prototyping.',
        [
          { title: 'User Research', content: 'Interview, survey, usability test' },
          { title: 'Visual Design', content: 'Design system, mockup semua halaman' },
        ],
        ['WCAG 2.1 AA compliance'],
        21,
        1,
        ['Waktu user research terbatas'],
      ),
      makeBrd(
        p5Id,
        'approved',
        1500000,
        1,
        'Dashboard analytics untuk monitoring performa bisnis.',
        ['Mengurangi waktu pembuatan laporan 80%'],
        'Web dashboard dengan visualisasi data interaktif.',
        [{ title: 'Data Visualization', content: 'Charts interaktif, heatmaps' }],
        ['Load time < 3 detik'],
        30,
        1,
        ['Kompleksitas integrasi data'],
      ),
      makeBrd(
        p6Id,
        'approved',
        2000000,
        1,
        'Sistem manajemen inventori gudang berbasis web.',
        ['Mengurangi shrinkage ke 1%'],
        'Web app untuk manajemen stok, purchase order, dan reporting.',
        [
          { title: 'Barcode Scanning', content: 'Scan via camera atau scanner USB' },
          { title: 'Stock Management', content: 'Stok real-time, alert minimum' },
        ],
        ['Offline-capable'],
        45,
        1,
        ['Kompatibilitas hardware barcode'],
      ),
      makeBrd(
        p7Id,
        'review',
        1500000,
        1,
        'Toko online untuk batik modern.',
        ['Menjangkau pasar anak muda'],
        'E-commerce dengan fitur try-on virtual.',
        [{ title: 'Product Catalog', content: 'Koleksi batik, filter, search' }],
        ['Page load < 2 detik'],
        45,
        1,
        ['AR integration complexity'],
      ),
      makeBrd(
        p8Id,
        'approved',
        3000000,
        1,
        'Dashboard monitoring data kesehatan pasien.',
        ['Deteksi anomali kesehatan 5x lebih cepat'],
        'Dashboard real-time dengan data wearable dan alert system.',
        [
          { title: 'Real-time Dashboard', content: 'Heart rate, BP, SpO2' },
          { title: 'Alert System', content: 'Threshold-based alerts' },
        ],
        ['Data latency < 5 detik'],
        60,
        2,
        ['Wearable device integration'],
      ),
      makeBrd(
        p9Id,
        'approved',
        2500000,
        1,
        'Learning Management System untuk kursus online.',
        ['Menjangkau 50.000 siswa'],
        'Platform LMS dengan video streaming, quiz, dan sertifikat.',
        [
          { title: 'Video Course', content: 'Upload, streaming, progress tracking' },
          { title: 'Quiz System', content: 'Multiple choice, auto-grading' },
        ],
        ['Video load time < 3 detik'],
        60,
        1,
        ['Video hosting cost'],
      ),
      makeBrd(
        p10Id,
        'approved',
        3000000,
        1,
        'Platform manajemen proyek untuk tim internal.',
        ['Meningkatkan produktivitas tim 30%'],
        'Web app dengan Kanban, Gantt chart, dan time tracking.',
        [
          { title: 'Kanban Board', content: 'Drag-and-drop, custom columns' },
          { title: 'Time Tracking', content: 'Timer, manual entry' },
        ],
        ['Response time < 500ms'],
        75,
        2,
        ['Complexity real-time features'],
      ),
      makeBrd(
        p11Id,
        'approved',
        2500000,
        1,
        'Sistem tracking armada logistik real-time.',
        ['Meningkatkan efisiensi delivery 25%'],
        'Web app dengan GPS tracking dan route optimization.',
        [{ title: 'GPS Tracking', content: 'Real-time position, history playback' }],
        ['GPS accuracy < 10 meter'],
        60,
        1,
        ['GPS signal in remote areas'],
      ),
      makeBrd(
        p12Id,
        'approved',
        1500000,
        1,
        'Sistem reservasi online untuk chain restoran.',
        ['Meningkatkan table utilization 20%'],
        'Web app reservasi dengan table management.',
        [{ title: 'Online Booking', content: 'Date picker, party size' }],
        ['99.9% booking accuracy'],
        30,
        1,
        ['POS integration'],
      ),
      makeBrd(
        p13Id,
        'paid',
        1000000,
        1,
        'Aplikasi kasir POS untuk UMKM.',
        ['Digitalisasi transaksi UMKM'],
        'Aplikasi mobile kasir dengan laporan dan struk digital.',
        [{ title: 'Pencatatan Penjualan', content: 'Quick sale, barcode scan' }],
        ['Offline-first'],
        30,
        1,
        ['Variasi perangkat Android'],
      ),
      makeBrd(
        p16Id,
        'paid',
        800000,
        1,
        'Website company profile Gudang Cerdas.',
        ['Meningkatkan brand awareness'],
        'Landing page dan company profile.',
        [{ title: 'Company Profile', content: 'About, services, contact' }],
        ['Mobile responsive'],
        14,
        1,
        ['Minimal risk'],
      ),
      makeBrd(
        p17Id,
        'approved',
        2000000,
        1,
        'Marketplace khusus produk handmade Indonesia.',
        ['Menjangkau 5.000 pengrajin'],
        'Marketplace dengan storefront dan custom order.',
        [{ title: 'Storefront Builder', content: 'Custom branding per seller' }],
        ['Page load < 2 detik'],
        60,
        2,
        ['Logistics for fragile items'],
      ),
      makeBrd(
        p18Id,
        'paid',
        1500000,
        1,
        'Aplikasi gamifikasi belajar bahasa daerah.',
        ['Melestarikan 10 bahasa daerah'],
        'Mobile app dengan quiz, flashcard, dan leaderboard.',
        [{ title: 'Quiz Engine', content: 'Adaptive difficulty' }],
        ['Offline playable'],
        45,
        1,
        ['Content creation'],
      ),
      makeBrd(
        p19Id,
        'approved',
        1500000,
        1,
        'Platform ujian online dengan proctoring.',
        ['Digitalisasi ujian'],
        'Web platform ujian dengan timer dan auto-grading.',
        [{ title: 'Exam Builder', content: 'Question bank, random selection' }],
        ['Support 500 concurrent exams'],
        40,
        1,
        ['Browser compatibility'],
      ),
      makeBrd(
        p20Id,
        'approved',
        3500000,
        1,
        'SaaS manajemen properti sewaan.',
        ['Kelola 1.000 unit properti'],
        'Platform SaaS dengan tenant management.',
        [
          { title: 'Tenant Management', content: 'Lease tracking, communication portal' },
          { title: 'Rent Collection', content: 'Auto-invoicing, payment tracking' },
        ],
        ['99.9% uptime'],
        75,
        3,
        ['Multi-tenant data isolation'],
      ),
      makeBrd(
        p21Id,
        'approved',
        1500000,
        1,
        'Aplikasi loyalty program restoran.',
        ['Meningkatkan repeat customer 40%'],
        'Mobile app dengan point system dan push notifications.',
        [{ title: 'Point System', content: 'Earn and redeem points' }],
        ['Notification delivery < 5 detik'],
        40,
        1,
        ['POS integration'],
      ),
      makeBrd(
        p22Id,
        'approved',
        2500000,
        3,
        'Website listing properti dengan virtual tour.',
        ['Menjadi portal properti no.1 di kota tier-2'],
        'Website properti dengan search dan virtual tour.',
        [
          { title: 'Property Search', content: 'Advanced filter, map view' },
          { title: 'Virtual Tour', content: '360-degree photos' },
        ],
        ['Search response < 500ms'],
        60,
        1,
        ['360 photo processing'],
      ),
      makeBrd(
        p23Id,
        'approved',
        2500000,
        1,
        'Dashboard analytics fleet management.',
        ['Reduce operational cost 20%'],
        'Dashboard real-time dengan fuel analysis.',
        [
          { title: 'Fleet Dashboard', content: 'Vehicle status, location' },
          { title: 'Analytics', content: 'Fuel trends, cost predictions' },
        ],
        ['Real-time refresh < 10 detik'],
        60,
        2,
        ['IoT device integration'],
      ),
      makeBrd(
        p24Id,
        'approved',
        800000,
        1,
        'Aplikasi pencatatan hasil panen petani.',
        ['Digitalisasi pencatatan 1.000 petani'],
        'Aplikasi mobile sederhana untuk pencatatan harian.',
        [{ title: 'Input Harian', content: 'Jenis tanaman, jumlah' }],
        ['Offline-first'],
        25,
        1,
        ['Low literacy users'],
      ),
      makeBrd(
        p25Id,
        'paid',
        1500000,
        1,
        'Website klinik kesehatan dengan appointment system.',
        ['Meningkatkan booking online 60%'],
        'Website company profile dan booking dokter online.',
        [
          { title: 'Profil Dokter', content: 'Specialization, schedule' },
          { title: 'Online Booking', content: 'Doctor selection, time slot' },
        ],
        ['Mobile responsive'],
        30,
        1,
        ['Doctor schedule sync'],
      ),
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 9. PRD DOCUMENTS
  // =====================================================================
  console.log('  Seeding PRD documents...')
  const makePrd = (
    pid: string,
    status: 'draft' | 'review' | 'approved' | 'paid',
    price: number,
    techStack: Record<string, string>,
    teamSize: number,
    wpSummary: { title: string; skills: string[]; hours: number; amount: number }[],
  ) => ({
    id: uuidv7(),
    projectId: pid,
    version: 1,
    status,
    price,
    content: {
      techStack,
      teamComposition: {
        teamSize,
        workPackages: wpSummary.map((w) => ({
          title: w.title,
          requiredSkills: w.skills,
          estimatedHours: w.hours,
          amount: w.amount,
        })),
      },
      milestones: wpSummary.map((w) => `${w.title} milestones`),
      architecture: 'Microservice architecture with API Gateway',
    },
  })
  await db
    .insert(prdDocuments)
    .values([
      makePrd(
        p1Id,
        'paid',
        4500000,
        {
          frontend: 'React + TypeScript + Tailwind CSS',
          backend: 'Hono + Node.js',
          database: 'PostgreSQL',
        },
        1,
        [
          {
            title: 'Fullstack Development',
            skills: ['React', 'Node.js', 'PostgreSQL'],
            hours: 200,
            amount: 36000000,
          },
        ],
      ),
      makePrd(
        p2Id,
        'approved',
        3000000,
        { mobile: 'React Native', backend: 'Node.js', database: 'PostgreSQL' },
        2,
        [
          { title: 'Mobile Development', skills: ['React Native'], hours: 140, amount: 14000000 },
          { title: 'Backend API', skills: ['Node.js', 'PostgreSQL'], hours: 100, amount: 8500000 },
        ],
      ),
      makePrd(p4Id, 'paid', 2000000, { design: 'Figma', tools: 'UserTesting, Hotjar' }, 1, [
        {
          title: 'UI/UX Redesign',
          skills: ['Figma', 'UI Design', 'UX Design'],
          hours: 80,
          amount: 11250000,
        },
      ]),
      makePrd(
        p6Id,
        'approved',
        3000000,
        { frontend: 'React', backend: 'Node.js', database: 'PostgreSQL' },
        1,
        [
          {
            title: 'Fullstack Development',
            skills: ['React', 'Node.js', 'PostgreSQL'],
            hours: 180,
            amount: 28000000,
          },
        ],
      ),
      makePrd(
        p8Id,
        'approved',
        5000000,
        { frontend: 'React', backend: 'Python + FastAPI', ml: 'TensorFlow' },
        2,
        [
          {
            title: 'Frontend Dashboard',
            skills: ['React', 'TypeScript'],
            hours: 120,
            amount: 20000000,
          },
          {
            title: 'Backend & ML Pipeline',
            skills: ['Python', 'FastAPI', 'Machine Learning'],
            hours: 160,
            amount: 26750000,
          },
        ],
      ),
      makePrd(
        p9Id,
        'approved',
        4000000,
        { frontend: 'React', backend: 'Node.js', database: 'PostgreSQL' },
        1,
        [
          {
            title: 'Fullstack Development',
            skills: ['React', 'Node.js', 'PostgreSQL'],
            hours: 240,
            amount: 33600000,
          },
        ],
      ),
      makePrd(
        p10Id,
        'approved',
        6000000,
        {
          frontend: 'React + TypeScript',
          backend: 'Hono + Node.js',
          database: 'PostgreSQL',
          devops: 'Docker',
        },
        2,
        [
          {
            title: 'Fullstack Web Development',
            skills: ['React', 'Node.js', 'PostgreSQL'],
            hours: 200,
            amount: 35000000,
          },
          {
            title: 'DevOps & Infrastructure',
            skills: ['Docker', 'AWS', 'CI/CD'],
            hours: 100,
            amount: 18000000,
          },
        ],
      ),
      makePrd(
        p11Id,
        'approved',
        4000000,
        { frontend: 'React', backend: 'Go', database: 'PostgreSQL' },
        1,
        [
          {
            title: 'Fullstack Development',
            skills: ['React', 'Go', 'PostgreSQL'],
            hours: 200,
            amount: 38400000,
          },
        ],
      ),
      makePrd(p13Id, 'paid', 1500000, { mobile: 'Flutter', backend: 'Firebase' }, 1, [
        { title: 'Mobile App Development', skills: ['Flutter'], hours: 120, amount: 9000000 },
      ]),
      makePrd(
        p17Id,
        'review',
        4000000,
        { frontend: 'React + Tailwind', backend: 'Node.js', database: 'PostgreSQL' },
        2,
        [
          {
            title: 'Backend & Database',
            skills: ['Node.js', 'PostgreSQL'],
            hours: 160,
            amount: 20000000,
          },
          {
            title: 'Frontend & UI',
            skills: ['React', 'Tailwind CSS'],
            hours: 120,
            amount: 14000000,
          },
        ],
      ),
      makePrd(p18Id, 'paid', 2500000, { mobile: 'Flutter', backend: 'Firebase' }, 1, [
        { title: 'Mobile App Development', skills: ['Flutter'], hours: 160, amount: 16500000 },
      ]),
      makePrd(
        p19Id,
        'approved',
        2000000,
        { frontend: 'React', backend: 'Node.js', database: 'PostgreSQL' },
        1,
        [
          {
            title: 'Fullstack Development',
            skills: ['React', 'Node.js', 'PostgreSQL'],
            hours: 140,
            amount: 15000000,
          },
        ],
      ),
      makePrd(
        p20Id,
        'approved',
        6000000,
        { frontend: 'React + Tailwind', backend: 'Node.js + Hono', database: 'PostgreSQL' },
        3,
        [
          { title: 'Backend API', skills: ['Node.js', 'PostgreSQL'], hours: 180, amount: 22000000 },
          {
            title: 'Frontend Web',
            skills: ['React', 'TypeScript', 'Tailwind CSS'],
            hours: 150,
            amount: 18000000,
          },
          { title: 'UI/UX Design', skills: ['Figma', 'UI Design'], hours: 80, amount: 15250000 },
        ],
      ),
      makePrd(p21Id, 'approved', 2000000, { mobile: 'Flutter', backend: 'Firebase' }, 1, [
        { title: 'Mobile App Development', skills: ['Flutter'], hours: 140, amount: 15000000 },
      ]),
      makePrd(
        p22Id,
        'approved',
        4500000,
        { frontend: 'React + Next.js', backend: 'Node.js', database: 'PostgreSQL' },
        1,
        [
          {
            title: 'Fullstack Development',
            skills: ['React', 'Next.js', 'Node.js', 'PostgreSQL'],
            hours: 240,
            amount: 36000000,
          },
        ],
      ),
      makePrd(
        p23Id,
        'approved',
        4000000,
        { frontend: 'React', backend: 'Python + FastAPI', database: 'PostgreSQL' },
        2,
        [
          {
            title: 'Frontend Dashboard',
            skills: ['React', 'TypeScript'],
            hours: 120,
            amount: 16000000,
          },
          {
            title: 'Data Pipeline & Backend',
            skills: ['Python', 'PostgreSQL'],
            hours: 140,
            amount: 20000000,
          },
        ],
      ),
      makePrd(p24Id, 'approved', 1200000, { mobile: 'Flutter', backend: 'Firebase' }, 1, [
        { title: 'Mobile App Development', skills: ['Flutter'], hours: 80, amount: 7000000 },
      ]),
      makePrd(p25Id, 'paid', 2000000, { frontend: 'React + Tailwind', backend: 'Node.js' }, 1, [
        { title: 'Web Development', skills: ['React', 'Node.js'], hours: 100, amount: 11250000 },
      ]),
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 10. WORK PACKAGES
  // =====================================================================
  console.log('  Seeding work packages...')
  await db
    .insert(workPackages)
    .values([
      // p1 completed (solo)
      {
        id: wp1Id,
        projectId: p1Id,
        title: 'Fullstack Development',
        description: 'Full e-commerce platform development',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 200,
        amount: 36000000,
        talentPayout: 36000000,
        status: 'completed' as const,
      },
      // p2 in_progress (team=2)
      {
        id: wp2Id,
        projectId: p2Id,
        title: 'Mobile Development',
        description: 'React Native cross-platform app, location services',
        orderIndex: 0,
        requiredSkills: ['React Native'],
        estimatedHours: 140,
        amount: 14000000,
        talentPayout: 11200000,
        status: 'in_progress' as const,
      },
      {
        id: wp3Id,
        projectId: p2Id,
        title: 'Backend API',
        description: 'Booking engine, payment integration',
        orderIndex: 1,
        requiredSkills: ['Node.js', 'PostgreSQL'],
        estimatedHours: 100,
        amount: 8500000,
        talentPayout: 6800000,
        status: 'in_progress' as const,
      },
      // p4 completed (solo)
      {
        id: wp4Id,
        projectId: p4Id,
        title: 'UI/UX Redesign',
        description: 'User research, wireframing, visual design, prototype',
        orderIndex: 0,
        requiredSkills: ['Figma', 'UI Design', 'UX Design'],
        estimatedHours: 80,
        amount: 11250000,
        talentPayout: 11250000,
        status: 'completed' as const,
      },
      // p6 matching (solo)
      {
        id: wp5Id,
        projectId: p6Id,
        title: 'Fullstack Development',
        description: 'Inventory management system',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 180,
        amount: 28000000,
        talentPayout: 28000000,
        status: 'unassigned' as const,
      },
      // p9 disputed (solo)
      {
        id: wp6Id,
        projectId: p9Id,
        title: 'Fullstack Development',
        description: 'LMS platform with video, quiz, certificates',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 240,
        amount: 33600000,
        talentPayout: 33600000,
        status: 'in_progress' as const,
      },
      // p10 in_progress (team=2)
      {
        id: wp7Id,
        projectId: p10Id,
        title: 'Fullstack Web Development',
        description: 'Backend API, frontend React, real-time features',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 200,
        amount: 35000000,
        talentPayout: 29750000,
        status: 'in_progress' as const,
      },
      {
        id: wp8Id,
        projectId: p10Id,
        title: 'DevOps & Infrastructure',
        description: 'Docker setup, CI/CD pipeline, monitoring',
        orderIndex: 1,
        requiredSkills: ['Docker', 'AWS', 'CI/CD'],
        estimatedHours: 100,
        amount: 18000000,
        talentPayout: 15300000,
        status: 'in_progress' as const,
      },
      // p11 on_hold (solo)
      {
        id: wp9Id,
        projectId: p11Id,
        title: 'Fullstack Development',
        description: 'Fleet tracking with GPS, route optimization',
        orderIndex: 0,
        requiredSkills: ['React', 'Go', 'PostgreSQL'],
        estimatedHours: 200,
        amount: 38400000,
        talentPayout: 38400000,
        status: 'in_progress' as const,
      },
      // p13 completed (solo)
      {
        id: wp10Id,
        projectId: p13Id,
        title: 'Mobile App Development',
        description: 'Flutter POS app, offline sync, receipt generation',
        orderIndex: 0,
        requiredSkills: ['Flutter'],
        estimatedHours: 120,
        amount: 9000000,
        talentPayout: 9000000,
        status: 'completed' as const,
      },
      // p19 matching (solo)
      {
        id: wp11Id,
        projectId: p19Id,
        title: 'Fullstack Development',
        description: 'Exam platform, question bank, proctoring',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 140,
        amount: 15000000,
        talentPayout: 15000000,
        status: 'unassigned' as const,
      },
      // p20 team_forming (team=3)
      {
        id: wp12Id,
        projectId: p20Id,
        title: 'Backend API',
        description: 'REST API, multi-tenant database, payment',
        orderIndex: 0,
        requiredSkills: ['Node.js', 'PostgreSQL'],
        estimatedHours: 180,
        amount: 22000000,
        talentPayout: 18700000,
        status: 'pending_acceptance' as const,
      },
      {
        id: wp13Id,
        projectId: p20Id,
        title: 'Frontend Web',
        description: 'React dashboard, tenant portal',
        orderIndex: 1,
        requiredSkills: ['React', 'TypeScript', 'Tailwind CSS'],
        estimatedHours: 150,
        amount: 18000000,
        talentPayout: 15300000,
        status: 'unassigned' as const,
      },
      {
        id: wp14Id,
        projectId: p20Id,
        title: 'UI/UX Design',
        description: 'Design system, wireframes, prototyping',
        orderIndex: 2,
        requiredSkills: ['Figma', 'UI Design'],
        estimatedHours: 80,
        amount: 15250000,
        talentPayout: 12962500,
        status: 'unassigned' as const,
      },
      // p21 matched (solo)
      {
        id: wp15Id,
        projectId: p21Id,
        title: 'Mobile App Development',
        description: 'Flutter loyalty app, QR scan, push notifications',
        orderIndex: 0,
        requiredSkills: ['Flutter'],
        estimatedHours: 140,
        amount: 15000000,
        talentPayout: 15000000,
        status: 'assigned' as const,
      },
      // p22 in_progress (solo)
      {
        id: wp16Id,
        projectId: p22Id,
        title: 'Fullstack Development',
        description: 'Property portal with search, virtual tour',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js', 'PostgreSQL'],
        estimatedHours: 240,
        amount: 36000000,
        talentPayout: 36000000,
        status: 'in_progress' as const,
      },
      // p23 partially_active (team=2)
      {
        id: wp17Id,
        projectId: p23Id,
        title: 'Frontend Dashboard',
        description: 'React dashboard, charts, real-time data',
        orderIndex: 0,
        requiredSkills: ['React', 'TypeScript'],
        estimatedHours: 120,
        amount: 16000000,
        talentPayout: 12800000,
        status: 'in_progress' as const,
      },
      {
        id: wp18Id,
        projectId: p23Id,
        title: 'Data Pipeline & Backend',
        description: 'Python data processing, FastAPI endpoints',
        orderIndex: 1,
        requiredSkills: ['Python', 'PostgreSQL'],
        estimatedHours: 140,
        amount: 20000000,
        talentPayout: 16000000,
        status: 'terminated' as const,
      },
      // p24 review (solo)
      {
        id: wp19Id,
        projectId: p24Id,
        title: 'Mobile App Development',
        description: 'Flutter app for harvest recording',
        orderIndex: 0,
        requiredSkills: ['Flutter'],
        estimatedHours: 80,
        amount: 7000000,
        talentPayout: 7000000,
        status: 'completed' as const,
      },
      // p25 completed (solo)
      {
        id: wp20Id,
        projectId: p25Id,
        title: 'Web Development',
        description: 'Clinic website, appointment system',
        orderIndex: 0,
        requiredSkills: ['React', 'Node.js'],
        estimatedHours: 100,
        amount: 11250000,
        talentPayout: 11250000,
        status: 'completed' as const,
      },
      // p8 prd_approved (team=2, not yet matched)
      {
        id: wp21Id,
        projectId: p8Id,
        title: 'Frontend Dashboard',
        description: 'Real-time health monitoring dashboard',
        orderIndex: 0,
        requiredSkills: ['React', 'TypeScript'],
        estimatedHours: 120,
        amount: 20000000,
        talentPayout: 17000000,
        status: 'unassigned' as const,
      },
      {
        id: wp22Id,
        projectId: p8Id,
        title: 'Backend & ML Pipeline',
        description: 'FastAPI endpoints, ML model, alert engine',
        orderIndex: 1,
        requiredSkills: ['Python', 'FastAPI', 'Machine Learning'],
        estimatedHours: 160,
        amount: 26750000,
        talentPayout: 22737500,
        status: 'unassigned' as const,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 11. WORK PACKAGE DEPENDENCIES
  // =====================================================================
  console.log('  Seeding work package dependencies...')
  await db
    .insert(workPackageDependencies)
    .values([
      {
        id: uuidv7(),
        workPackageId: wp3Id,
        dependsOnWorkPackageId: wp2Id,
        type: 'start_to_start' as const,
      },
      {
        id: uuidv7(),
        workPackageId: wp13Id,
        dependsOnWorkPackageId: wp14Id,
        type: 'finish_to_start' as const,
      },
      {
        id: uuidv7(),
        workPackageId: wp17Id,
        dependsOnWorkPackageId: wp18Id,
        type: 'start_to_start' as const,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 12. PROJECT ASSIGNMENTS
  // =====================================================================
  console.log('  Seeding assignments...')
  await db
    .insert(projectAssignments)
    .values([
      // p1 completed - talent1 (Budi, senior fullstack)
      {
        id: asgn1Id,
        projectId: p1Id,
        talentId: tp1Id,
        workPackageId: wp1Id,
        roleLabel: 'Fullstack Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2025-10-01'),
        completedAt: new Date('2025-11-28'),
      },
      // p2 in_progress (team=2) - talent2 (Dewi, designer doing mobile design?), talent5 (Gunawan, backend)
      {
        id: asgn2Id,
        projectId: p2Id,
        talentId: tp2Id,
        workPackageId: wp2Id,
        roleLabel: 'Mobile UI Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      {
        id: asgn3Id,
        projectId: p2Id,
        talentId: tp5Id,
        workPackageId: wp3Id,
        roleLabel: 'Backend Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      // p4 completed - talent2 (Dewi, designer)
      {
        id: asgn4Id,
        projectId: p4Id,
        talentId: tp2Id,
        workPackageId: wp4Id,
        roleLabel: 'UI/UX Designer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2025-12-01'),
        completedAt: new Date('2025-12-21'),
      },
      // p9 disputed - talent6 (Hana, suspended)
      {
        id: asgn5Id,
        projectId: p9Id,
        talentId: tp6Id,
        workPackageId: wp6Id,
        roleLabel: 'Fullstack Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-01-15'),
      },
      // p10 in_progress (team=2) - talent1 (Budi), talent7 (Irfan)
      {
        id: asgn6Id,
        projectId: p10Id,
        talentId: tp1Id,
        workPackageId: wp7Id,
        roleLabel: 'Fullstack Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      {
        id: asgn7Id,
        projectId: p10Id,
        talentId: tp7Id,
        workPackageId: wp8Id,
        roleLabel: 'DevOps Engineer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      // p11 on_hold - talent5 (Gunawan)
      {
        id: asgn8Id,
        projectId: p11Id,
        talentId: tp5Id,
        workPackageId: wp9Id,
        roleLabel: 'Fullstack Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-02-15'),
      },
      // p13 completed - talent8 (Joko, mobile Flutter)
      {
        id: asgn9Id,
        projectId: p13Id,
        talentId: tp8Id,
        workPackageId: wp10Id,
        roleLabel: 'Mobile Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2025-11-01'),
        completedAt: new Date('2025-11-28'),
      },
      // p20 team_forming - talent7 (Irfan) accepted for backend
      {
        id: asgn10Id,
        projectId: p20Id,
        talentId: tp7Id,
        workPackageId: wp12Id,
        roleLabel: 'Backend Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-20'),
      },
      // p21 matched - talent8 (Joko)
      {
        id: asgn11Id,
        projectId: p21Id,
        talentId: tp8Id,
        workPackageId: wp15Id,
        roleLabel: 'Mobile Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-22'),
      },
      // p22 in_progress - talent7 (Irfan)
      {
        id: asgn12Id,
        projectId: p22Id,
        talentId: tp7Id,
        workPackageId: wp16Id,
        roleLabel: 'Fullstack Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-05'),
      },
      // p23 partially_active (team=2) - talent1 (Budi) active, talent6 (Hana) terminated
      {
        id: asgn13Id,
        projectId: p23Id,
        talentId: tp1Id,
        workPackageId: wp17Id,
        roleLabel: 'Frontend Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'active' as const,
        startedAt: new Date('2026-03-01'),
      },
      {
        id: asgn14Id,
        projectId: p23Id,
        talentId: tp6Id,
        workPackageId: wp18Id,
        roleLabel: 'Data Engineer',
        acceptanceStatus: 'accepted' as const,
        status: 'terminated' as const,
        startedAt: new Date('2026-03-01'),
      },
      // p24 review - talent3 (Eko, junior)
      {
        id: asgn15Id,
        projectId: p24Id,
        talentId: tp3Id,
        workPackageId: wp19Id,
        roleLabel: 'Mobile Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2026-02-15'),
        completedAt: new Date('2026-03-10'),
      },
      // p25 completed - talent1 (Budi)
      {
        id: asgn16Id,
        projectId: p25Id,
        talentId: tp1Id,
        workPackageId: wp20Id,
        roleLabel: 'Web Developer',
        acceptanceStatus: 'accepted' as const,
        status: 'completed' as const,
        startedAt: new Date('2026-01-10'),
        completedAt: new Date('2026-02-05'),
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 13. CONTRACTS
  // =====================================================================
  console.log('  Seeding contracts...')
  const makeContract = (
    pid: string,
    aid: string,
    type: 'standard_nda' | 'ip_transfer',
    ownerName: string,
    talentName: string,
    scope: string,
    signed: boolean,
    signedAt?: Date,
  ) => ({
    id: uuidv7(),
    projectId: pid,
    assignmentId: aid,
    type,
    signedByOwner: signed,
    signedByTalent: signed,
    signedAt: signedAt ?? null,
    content: {
      parties: { owner: ownerName, talent: talentName },
      scope,
      confidentiality:
        'Semua informasi proyek bersifat rahasia selama 2 tahun setelah proyek selesai',
      ipTransfer: 'Semua hasil kerja menjadi milik owner setelah pembayaran selesai',
    },
  })
  const contractData = [
    makeContract(
      p1Id,
      asgn1Id,
      'standard_nda',
      'Ahmad Fadillah',
      'Budi Setiawan',
      'Fullstack Dev - KopiNusantara',
      true,
      new Date('2025-09-30'),
    ),
    makeContract(
      p1Id,
      asgn1Id,
      'ip_transfer',
      'Ahmad Fadillah',
      'Budi Setiawan',
      'IP Transfer - KopiNusantara',
      true,
      new Date('2025-09-30'),
    ),
    makeContract(
      p2Id,
      asgn2Id,
      'standard_nda',
      'Ahmad Fadillah',
      'Dewi Lestari',
      'Mobile Dev - Booking Futsal',
      true,
      new Date('2026-02-28'),
    ),
    makeContract(
      p2Id,
      asgn3Id,
      'standard_nda',
      'Ahmad Fadillah',
      'Gunawan Wibowo',
      'Backend API - Booking Futsal',
      true,
      new Date('2026-02-28'),
    ),
    makeContract(
      p4Id,
      asgn4Id,
      'standard_nda',
      'Siti Nurhaliza',
      'Dewi Lestari',
      'UI/UX Redesign - Travel App',
      true,
      new Date('2025-11-29'),
    ),
    makeContract(
      p9Id,
      asgn5Id,
      'standard_nda',
      'Lina Wijaya',
      'Hana Permata',
      'LMS Development',
      true,
      new Date('2026-01-14'),
    ),
    makeContract(
      p10Id,
      asgn6Id,
      'standard_nda',
      'Agus Santoso',
      'Budi Setiawan',
      'Fullstack Dev - Manajemen Proyek',
      true,
      new Date('2026-02-28'),
    ),
    makeContract(
      p10Id,
      asgn7Id,
      'standard_nda',
      'Agus Santoso',
      'Irfan Maulana',
      'DevOps - Manajemen Proyek',
      true,
      new Date('2026-02-28'),
    ),
    makeContract(
      p11Id,
      asgn8Id,
      'standard_nda',
      'Agus Santoso',
      'Gunawan Wibowo',
      'Fleet Tracking',
      true,
      new Date('2026-02-14'),
    ),
    makeContract(
      p13Id,
      asgn9Id,
      'standard_nda',
      'Hendri Gunawan',
      'Joko Susilo',
      'Mobile App - Kasir UMKM',
      true,
      new Date('2025-10-30'),
    ),
    makeContract(
      p22Id,
      asgn12Id,
      'standard_nda',
      'Hendri Gunawan',
      'Irfan Maulana',
      'Portal Listing Properti',
      true,
      new Date('2026-03-04'),
    ),
    makeContract(
      p23Id,
      asgn13Id,
      'standard_nda',
      'Siti Nurhaliza',
      'Budi Setiawan',
      'Frontend - Fleet Analytics',
      true,
      new Date('2026-02-28'),
    ),
    makeContract(
      p24Id,
      asgn15Id,
      'standard_nda',
      'Rahmat Hidayat',
      'Eko Prasetyo',
      'Mobile App - Pencatatan Panen',
      true,
      new Date('2026-02-14'),
    ),
    makeContract(
      p25Id,
      asgn16Id,
      'standard_nda',
      'Farhan Pratama',
      'Budi Setiawan',
      'Web Dev - Klinik Kesehatan',
      true,
      new Date('2026-01-09'),
    ),
  ]
  for (const c of contractData) {
    await db.insert(contracts).values(c).onConflictDoNothing()
  }

  // =====================================================================
  // 14. MILESTONES
  // =====================================================================
  console.log('  Seeding milestones...')
  await db
    .insert(milestones)
    .values([
      // p1 completed (Budi/tp1)
      {
        id: ms1Id,
        projectId: p1Id,
        workPackageId: wp1Id,
        assignedTalentId: tp1Id,
        title: 'Database Schema & API Foundation',
        description: 'Design database, setup API, auth endpoints',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 12000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2025-10-15'),
        submittedAt: new Date('2025-10-14'),
        completedAt: new Date('2025-10-15'),
      },
      {
        id: ms2Id,
        projectId: p1Id,
        workPackageId: wp1Id,
        assignedTalentId: tp1Id,
        title: 'Frontend & Payment Integration',
        description: 'Product catalog, cart, Midtrans integration',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 12000000,
        status: 'approved' as const,
        revisionCount: 1,
        dueDate: new Date('2025-11-05'),
        submittedAt: new Date('2025-11-04'),
        completedAt: new Date('2025-11-05'),
      },
      {
        id: ms3Id,
        projectId: p1Id,
        workPackageId: wp1Id,
        assignedTalentId: tp1Id,
        title: 'Dashboard & Final Testing',
        description: 'Seller dashboard, analytics, E2E testing',
        milestoneType: 'individual' as const,
        orderIndex: 2,
        amount: 12000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2025-11-25'),
        submittedAt: new Date('2025-11-24'),
        completedAt: new Date('2025-11-25'),
      },
      // p2 in_progress (team=2) - Dewi/tp2 mobile, Gunawan/tp5 backend
      {
        id: ms4Id,
        projectId: p2Id,
        workPackageId: wp2Id,
        assignedTalentId: tp2Id,
        title: 'Mobile UI Foundations',
        description: 'Navigation, map integration, booking UI shells',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 7000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-15'),
        submittedAt: new Date('2026-03-14'),
        completedAt: new Date('2026-03-15'),
      },
      {
        id: ms5Id,
        projectId: p2Id,
        workPackageId: wp2Id,
        assignedTalentId: tp2Id,
        title: 'Booking Flow & Payment UI',
        description: 'Real-time slot selection, payment screens',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 7000000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-01'),
      },
      {
        id: ms6Id,
        projectId: p2Id,
        workPackageId: wp3Id,
        assignedTalentId: tp5Id,
        title: 'Backend API & Booking Engine',
        description: 'REST API, booking logic, conflict prevention',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 4500000,
        status: 'submitted' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-20'),
        submittedAt: new Date('2026-03-19'),
      },
      {
        id: ms7Id,
        projectId: p2Id,
        workPackageId: wp3Id,
        assignedTalentId: tp5Id,
        title: 'Payment & Notification API',
        description: 'Midtrans integration, push notifications',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 4000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-05'),
      },
      // p4 completed (Dewi/tp2)
      {
        id: ms8Id,
        projectId: p4Id,
        workPackageId: wp4Id,
        assignedTalentId: tp2Id,
        title: 'Complete Redesign Package',
        description: 'User research, wireframes, hi-fi mockups, prototype',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 11250000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2025-12-20'),
        submittedAt: new Date('2025-12-18'),
        completedAt: new Date('2025-12-20'),
      },
      // p9 disputed (Hana/tp6)
      {
        id: ms9Id,
        projectId: p9Id,
        workPackageId: wp6Id,
        assignedTalentId: tp6Id,
        title: 'LMS Core Features',
        description: 'Video upload, course management, basic quiz',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 16800000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-02-15'),
        submittedAt: new Date('2026-02-14'),
        completedAt: new Date('2026-02-15'),
      },
      {
        id: ms10Id,
        projectId: p9Id,
        workPackageId: wp6Id,
        assignedTalentId: tp6Id,
        title: 'Advanced Quiz & Certificates',
        description: 'Auto-grading, certificate generation, analytics',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 16800000,
        status: 'submitted' as const,
        revisionCount: 2,
        dueDate: new Date('2026-03-10'),
        submittedAt: new Date('2026-03-10'),
      },
      // p10 in_progress (team=2) - Budi/tp1 fullstack, Irfan/tp7 devops
      {
        id: ms11Id,
        projectId: p10Id,
        workPackageId: wp7Id,
        assignedTalentId: tp1Id,
        title: 'Core API & Kanban Board',
        description: 'Database schema, REST API, Kanban UI',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 15000000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-20'),
      },
      {
        id: ms12Id,
        projectId: p10Id,
        workPackageId: wp7Id,
        assignedTalentId: tp1Id,
        title: 'Gantt Chart & Time Tracking',
        description: 'Interactive Gantt, time tracking with timer',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 20000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-15'),
      },
      {
        id: ms13Id,
        projectId: p10Id,
        workPackageId: wp8Id,
        assignedTalentId: tp7Id,
        title: 'Docker & CI/CD Setup',
        description: 'Dockerize all services, GitHub Actions, staging',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 10000000,
        status: 'revision_requested' as const,
        revisionCount: 1,
        dueDate: new Date('2026-03-15'),
        submittedAt: new Date('2026-03-14'),
      },
      {
        id: ms14Id,
        projectId: p10Id,
        workPackageId: wp8Id,
        assignedTalentId: tp7Id,
        title: 'Monitoring & Production Deploy',
        description: 'OpenObserve setup, health checks, production deploy',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 8000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-10'),
      },
      // p11 on_hold (Gunawan/tp5)
      {
        id: ms15Id,
        projectId: p11Id,
        workPackageId: wp9Id,
        assignedTalentId: tp5Id,
        title: 'GPS Tracking Core',
        description: 'Real-time GPS, vehicle dashboard',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 20000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-10'),
        submittedAt: new Date('2026-03-09'),
        completedAt: new Date('2026-03-10'),
      },
      {
        id: ms16Id,
        projectId: p11Id,
        workPackageId: wp9Id,
        assignedTalentId: tp5Id,
        title: 'Route Optimization & Analytics',
        description: 'Route planning, delivery analytics',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 18400000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-01'),
      },
      // p13 completed (Joko/tp8)
      {
        id: ms17Id,
        projectId: p13Id,
        workPackageId: wp10Id,
        assignedTalentId: tp8Id,
        title: 'Complete POS App',
        description: 'Full POS app with offline mode',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 4500000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2025-11-15'),
        submittedAt: new Date('2025-11-14'),
        completedAt: new Date('2025-11-15'),
      },
      {
        id: ms18Id,
        projectId: p13Id,
        workPackageId: wp10Id,
        assignedTalentId: tp8Id,
        title: 'Reports & WhatsApp Integration',
        description: 'Daily reports, WhatsApp receipt sharing',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 4500000,
        status: 'approved' as const,
        revisionCount: 1,
        dueDate: new Date('2025-11-28'),
        submittedAt: new Date('2025-11-27'),
        completedAt: new Date('2025-11-28'),
      },
      // p22 in_progress (Irfan/tp7)
      {
        id: ms19Id,
        projectId: p22Id,
        workPackageId: wp16Id,
        assignedTalentId: tp7Id,
        title: 'Property Search & Listing',
        description: 'Advanced search, listing pages, map view',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 18000000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-25'),
      },
      {
        id: ms20Id,
        projectId: p22Id,
        workPackageId: wp16Id,
        assignedTalentId: tp7Id,
        title: 'Virtual Tour & KPR Calculator',
        description: '360 photos, mortgage calculator',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 18000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-15'),
      },
      // p23 partially_active - Budi/tp1 frontend active, Hana/tp6 terminated
      {
        id: ms21Id,
        projectId: p23Id,
        workPackageId: wp17Id,
        assignedTalentId: tp1Id,
        title: 'Dashboard UI & Charts',
        description: 'React dashboard, Chart.js integration',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 8000000,
        status: 'in_progress' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-20'),
      },
      {
        id: ms22Id,
        projectId: p23Id,
        workPackageId: wp17Id,
        assignedTalentId: tp1Id,
        title: 'Report Generation & Export',
        description: 'PDF reports, CSV export',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 8000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-05'),
      },
      // p24 review (Eko/tp3)
      {
        id: ms23Id,
        projectId: p24Id,
        workPackageId: wp19Id,
        assignedTalentId: tp3Id,
        title: 'Core Recording Features',
        description: 'Daily harvest input, crop management',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 4000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-01'),
        submittedAt: new Date('2026-02-28'),
        completedAt: new Date('2026-03-01'),
      },
      {
        id: ms24Id,
        projectId: p24Id,
        workPackageId: wp19Id,
        assignedTalentId: tp3Id,
        title: 'Reports & PDF Export',
        description: 'Weekly/monthly reports, PDF generation',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 3000000,
        status: 'submitted' as const,
        revisionCount: 0,
        dueDate: new Date('2026-03-10'),
        submittedAt: new Date('2026-03-10'),
      },
      // p25 completed (Budi/tp1)
      {
        id: ms25Id,
        projectId: p25Id,
        workPackageId: wp20Id,
        assignedTalentId: tp1Id,
        title: 'Company Profile & Doctor Pages',
        description: 'Homepage, about, doctor profiles',
        milestoneType: 'individual' as const,
        orderIndex: 0,
        amount: 6000000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-01-25'),
        submittedAt: new Date('2026-01-24'),
        completedAt: new Date('2026-01-25'),
      },
      {
        id: ms26Id,
        projectId: p25Id,
        workPackageId: wp20Id,
        assignedTalentId: tp1Id,
        title: 'Appointment System',
        description: 'Doctor schedule, time slot booking',
        milestoneType: 'individual' as const,
        orderIndex: 1,
        amount: 5250000,
        status: 'approved' as const,
        revisionCount: 0,
        dueDate: new Date('2026-02-05'),
        submittedAt: new Date('2026-02-04'),
        completedAt: new Date('2026-02-05'),
      },
      // p2 integration milestone
      {
        id: ms27Id,
        projectId: p2Id,
        workPackageId: null,
        assignedTalentId: null,
        title: 'Frontend-Backend Integration Testing',
        description: 'End-to-end integration testing',
        milestoneType: 'integration' as const,
        orderIndex: 3,
        amount: 5000000,
        status: 'pending' as const,
        revisionCount: 0,
        dueDate: new Date('2026-04-10'),
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 15. MILESTONE COMMENTS
  // =====================================================================
  console.log('  Seeding milestone comments...')
  await db
    .insert(milestoneComments)
    .values([
      {
        id: uuidv7(),
        milestoneId: ms1Id,
        userId: owner1Id,
        content: 'Database schema sangat rapi. Approved!',
      },
      {
        id: uuidv7(),
        milestoneId: ms2Id,
        userId: owner1Id,
        content: 'Payment integration works well, minor UI fix needed.',
      },
      {
        id: uuidv7(),
        milestoneId: ms2Id,
        userId: talent1Id,
        content: 'Sudah diperbaiki, silakan review lagi.',
      },
      {
        id: uuidv7(),
        milestoneId: ms4Id,
        userId: owner1Id,
        content: 'Mobile UI bagus, navigasi lancar.',
      },
      {
        id: uuidv7(),
        milestoneId: ms6Id,
        userId: owner1Id,
        content: 'API documentation sangat lengkap, menunggu testing.',
      },
      {
        id: uuidv7(),
        milestoneId: ms8Id,
        userId: owner2Id,
        content: 'Redesign luar biasa! User research findings sangat insightful.',
      },
      {
        id: uuidv7(),
        milestoneId: ms10Id,
        userId: owner6Id,
        content: 'Quiz auto-grading masih ada bug di essay scoring. Perlu perbaikan segera.',
      },
      {
        id: uuidv7(),
        milestoneId: ms10Id,
        userId: talent6Id,
        content: 'Saya sedang coba perbaiki scoring algorithm.',
      },
      {
        id: uuidv7(),
        milestoneId: ms13Id,
        userId: owner7Id,
        content: 'CI/CD pipeline gagal di step deployment. Tolong dicek Docker Compose.',
      },
      {
        id: uuidv7(),
        milestoneId: ms17Id,
        userId: owner9Id,
        content: 'POS app berjalan lancar, offline mode sangat membantu.',
      },
      {
        id: uuidv7(),
        milestoneId: ms25Id,
        userId: owner5Id,
        content: 'Halaman dokter informatif dan clean. Good job!',
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 16. REVISION REQUESTS
  // =====================================================================
  console.log('  Seeding revision requests...')
  await db
    .insert(revisionRequests)
    .values([
      {
        id: uuidv7(),
        milestoneId: ms2Id,
        requestedBy: owner1Id,
        description: 'Perbaiki UI payment confirmation screen, button terlalu kecil di mobile.',
        severity: 'minor' as const,
        isPaid: false,
        status: 'completed' as const,
        completedAt: new Date('2025-11-03'),
      },
      {
        id: uuidv7(),
        milestoneId: ms10Id,
        requestedBy: owner6Id,
        description: 'Essay grading algorithm salah menghitung score. Perlu fix urgently.',
        severity: 'moderate' as const,
        isPaid: false,
        status: 'pending' as const,
      },
      {
        id: uuidv7(),
        milestoneId: ms10Id,
        requestedBy: owner6Id,
        description: 'Certificate template layout broken untuk nama panjang.',
        severity: 'minor' as const,
        isPaid: false,
        status: 'pending' as const,
      },
      {
        id: uuidv7(),
        milestoneId: ms13Id,
        requestedBy: owner7Id,
        description: 'Docker Compose staging gagal karena port conflict dan missing env vars.',
        severity: 'moderate' as const,
        isPaid: false,
        status: 'in_progress' as const,
      },
      {
        id: uuidv7(),
        milestoneId: ms18Id,
        requestedBy: owner9Id,
        description: 'Laporan bulanan tidak akurat, perlu perbaikan query aggregation.',
        severity: 'minor' as const,
        isPaid: false,
        status: 'completed' as const,
        completedAt: new Date('2025-11-26'),
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 17. TASKS
  // =====================================================================
  console.log('  Seeding tasks...')
  await db
    .insert(tasks)
    .values([
      // p2 ms6 tasks (Gunawan/tp5)
      {
        id: task1Id,
        milestoneId: ms6Id,
        assignedTalentId: tp5Id,
        title: 'Setup REST API boilerplate',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 6,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-03'),
      },
      {
        id: task2Id,
        milestoneId: ms6Id,
        assignedTalentId: tp5Id,
        title: 'Booking logic & conflict prevention',
        orderIndex: 1,
        status: 'completed' as const,
        estimatedHours: 16,
        actualHours: 14,
        startDate: new Date('2026-03-04'),
        endDate: new Date('2026-03-10'),
      },
      {
        id: task3Id,
        milestoneId: ms6Id,
        assignedTalentId: tp5Id,
        title: 'API endpoint testing',
        orderIndex: 2,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 7,
        startDate: new Date('2026-03-11'),
        endDate: new Date('2026-03-14'),
      },
      // p10 ms11 tasks (Budi/tp1)
      {
        id: task4Id,
        milestoneId: ms11Id,
        assignedTalentId: tp1Id,
        title: 'Database schema design',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 10,
        actualHours: 8,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-04'),
      },
      {
        id: task5Id,
        milestoneId: ms11Id,
        assignedTalentId: tp1Id,
        title: 'REST API endpoints for tasks',
        orderIndex: 1,
        status: 'in_progress' as const,
        estimatedHours: 20,
        actualHours: 12,
        startDate: new Date('2026-03-05'),
      },
      {
        id: task6Id,
        milestoneId: ms11Id,
        assignedTalentId: tp1Id,
        title: 'Kanban board UI with drag-and-drop',
        orderIndex: 2,
        status: 'pending' as const,
        estimatedHours: 16,
        actualHours: null,
        startDate: new Date('2026-03-12'),
      },
      // p10 ms13 tasks (Irfan/tp7)
      {
        id: task7Id,
        milestoneId: ms13Id,
        assignedTalentId: tp7Id,
        title: 'Dockerize all services',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 12,
        actualHours: 14,
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-03-07'),
      },
      {
        id: task8Id,
        milestoneId: ms13Id,
        assignedTalentId: tp7Id,
        title: 'GitHub Actions CI/CD pipeline',
        orderIndex: 1,
        status: 'completed' as const,
        estimatedHours: 10,
        actualHours: 12,
        startDate: new Date('2026-03-08'),
        endDate: new Date('2026-03-12'),
      },
      {
        id: task9Id,
        milestoneId: ms13Id,
        assignedTalentId: tp7Id,
        title: 'Staging deployment fix',
        orderIndex: 2,
        status: 'in_progress' as const,
        estimatedHours: 8,
        actualHours: 4,
        startDate: new Date('2026-03-13'),
      },
      // p22 ms19 tasks (Irfan/tp7)
      {
        id: task10Id,
        milestoneId: ms19Id,
        assignedTalentId: tp7Id,
        title: 'Property search with filters',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 16,
        actualHours: 14,
        startDate: new Date('2026-03-05'),
        endDate: new Date('2026-03-12'),
      },
      {
        id: task11Id,
        milestoneId: ms19Id,
        assignedTalentId: tp7Id,
        title: 'Map view integration',
        orderIndex: 1,
        status: 'in_progress' as const,
        estimatedHours: 12,
        actualHours: 8,
        startDate: new Date('2026-03-13'),
      },
      {
        id: task12Id,
        milestoneId: ms19Id,
        assignedTalentId: tp7Id,
        title: 'Property detail page',
        orderIndex: 2,
        status: 'pending' as const,
        estimatedHours: 10,
        actualHours: null,
        startDate: new Date('2026-03-20'),
      },
      // p23 ms21 tasks (Budi/tp1)
      {
        id: task13Id,
        milestoneId: ms21Id,
        assignedTalentId: tp1Id,
        title: 'Dashboard layout & navigation',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 12,
        actualHours: 10,
        startDate: new Date('2026-03-05'),
        endDate: new Date('2026-03-10'),
      },
      {
        id: task14Id,
        milestoneId: ms21Id,
        assignedTalentId: tp1Id,
        title: 'Chart.js integration',
        orderIndex: 1,
        status: 'in_progress' as const,
        estimatedHours: 10,
        actualHours: 6,
        startDate: new Date('2026-03-11'),
      },
      // p24 ms24 tasks (Eko/tp3)
      {
        id: task15Id,
        milestoneId: ms24Id,
        assignedTalentId: tp3Id,
        title: 'PDF report generation',
        orderIndex: 0,
        status: 'completed' as const,
        estimatedHours: 8,
        actualHours: 7,
        startDate: new Date('2026-03-02'),
        endDate: new Date('2026-03-06'),
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 18. TASK DEPENDENCIES
  // =====================================================================
  console.log('  Seeding task dependencies...')
  await db
    .insert(taskDependencies)
    .values([
      { id: uuidv7(), taskId: task2Id, dependsOnTaskId: task1Id, type: 'finish_to_start' as const },
      { id: uuidv7(), taskId: task3Id, dependsOnTaskId: task2Id, type: 'finish_to_start' as const },
      { id: uuidv7(), taskId: task5Id, dependsOnTaskId: task4Id, type: 'finish_to_start' as const },
      { id: uuidv7(), taskId: task6Id, dependsOnTaskId: task5Id, type: 'finish_to_start' as const },
      { id: uuidv7(), taskId: task8Id, dependsOnTaskId: task7Id, type: 'finish_to_start' as const },
      {
        id: uuidv7(),
        taskId: task11Id,
        dependsOnTaskId: task10Id,
        type: 'finish_to_start' as const,
      },
      {
        id: uuidv7(),
        taskId: task12Id,
        dependsOnTaskId: task11Id,
        type: 'finish_to_start' as const,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 19. TIME LOGS
  // =====================================================================
  console.log('  Seeding time logs...')
  await db
    .insert(timeLogs)
    .values([
      {
        id: uuidv7(),
        taskId: task1Id,
        talentId: tp5Id,
        startedAt: new Date('2026-03-01T09:00:00Z'),
        endedAt: new Date('2026-03-01T15:00:00Z'),
        durationMinutes: 360,
        description: 'Setup Hono boilerplate, database schema',
      },
      {
        id: uuidv7(),
        taskId: task2Id,
        talentId: tp5Id,
        startedAt: new Date('2026-03-04T09:00:00Z'),
        endedAt: new Date('2026-03-04T17:00:00Z'),
        durationMinutes: 480,
        description: 'Booking logic core implementation',
      },
      {
        id: uuidv7(),
        taskId: task2Id,
        talentId: tp5Id,
        startedAt: new Date('2026-03-05T09:00:00Z'),
        endedAt: new Date('2026-03-05T15:00:00Z'),
        durationMinutes: 360,
        description: 'Conflict prevention and slot management',
      },
      {
        id: uuidv7(),
        taskId: task4Id,
        talentId: tp1Id,
        startedAt: new Date('2026-03-01T09:00:00Z'),
        endedAt: new Date('2026-03-01T17:00:00Z'),
        durationMinutes: 480,
        description: 'ERD design, Drizzle schema, seed data',
      },
      {
        id: uuidv7(),
        taskId: task5Id,
        talentId: tp1Id,
        startedAt: new Date('2026-03-05T09:00:00Z'),
        endedAt: new Date('2026-03-05T17:00:00Z'),
        durationMinutes: 480,
        description: 'CRUD endpoints for projects and tasks',
      },
      {
        id: uuidv7(),
        taskId: task7Id,
        talentId: tp7Id,
        startedAt: new Date('2026-03-01T09:00:00Z'),
        endedAt: new Date('2026-03-01T18:00:00Z'),
        durationMinutes: 540,
        description: 'Multi-stage Dockerfile for all services',
      },
      {
        id: uuidv7(),
        taskId: task8Id,
        talentId: tp7Id,
        startedAt: new Date('2026-03-08T09:00:00Z'),
        endedAt: new Date('2026-03-08T18:00:00Z'),
        durationMinutes: 540,
        description: 'GitHub Actions workflow setup',
      },
      {
        id: uuidv7(),
        taskId: task10Id,
        talentId: tp7Id,
        startedAt: new Date('2026-03-05T09:00:00Z'),
        endedAt: new Date('2026-03-05T17:00:00Z'),
        durationMinutes: 480,
        description: 'ElasticSearch-like property search with PG',
      },
      {
        id: uuidv7(),
        taskId: task13Id,
        talentId: tp1Id,
        startedAt: new Date('2026-03-05T09:00:00Z'),
        endedAt: new Date('2026-03-05T17:00:00Z'),
        durationMinutes: 480,
        description: 'Sidebar nav, header, responsive shell',
      },
      {
        id: uuidv7(),
        taskId: task14Id,
        talentId: tp1Id,
        startedAt: new Date('2026-03-11T09:00:00Z'),
        endedAt: new Date('2026-03-11T15:00:00Z'),
        durationMinutes: 360,
        description: 'Chart.js setup, line and bar charts',
      },
      {
        id: uuidv7(),
        taskId: task15Id,
        talentId: tp3Id,
        startedAt: new Date('2026-03-02T09:00:00Z'),
        endedAt: new Date('2026-03-02T16:00:00Z'),
        durationMinutes: 420,
        description: 'PDF report template and generation',
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 20. PAYMENT ACCOUNTS
  // =====================================================================
  console.log('  Seeding payment accounts...')
  await db
    .insert(accounts)
    .values([
      {
        id: platformAccId,
        ownerType: 'platform' as const,
        accountType: 'revenue' as const,
        name: 'Platform Revenue',
        balance: 42500000,
        currency: 'IDR',
      },
      {
        id: escrowAccId,
        ownerType: 'escrow' as const,
        accountType: 'asset' as const,
        name: 'Escrow Holding',
        balance: 130000000,
        currency: 'IDR',
      },
      {
        id: owner1AccId,
        ownerType: 'owner' as const,
        ownerId: owner1Id,
        accountType: 'liability' as const,
        name: 'Ahmad Fadillah - Client',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: owner2AccId,
        ownerType: 'owner' as const,
        ownerId: owner2Id,
        accountType: 'liability' as const,
        name: 'Siti Nurhaliza - Client',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: owner3AccId,
        ownerType: 'owner' as const,
        ownerId: owner3Id,
        accountType: 'liability' as const,
        name: 'Rahmat Hidayat - Client',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: owner5AccId,
        ownerType: 'owner' as const,
        ownerId: owner5Id,
        accountType: 'liability' as const,
        name: 'Farhan Pratama - Client',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: owner7AccId,
        ownerType: 'owner' as const,
        ownerId: owner7Id,
        accountType: 'liability' as const,
        name: 'Agus Santoso - Client',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: owner9AccId,
        ownerType: 'owner' as const,
        ownerId: owner9Id,
        accountType: 'liability' as const,
        name: 'Hendri Gunawan - Client',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: talent1AccId,
        ownerType: 'talent' as const,
        ownerId: talent1Id,
        accountType: 'asset' as const,
        name: 'Budi Setiawan - Payout',
        balance: 47250000,
        currency: 'IDR',
      },
      {
        id: talent2AccId,
        ownerType: 'talent' as const,
        ownerId: talent2Id,
        accountType: 'asset' as const,
        name: 'Dewi Lestari - Payout',
        balance: 18250000,
        currency: 'IDR',
      },
      {
        id: talent5AccId,
        ownerType: 'talent' as const,
        ownerId: talent5Id,
        accountType: 'asset' as const,
        name: 'Gunawan Wibowo - Payout',
        balance: 20000000,
        currency: 'IDR',
      },
      {
        id: talent7AccId,
        ownerType: 'talent' as const,
        ownerId: talent7Id,
        accountType: 'asset' as const,
        name: 'Irfan Maulana - Payout',
        balance: 0,
        currency: 'IDR',
      },
      {
        id: talent8AccId,
        ownerType: 'talent' as const,
        ownerId: talent8Id,
        accountType: 'asset' as const,
        name: 'Joko Susilo - Payout',
        balance: 9000000,
        currency: 'IDR',
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 21. TRANSACTIONS
  // =====================================================================
  console.log('  Seeding transactions...')
  await db
    .insert(transactions)
    .values([
      // p1 completed - escrow + BRD + PRD + releases
      {
        id: txn1Id,
        projectId: p1Id,
        type: 'escrow_in' as const,
        amount: 45000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2025093001',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn2Id,
        projectId: p1Id,
        milestoneId: ms1Id,
        talentId: tp1Id,
        type: 'escrow_release' as const,
        amount: 12000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn3Id,
        projectId: p1Id,
        milestoneId: ms2Id,
        talentId: tp1Id,
        type: 'escrow_release' as const,
        amount: 12000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn4Id,
        projectId: p1Id,
        milestoneId: ms3Id,
        talentId: tp1Id,
        type: 'escrow_release' as const,
        amount: 12000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn5Id,
        projectId: p1Id,
        type: 'brd_payment' as const,
        amount: 2500000,
        status: 'completed' as const,
        paymentMethod: 'qris',
        paymentGatewayRef: 'MTR-2025090101',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn6Id,
        projectId: p1Id,
        type: 'prd_payment' as const,
        amount: 4500000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2025091501',
        idempotencyKey: uuidv7(),
      },
      // p2 in_progress - escrow + milestone release
      {
        id: txn7Id,
        projectId: p2Id,
        type: 'escrow_in' as const,
        amount: 30000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026022801',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn8Id,
        projectId: p2Id,
        milestoneId: ms4Id,
        talentId: tp2Id,
        type: 'escrow_release' as const,
        amount: 7000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // p4 completed
      {
        id: txn9Id,
        projectId: p4Id,
        type: 'escrow_in' as const,
        amount: 15000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2025112901',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn10Id,
        projectId: p4Id,
        milestoneId: ms8Id,
        talentId: tp2Id,
        type: 'escrow_release' as const,
        amount: 11250000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // p9 disputed - escrow in + partial release
      {
        id: txn11Id,
        projectId: p9Id,
        type: 'escrow_in' as const,
        amount: 42000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026011401',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn12Id,
        projectId: p9Id,
        milestoneId: ms9Id,
        talentId: tp6Id,
        type: 'escrow_release' as const,
        amount: 16800000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // p10 in_progress - escrow
      {
        id: txn13Id,
        projectId: p10Id,
        type: 'escrow_in' as const,
        amount: 62000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026022802',
        idempotencyKey: uuidv7(),
      },
      // p11 on_hold - escrow + 1 release
      {
        id: txn14Id,
        projectId: p11Id,
        type: 'escrow_in' as const,
        amount: 48000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026021401',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn15Id,
        projectId: p11Id,
        milestoneId: ms15Id,
        talentId: tp5Id,
        type: 'escrow_release' as const,
        amount: 20000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // p12 cancelled - refund
      {
        id: txn16Id,
        projectId: p12Id,
        type: 'refund' as const,
        amount: 16000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-REF-2026030101',
        idempotencyKey: uuidv7(),
      },
      // p13 completed - escrow + releases
      {
        id: txn17Id,
        projectId: p13Id,
        type: 'escrow_in' as const,
        amount: 12000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2025103001',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn18Id,
        projectId: p13Id,
        milestoneId: ms17Id,
        talentId: tp8Id,
        type: 'escrow_release' as const,
        amount: 4500000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      {
        id: txn19Id,
        projectId: p13Id,
        milestoneId: ms18Id,
        talentId: tp8Id,
        type: 'escrow_release' as const,
        amount: 4500000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        idempotencyKey: uuidv7(),
      },
      // p25 completed - escrow + releases
      {
        id: txn20Id,
        projectId: p25Id,
        type: 'escrow_in' as const,
        amount: 15000000,
        status: 'completed' as const,
        paymentMethod: 'bank_transfer',
        paymentGatewayRef: 'MTR-2026010901',
        idempotencyKey: uuidv7(),
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 22. TRANSACTION EVENTS
  // =====================================================================
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
        amount: 45000000,
        performedBy: owner1Id,
      },
      {
        id: uuidv7(),
        transactionId: txn2Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 12000000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn3Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 12000000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn4Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 12000000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn8Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 7000000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn10Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 11250000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn12Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 16800000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn15Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 20000000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn16Id,
        eventType: 'refund_initiated' as const,
        previousStatus: null,
        newStatus: 'completed' as const,
        amount: 16000000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn18Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 4500000,
        performedBy: adminId,
      },
      {
        id: uuidv7(),
        transactionId: txn19Id,
        eventType: 'funds_released' as const,
        previousStatus: 'pending' as const,
        newStatus: 'completed' as const,
        amount: 4500000,
        performedBy: adminId,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 23. LEDGER ENTRIES
  // =====================================================================
  console.log('  Seeding ledger entries...')
  await db
    .insert(ledgerEntries)
    .values([
      {
        id: uuidv7(),
        transactionId: txn1Id,
        accountId: owner1AccId,
        entryType: 'debit' as const,
        amount: 45000000,
        description: 'Escrow deposit - KopiNusantara',
      },
      {
        id: uuidv7(),
        transactionId: txn1Id,
        accountId: escrowAccId,
        entryType: 'credit' as const,
        amount: 45000000,
        description: 'Escrow received - KopiNusantara',
      },
      {
        id: uuidv7(),
        transactionId: txn2Id,
        accountId: escrowAccId,
        entryType: 'debit' as const,
        amount: 12000000,
        description: 'Release escrow - DB Schema (Budi)',
      },
      {
        id: uuidv7(),
        transactionId: txn2Id,
        accountId: talent1AccId,
        entryType: 'credit' as const,
        amount: 12000000,
        description: 'Payout - DB Schema ke Budi',
      },
      {
        id: uuidv7(),
        transactionId: txn9Id,
        accountId: owner2AccId,
        entryType: 'debit' as const,
        amount: 15000000,
        description: 'Escrow deposit - Redesign Travel',
      },
      {
        id: uuidv7(),
        transactionId: txn9Id,
        accountId: escrowAccId,
        entryType: 'credit' as const,
        amount: 15000000,
        description: 'Escrow received - Redesign Travel',
      },
      {
        id: uuidv7(),
        transactionId: txn10Id,
        accountId: escrowAccId,
        entryType: 'debit' as const,
        amount: 11250000,
        description: 'Release escrow - Redesign (Dewi)',
      },
      {
        id: uuidv7(),
        transactionId: txn10Id,
        accountId: talent2AccId,
        entryType: 'credit' as const,
        amount: 11250000,
        description: 'Payout - Redesign ke Dewi',
      },
      {
        id: uuidv7(),
        transactionId: txn17Id,
        accountId: owner9AccId,
        entryType: 'debit' as const,
        amount: 12000000,
        description: 'Escrow deposit - Kasir UMKM',
      },
      {
        id: uuidv7(),
        transactionId: txn17Id,
        accountId: escrowAccId,
        entryType: 'credit' as const,
        amount: 12000000,
        description: 'Escrow received - Kasir UMKM',
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 24. REVIEWS (for completed projects)
  // =====================================================================
  console.log('  Seeding reviews...')
  await db
    .insert(reviews)
    .values([
      // p1 completed
      {
        id: uuidv7(),
        projectId: p1Id,
        reviewerId: owner1Id,
        revieweeId: talent1Id,
        rating: 5,
        comment:
          'Budi sangat profesional, deliverables semua on-time dan rapi. Sangat merekomendasikan!',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: p1Id,
        reviewerId: talent1Id,
        revieweeId: owner1Id,
        rating: 5,
        comment: 'Ahmad kooperatif, brief jelas, feedback cepat. Proyek menarik.',
        type: 'talent_to_owner' as const,
      },
      // p4 completed
      {
        id: uuidv7(),
        projectId: p4Id,
        reviewerId: owner2Id,
        revieweeId: talent2Id,
        rating: 5,
        comment: 'Desain sangat bagus dan sesuai brief. Komunikasi lancar.',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: p4Id,
        reviewerId: talent2Id,
        revieweeId: owner2Id,
        rating: 5,
        comment: 'Owner kooperatif, brief jelas, feedback tepat waktu.',
        type: 'talent_to_owner' as const,
      },
      // p13 completed
      {
        id: uuidv7(),
        projectId: p13Id,
        reviewerId: owner9Id,
        revieweeId: talent8Id,
        rating: 4,
        comment:
          'Aplikasi kasir berjalan baik, fitur lengkap. Ada sedikit delay tapi overall puas.',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: p13Id,
        reviewerId: talent8Id,
        revieweeId: owner9Id,
        rating: 5,
        comment: 'Owner sangat jelas requirement-nya dan responsif.',
        type: 'talent_to_owner' as const,
      },
      // p25 completed
      {
        id: uuidv7(),
        projectId: p25Id,
        reviewerId: owner5Id,
        revieweeId: talent1Id,
        rating: 5,
        comment: 'Website klinik fungsional dan clean. Appointment system berjalan baik.',
        type: 'owner_to_talent' as const,
      },
      {
        id: uuidv7(),
        projectId: p25Id,
        reviewerId: talent1Id,
        revieweeId: owner5Id,
        rating: 4,
        comment: 'Pak Farhan kooperatif dan cepat approve milestone.',
        type: 'talent_to_owner' as const,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 25. NOTIFICATIONS (50+)
  // =====================================================================
  console.log('  Seeding notifications...')
  await db
    .insert(notifications)
    .values([
      // owner1 (3 projects)
      {
        id: uuidv7(),
        userId: owner1Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disubmit',
        message: 'Gunawan telah mensubmit milestone "Backend API & Booking Engine" untuk review.',
        link: `/projects/${p2Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner1Id,
        type: 'payment' as const,
        title: 'Pembayaran Berhasil',
        message: 'Escrow Rp 30.000.000 untuk proyek Booking Futsal berhasil diterima.',
        link: '/payments',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner1Id,
        type: 'milestone_update' as const,
        title: 'Proyek Selesai',
        message: 'Proyek KopiNusantara telah selesai. Terima kasih telah menggunakan KerjaCUS!',
        link: `/projects/${p1Id}`,
        isRead: true,
      },
      // owner2
      {
        id: uuidv7(),
        userId: owner2Id,
        type: 'system' as const,
        title: 'Proyek Partially Active',
        message: 'Satu talent di proyek "Dashboard Fleet Analytics" telah diterminasi.',
        link: `/projects/${p23Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner2Id,
        type: 'payment' as const,
        title: 'Pembayaran Berhasil',
        message: 'Pembayaran BRD Rp 1.500.000 untuk Dashboard Analytics berhasil.',
        link: '/payments',
        isRead: true,
      },
      // owner3
      {
        id: uuidv7(),
        userId: owner3Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disubmit',
        message: 'Eko telah mensubmit milestone "Reports & PDF Export" untuk review.',
        link: `/projects/${p24Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner3Id,
        type: 'system' as const,
        title: 'BRD Purchased',
        message: 'BRD untuk "Website Company Profile" berhasil dibeli. Terima kasih!',
        link: `/projects/${p16Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner3Id,
        type: 'project_match' as const,
        title: 'Sedang Mencari Talent',
        message: 'Platform sedang mencarikan talent untuk "Sistem Manajemen Inventori".',
        link: `/projects/${p6Id}`,
        isRead: false,
      },
      // owner4
      {
        id: uuidv7(),
        userId: owner4Id,
        type: 'system' as const,
        title: 'BRD Ready',
        message: 'BRD untuk proyek "E-commerce Batik Modern" telah di-generate. Silakan review.',
        link: `/projects/${p7Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner4Id,
        type: 'system' as const,
        title: 'PRD Generated',
        message: 'PRD untuk "Marketplace Produk Handmade" telah di-generate.',
        link: `/projects/${p17Id}`,
        isRead: false,
      },
      // owner5
      {
        id: uuidv7(),
        userId: owner5Id,
        type: 'system' as const,
        title: 'PRD Approved',
        message: 'PRD untuk "Dashboard Monitoring Kesehatan" disetujui. Lanjut ke matching?',
        link: `/projects/${p8Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner5Id,
        type: 'milestone_update' as const,
        title: 'Proyek Selesai',
        message: 'Proyek "Website Klinik Kesehatan" telah selesai!',
        link: `/projects/${p25Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner5Id,
        type: 'payment' as const,
        title: 'PRD Purchased',
        message: 'PRD untuk "Mobile App Belajar Bahasa" berhasil dibeli.',
        link: `/projects/${p18Id}`,
        isRead: true,
      },
      // owner6
      {
        id: uuidv7(),
        userId: owner6Id,
        type: 'dispute' as const,
        title: 'Dispute Dibuat',
        message: 'Dispute Anda pada proyek "Platform LMS EduStart" telah diajukan.',
        link: `/projects/${p9Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner6Id,
        type: 'system' as const,
        title: 'Matching Talent',
        message: 'Platform sedang mencarikan talent untuk "Platform Ujian Online".',
        link: `/projects/${p19Id}`,
        isRead: false,
      },
      // owner7
      {
        id: uuidv7(),
        userId: owner7Id,
        type: 'milestone_update' as const,
        title: 'Revisi Diminta',
        message: 'Milestone "Docker & CI/CD Setup" memerlukan revisi.',
        link: `/projects/${p10Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: owner7Id,
        type: 'system' as const,
        title: 'Proyek On Hold',
        message: 'Proyek "Sistem Tracking Armada" telah di-hold sesuai permintaan.',
        link: `/projects/${p11Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner7Id,
        type: 'team_formation' as const,
        title: 'Tim Sedang Dibentuk',
        message:
          'Platform Manajemen Properti sedang dalam proses team forming. 1 dari 3 posisi terisi.',
        link: `/projects/${p20Id}`,
        isRead: false,
      },
      // owner8
      {
        id: uuidv7(),
        userId: owner8Id,
        type: 'system' as const,
        title: 'Proyek Dibatalkan',
        message: 'Proyek "Aplikasi Reservasi Restoran" telah dibatalkan. Refund diproses.',
        link: `/projects/${p12Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner8Id,
        type: 'system' as const,
        title: 'Talent Matched',
        message: 'Talent telah ditemukan untuk proyek "Aplikasi Loyalty & Rewards".',
        link: `/projects/${p21Id}`,
        isRead: false,
      },
      // owner9
      {
        id: uuidv7(),
        userId: owner9Id,
        type: 'milestone_update' as const,
        title: 'Proyek Selesai',
        message: 'Proyek "Aplikasi Mobile Kasir UMKM" telah selesai!',
        link: `/projects/${p13Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: owner9Id,
        type: 'payment' as const,
        title: 'Pembayaran Berhasil',
        message: 'Escrow Rp 45.000.000 untuk Portal Listing Properti diterima.',
        link: '/payments',
        isRead: true,
      },
      // owner10
      {
        id: uuidv7(),
        userId: owner10Id,
        type: 'system' as const,
        title: 'Selamat Datang di KerjaCUS!',
        message: 'Akun Anda sudah terverifikasi. Mulai buat proyek pertama Anda!',
        link: '/dashboard',
        isRead: false,
      },
      // talent1 (Budi - senior, 3 completed)
      {
        id: uuidv7(),
        userId: talent1Id,
        type: 'payment' as const,
        title: 'Dana Cair',
        message: 'Pembayaran Rp 12.000.000 untuk milestone "Dashboard & Final Testing" dicairkan.',
        link: '/payments',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent1Id,
        type: 'project_match' as const,
        title: 'Proyek Baru Cocok',
        message: 'Proyek "Sistem Manajemen Inventori" cocok dengan skill Anda.',
        link: `/projects/${p6Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent1Id,
        type: 'milestone_update' as const,
        title: 'Proyek Selesai',
        message: 'Proyek "Website Klinik Kesehatan" selesai. Rating dari owner: 5 bintang!',
        link: `/projects/${p25Id}`,
        isRead: true,
      },
      // talent2 (Dewi - mid, 2 completed + 1 ongoing)
      {
        id: uuidv7(),
        userId: talent2Id,
        type: 'payment' as const,
        title: 'Dana Cair',
        message: 'Pembayaran Rp 7.000.000 untuk milestone "Mobile UI Foundations" dicairkan.',
        link: '/payments',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent2Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disetujui',
        message: 'Milestone "Mobile UI Foundations" telah disetujui.',
        link: `/projects/${p2Id}/milestones`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent2Id,
        type: 'project_match' as const,
        title: 'Tawaran Proyek',
        message: 'Anda direkomendasikan untuk proyek "Platform Manajemen Properti" (UI/UX).',
        link: `/projects/${p20Id}`,
        isRead: false,
      },
      // talent3 (Eko - junior, 1 completed)
      {
        id: uuidv7(),
        userId: talent3Id,
        type: 'milestone_update' as const,
        title: 'Milestone Disetujui',
        message: 'Milestone "Core Recording Features" telah disetujui.',
        link: `/projects/${p24Id}/milestones`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent3Id,
        type: 'project_match' as const,
        title: 'Proyek Cocok',
        message: 'Proyek "Platform Ujian Online" cocok untuk skill Anda.',
        link: `/projects/${p19Id}`,
        isRead: false,
      },
      // talent4 (Fitri - brand new, 0 projects)
      {
        id: uuidv7(),
        userId: talent4Id,
        type: 'system' as const,
        title: 'Selamat Datang di KerjaCUS!',
        message: 'Profil Anda sudah terverifikasi. Browse proyek yang sesuai skill Anda.',
        link: '/dashboard',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent4Id,
        type: 'project_match' as const,
        title: 'Proyek Cocok untuk Anda',
        message: 'Proyek "Aplikasi Loyalty & Rewards" cocok untuk portfolio pertama Anda.',
        link: `/projects/${p21Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent4Id,
        type: 'assignment_offer' as const,
        title: 'Tawaran Proyek Baru',
        message: 'Anda mendapat tawaran untuk "Mobile App Belajar Bahasa Daerah".',
        link: `/projects/${p18Id}`,
        isRead: false,
      },
      // talent5 (Gunawan - mid, 1 completed + 1 ongoing)
      {
        id: uuidv7(),
        userId: talent5Id,
        type: 'milestone_update' as const,
        title: 'Review Milestone',
        message: 'Milestone "Backend API & Booking Engine" sedang direview oleh owner.',
        link: `/projects/${p2Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent5Id,
        type: 'payment' as const,
        title: 'Dana Cair',
        message: 'Pembayaran Rp 20.000.000 untuk milestone "GPS Tracking Core" dicairkan.',
        link: '/payments',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent5Id,
        type: 'system' as const,
        title: 'Proyek On Hold',
        message: 'Proyek "Sistem Tracking Armada" di-hold oleh owner.',
        link: `/projects/${p11Id}`,
        isRead: false,
      },
      // talent6 (Hana - suspended)
      {
        id: uuidv7(),
        userId: talent6Id,
        type: 'system' as const,
        title: 'Akun Disuspend',
        message:
          'Akun Anda disuspend karena tidak responsif pada proyek. Hubungi admin untuk banding.',
        link: '/dashboard',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent6Id,
        type: 'dispute' as const,
        title: 'Dispute Dibuka',
        message: 'Owner Lina membuka dispute pada proyek "Platform LMS EduStart".',
        link: `/projects/${p9Id}`,
        isRead: true,
      },
      // talent7 (Irfan - 2 completed, available)
      {
        id: uuidv7(),
        userId: talent7Id,
        type: 'milestone_update' as const,
        title: 'Revisi Diminta',
        message: 'Owner meminta revisi pada milestone "Docker & CI/CD Setup".',
        link: `/projects/${p10Id}/milestones`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent7Id,
        type: 'project_match' as const,
        title: 'Proyek Baru Cocok',
        message: 'Proyek "Platform Manajemen Properti SaaS" cocok dengan skill Anda.',
        link: `/projects/${p20Id}`,
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: talent7Id,
        type: 'assignment_offer' as const,
        title: 'Tawaran Backend',
        message: 'Anda diterima untuk posisi Backend di "Platform Manajemen Properti".',
        link: `/projects/${p20Id}`,
        isRead: true,
      },
      // talent8 (Joko - 1 ongoing)
      {
        id: uuidv7(),
        userId: talent8Id,
        type: 'milestone_update' as const,
        title: 'Proyek Selesai',
        message: 'Proyek "Aplikasi Mobile Kasir UMKM" selesai. Rating dari owner: 4 bintang!',
        link: `/projects/${p13Id}`,
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: talent8Id,
        type: 'assignment_offer' as const,
        title: 'Tawaran Proyek',
        message: 'Anda diterima untuk proyek "Aplikasi Loyalty & Rewards Restoran".',
        link: `/projects/${p21Id}`,
        isRead: true,
      },
      // admin notifications
      {
        id: uuidv7(),
        userId: adminId,
        type: 'dispute' as const,
        title: 'Dispute Baru',
        message: 'Owner Lina melaporkan dispute pada proyek "Platform LMS EduStart".',
        link: '/admin/disputes',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'system' as const,
        title: 'Talent Baru',
        message: 'Fitri Handayani telah mendaftar sebagai talent. CV menunggu verifikasi.',
        link: '/admin/users',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'system' as const,
        title: 'Talent Disuspend',
        message: 'Hana Permata telah disuspend dari platform.',
        link: '/admin/users',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: adminId,
        type: 'system' as const,
        title: 'Proyek Cancelled',
        message: 'Proyek "Aplikasi Reservasi Restoran" dibatalkan oleh owner.',
        link: '/admin/projects',
        isRead: true,
      },
      {
        id: uuidv7(),
        userId: admin2Id,
        type: 'system' as const,
        title: 'Weekly Report Ready',
        message: 'Laporan mingguan platform sudah tersedia. 4 proyek baru, 4 completed.',
        link: '/admin/dashboard',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: admin2Id,
        type: 'system' as const,
        title: 'High Value Project',
        message: 'Proyek "Platform Manajemen Properti SaaS" senilai Rp 65.000.000 telah dibuat.',
        link: '/admin/projects',
        isRead: false,
      },
      {
        id: uuidv7(),
        userId: admin2Id,
        type: 'system' as const,
        title: 'DLQ Alert',
        message: '2 event gagal diproses di Dead Letter Queue. Perlu review.',
        link: '/admin/dlq',
        isRead: false,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 26. CHAT CONVERSATIONS, PARTICIPANTS & MESSAGES (15 conversations)
  // =====================================================================
  console.log('  Seeding chat conversations...')
  await db
    .insert(chatConversations)
    .values([
      { id: conv1Id, projectId: p1Id, type: 'ai_scoping' as const },
      { id: conv2Id, projectId: p2Id, type: 'owner_talent' as const },
      { id: conv3Id, projectId: p2Id, type: 'team_group' as const },
      { id: conv4Id, projectId: p7Id, type: 'ai_scoping' as const },
      { id: conv5Id, projectId: p9Id, type: 'admin_mediation' as const },
      { id: conv6Id, projectId: p10Id, type: 'owner_talent' as const },
      { id: conv7Id, projectId: p10Id, type: 'talent_talent' as const },
      { id: conv8Id, projectId: p15Id, type: 'ai_scoping' as const },
      { id: conv9Id, projectId: p22Id, type: 'owner_talent' as const },
      { id: conv10Id, projectId: p23Id, type: 'owner_talent' as const },
      { id: conv11Id, projectId: p24Id, type: 'owner_talent' as const },
      { id: conv12Id, projectId: p11Id, type: 'owner_talent' as const },
      { id: conv13Id, projectId: p2Id, type: 'talent_talent' as const },
      { id: conv14Id, projectId: p13Id, type: 'owner_talent' as const },
      { id: conv15Id, projectId: p25Id, type: 'owner_talent' as const },
    ])
    .onConflictDoNothing()

  console.log('  Seeding chat participants...')
  await db
    .insert(chatParticipants)
    .values([
      { id: uuidv7(), conversationId: conv1Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv2Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv2Id, userId: talent2Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv3Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv3Id, userId: talent2Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv3Id, userId: talent5Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv4Id, userId: owner4Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv5Id, userId: owner6Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv5Id, userId: talent6Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv5Id, userId: adminId, role: 'moderator' as const },
      { id: uuidv7(), conversationId: conv6Id, userId: owner7Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv6Id, userId: talent1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv7Id, userId: talent1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv7Id, userId: talent7Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv8Id, userId: owner1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv9Id, userId: owner9Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv9Id, userId: talent7Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv10Id, userId: owner2Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv10Id, userId: talent1Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv11Id, userId: owner3Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv11Id, userId: talent3Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv12Id, userId: owner7Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv12Id, userId: talent5Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv13Id, userId: talent2Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv13Id, userId: talent5Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv14Id, userId: owner9Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv14Id, userId: talent8Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv15Id, userId: owner5Id, role: 'member' as const },
      { id: uuidv7(), conversationId: conv15Id, userId: talent1Id, role: 'member' as const },
    ])
    .onConflictDoNothing()

  console.log('  Seeding chat messages...')
  await db
    .insert(chatMessages)
    .values([
      // conv1 - AI scoping p1
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'ai' as const,
        content:
          'Halo! Saya akan membantu mendefinisikan kebutuhan proyek e-commerce kopi. Bisa ceritakan target pengguna?',
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Saya ingin membuat marketplace kopi Indonesia. Target pengguna UMKM kopi dari berbagai daerah.',
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'ai' as const,
        content:
          'Menarik! Beberapa pertanyaan: 1) Apakah ingin fitur subscription? 2) Integrasi kurir mana? 3) Fitur review/rating?',
        metadata: { completenessScore: 45, model: 'gpt-4o-mini' },
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Ya, subscription bulanan. Integrasi JNE, J&T, SiCepat. Review dan rating pasti perlu.',
      },
      {
        id: uuidv7(),
        conversationId: conv1Id,
        senderType: 'ai' as const,
        content: 'Bagus! Completeness score sudah 82%. Saya siap generate BRD. Mau lanjutkan?',
        metadata: { completenessScore: 82, model: 'gpt-4o-mini' },
      },
      // conv2 - owner-talent p2
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content: 'Halo Dewi, bagaimana progress mobile UI?',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: talent2Id,
        content:
          'Halo Pak Ahmad, navigation dan map view sudah selesai. Booking UI sedang dikerjakan.',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content: 'Bagus! Kalau bisa include dark mode juga ya untuk booking screen.',
      },
      {
        id: uuidv7(),
        conversationId: conv2Id,
        senderType: 'user' as const,
        senderId: talent2Id,
        content: 'Siap, dark mode akan saya masukkan di milestone berikutnya.',
      },
      // conv3 - team group p2
      {
        id: uuidv7(),
        conversationId: conv3Id,
        senderType: 'user' as const,
        senderId: talent5Id,
        content:
          'Tim, API booking engine sudah ready untuk testing. Endpoint documentation ada di Swagger.',
      },
      {
        id: uuidv7(),
        conversationId: conv3Id,
        senderType: 'user' as const,
        senderId: talent2Id,
        content: 'Thanks Gunawan! Saya mulai integrasi API ke mobile app besok.',
      },
      {
        id: uuidv7(),
        conversationId: conv3Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content: 'Terima kasih tim! Progressnya bagus. Keep it up!',
      },
      // conv4 - AI scoping p7
      {
        id: uuidv7(),
        conversationId: conv4Id,
        senderType: 'ai' as const,
        content:
          'Halo! Saya akan membantu mendefinisikan kebutuhan toko online batik. Apa fitur utama yang diinginkan?',
      },
      {
        id: uuidv7(),
        conversationId: conv4Id,
        senderType: 'user' as const,
        senderId: owner4Id,
        content: 'Saya ingin toko online batik dengan fitur try-on virtual menggunakan AR.',
      },
      {
        id: uuidv7(),
        conversationId: conv4Id,
        senderType: 'ai' as const,
        content: 'Fitur AR menarik! Apakah target pasar B2C atau B2B? Dan budget range-nya berapa?',
        metadata: { completenessScore: 35, model: 'gpt-4o-mini' },
      },
      // conv5 - admin mediation p9 (disputed)
      {
        id: uuidv7(),
        conversationId: conv5Id,
        senderType: 'system' as const,
        content:
          'Dispute dibuka oleh Lina Wijaya terhadap Hana Permata pada proyek "Platform LMS EduStart".',
      },
      {
        id: uuidv7(),
        conversationId: conv5Id,
        senderType: 'user' as const,
        senderId: owner6Id,
        content:
          'Quiz auto-grading masih error setelah 2 revisi. Talent tidak responsif selama 5 hari terakhir.',
      },
      {
        id: uuidv7(),
        conversationId: conv5Id,
        senderType: 'user' as const,
        senderId: talent6Id,
        content: 'Maaf, saya ada masalah keluarga. Saya akan perbaiki segera.',
      },
      {
        id: uuidv7(),
        conversationId: conv5Id,
        senderType: 'user' as const,
        senderId: adminId,
        content: 'Baik, saya akan review bukti dari kedua pihak. Mohon tunggu 2 hari kerja.',
      },
      {
        id: uuidv7(),
        conversationId: conv5Id,
        senderType: 'user' as const,
        senderId: adminId,
        content:
          'Setelah review, talent sudah tidak responsif >10 hari. Saya rekomendasikan reassignment.',
      },
      // conv6 - owner-talent p10
      {
        id: uuidv7(),
        conversationId: conv6Id,
        senderType: 'user' as const,
        senderId: owner7Id,
        content: 'Budi, bagaimana progress Kanban board? Ada blocker?',
      },
      {
        id: uuidv7(),
        conversationId: conv6Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content:
          'Halo Pak Agus, API tasks sudah hampir selesai. Drag-and-drop estimasi minggu depan.',
      },
      // conv7 - talent-talent p10
      {
        id: uuidv7(),
        conversationId: conv7Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content: 'Irfan, Docker compose deployment-nya gagal di staging. Bisa cek env vars?',
      },
      {
        id: uuidv7(),
        conversationId: conv7Id,
        senderType: 'user' as const,
        senderId: talent7Id,
        content: 'Oh iya, ada port conflict. Saya fix sekarang. Estimasi 1-2 jam.',
      },
      {
        id: uuidv7(),
        conversationId: conv7Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content: 'Thanks Irfan! Saya tunggu ya baru lanjut integration test.',
      },
      // conv8 - AI scoping p15
      {
        id: uuidv7(),
        conversationId: conv8Id,
        senderType: 'ai' as const,
        content:
          'Halo! Saya akan membantu mendefinisikan kebutuhan sistem notifikasi multi-channel. Channel apa saja yang dibutuhkan?',
      },
      {
        id: uuidv7(),
        conversationId: conv8Id,
        senderType: 'user' as const,
        senderId: owner1Id,
        content:
          'Kami butuh email, SMS via Twilio, push notification via Firebase. Plus dashboard analytics.',
      },
      // conv9 - owner-talent p22
      {
        id: uuidv7(),
        conversationId: conv9Id,
        senderType: 'user' as const,
        senderId: owner9Id,
        content: 'Irfan, property search-nya sudah bisa coba? Demo link please.',
      },
      {
        id: uuidv7(),
        conversationId: conv9Id,
        senderType: 'user' as const,
        senderId: talent7Id,
        content:
          'Siap Pak Hendri! Demo di staging: https://staging.proptech.id. Search by lokasi sudah jalan.',
      },
      // conv10 - owner-talent p23
      {
        id: uuidv7(),
        conversationId: conv10Id,
        senderType: 'user' as const,
        senderId: owner2Id,
        content:
          'Budi, data pipeline talent sebelumnya sudah diterminasi. Bagaimana progress dashboard?',
      },
      {
        id: uuidv7(),
        conversationId: conv10Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content:
          'Bu Siti, dashboard UI bisa jalan dengan mock data dulu. Saya lanjut develop sambil menunggu talent data baru.',
      },
      // conv11 - owner-talent p24
      {
        id: uuidv7(),
        conversationId: conv11Id,
        senderType: 'user' as const,
        senderId: owner3Id,
        content: 'Eko, laporan PDF-nya sudah bisa di-test? Petani kami mau coba.',
      },
      {
        id: uuidv7(),
        conversationId: conv11Id,
        senderType: 'user' as const,
        senderId: talent3Id,
        content:
          'Sudah Pak Rahmat! APK test bisa didownload di link ini. PDF export juga sudah berfungsi.',
      },
      // conv12 - owner-talent p11
      {
        id: uuidv7(),
        conversationId: conv12Id,
        senderType: 'user' as const,
        senderId: owner7Id,
        content:
          'Gunawan, proyek di-hold dulu ya karena ada pergantian manajemen. Akan saya kabari kalau dilanjutkan.',
      },
      {
        id: uuidv7(),
        conversationId: conv12Id,
        senderType: 'user' as const,
        senderId: talent5Id,
        content:
          'Siap Pak Agus, saya pause dulu development-nya. Kalau ada update langsung kabari ya.',
      },
      // conv13 - talent-talent p2
      {
        id: uuidv7(),
        conversationId: conv13Id,
        senderType: 'user' as const,
        senderId: talent2Id,
        content:
          'Gunawan, API response format untuk booking list bisa tambahin field "facility_list"?',
      },
      {
        id: uuidv7(),
        conversationId: conv13Id,
        senderType: 'user' as const,
        senderId: talent5Id,
        content: 'Bisa, saya tambahkan di next commit. Nanti pakai array of string ya.',
      },
      // conv14 - owner-talent p13
      {
        id: uuidv7(),
        conversationId: conv14Id,
        senderType: 'user' as const,
        senderId: owner9Id,
        content: 'Joko, kasir app-nya lancar! Pelanggan warung senang pakai struk WhatsApp.',
      },
      {
        id: uuidv7(),
        conversationId: conv14Id,
        senderType: 'user' as const,
        senderId: talent8Id,
        content: 'Terima kasih Pak Hendri! Senang bisa membantu UMKM.',
      },
      // conv15 - owner-talent p25
      {
        id: uuidv7(),
        conversationId: conv15Id,
        senderType: 'user' as const,
        senderId: owner5Id,
        content: 'Budi, website klinik sangat memuaskan. Terima kasih!',
      },
      {
        id: uuidv7(),
        conversationId: conv15Id,
        senderType: 'user' as const,
        senderId: talent1Id,
        content: 'Terima kasih Pak Farhan! Senang proyek berjalan lancar.',
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 27. DISPUTES
  // =====================================================================
  console.log('  Seeding disputes...')
  await db
    .insert(disputes)
    .values([
      {
        id: dispute1Id,
        projectId: p9Id,
        initiatedBy: owner6Id,
        againstUserId: talent6Id,
        reason:
          'Quiz auto-grading masih error setelah 2 kali revisi. Talent tidak responsif selama >10 hari.',
        evidenceUrls: [
          'https://storage.kerjacus.id/evidence/lms-quiz-error-1.png',
          'https://storage.kerjacus.id/evidence/lms-chat-log.png',
        ],
        status: 'under_review' as const,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 28. PROJECT APPLICATIONS
  // =====================================================================
  console.log('  Seeding project applications...')
  await db
    .insert(projectApplications)
    .values([
      {
        id: uuidv7(),
        projectId: p6Id,
        talentId: tp1Id,
        status: 'pending' as const,
        coverNote: 'Full-stack web app spesialisasi saya. Pernah buat warehouse management system.',
        recommendationScore: 0.82,
      },
      {
        id: uuidv7(),
        projectId: p6Id,
        talentId: tp7Id,
        status: 'pending' as const,
        coverNote: 'Punya pengalaman membangun inventory system untuk logistik.',
        recommendationScore: 0.79,
      },
      {
        id: uuidv7(),
        projectId: p6Id,
        talentId: tp3Id,
        status: 'pending' as const,
        coverNote: 'Tertarik untuk belajar lebih dalam tentang inventory management.',
        recommendationScore: 0.65,
      },
      {
        id: uuidv7(),
        projectId: p19Id,
        talentId: tp1Id,
        status: 'pending' as const,
        coverNote: 'Exam platform mirip project management yang pernah saya kerjakan.',
        recommendationScore: 0.8,
      },
      {
        id: uuidv7(),
        projectId: p19Id,
        talentId: tp3Id,
        status: 'pending' as const,
        coverNote: 'Saya bisa handle backend quiz engine.',
        recommendationScore: 0.68,
      },
      {
        id: uuidv7(),
        projectId: p5Id,
        talentId: tp5Id,
        status: 'pending' as const,
        coverNote: 'Python data analytics adalah keahlian saya.',
        recommendationScore: 0.85,
      },
      {
        id: uuidv7(),
        projectId: p5Id,
        talentId: tp1Id,
        status: 'withdrawn' as const,
        coverNote: 'Tertarik tapi jadwal bentrok.',
        recommendationScore: 0.75,
      },
      {
        id: uuidv7(),
        projectId: p20Id,
        talentId: tp2Id,
        status: 'pending' as const,
        coverNote: 'UI/UX untuk SaaS platform sangat menarik.',
        recommendationScore: 0.86,
      },
      {
        id: uuidv7(),
        projectId: p20Id,
        talentId: tp1Id,
        status: 'rejected' as const,
        coverNote: 'Bisa handle frontend.',
        recommendationScore: 0.72,
      },
      {
        id: uuidv7(),
        projectId: p7Id,
        talentId: tp4Id,
        status: 'pending' as const,
        coverNote: 'Saya tertarik belajar e-commerce development.',
        recommendationScore: 0.58,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 29. PROJECT ACTIVITIES
  // =====================================================================
  console.log('  Seeding project activities...')
  const activityData: Array<{
    projectId: string
    userId: string
    type: typeof projectActivities.$inferInsert.type
    title: string
    metadata: unknown
  }> = [
    {
      projectId: p1Id,
      userId: adminId,
      type: 'status_changed',
      title: 'Proyek KopiNusantara selesai',
      metadata: { fromStatus: 'review', toStatus: 'completed' },
    },
    {
      projectId: p1Id,
      userId: talent1Id,
      type: 'milestone_submitted',
      title: 'Budi mensubmit milestone terakhir',
      metadata: { milestoneId: ms3Id },
    },
    {
      projectId: p1Id,
      userId: owner1Id,
      type: 'milestone_approved',
      title: 'Ahmad menyetujui milestone terakhir',
      metadata: { milestoneId: ms3Id },
    },
    {
      projectId: p2Id,
      userId: talent5Id,
      type: 'milestone_submitted',
      title: 'Gunawan mensubmit milestone Backend API',
      metadata: { milestoneId: ms6Id },
    },
    {
      projectId: p2Id,
      userId: owner1Id,
      type: 'milestone_approved',
      title: 'Ahmad menyetujui milestone Mobile UI',
      metadata: { milestoneId: ms4Id },
    },
    {
      projectId: p2Id,
      userId: adminId,
      type: 'payment_released',
      title: 'Dana Rp 7.000.000 dicairkan ke Dewi',
      metadata: { milestoneId: ms4Id, amount: 7000000 },
    },
    {
      projectId: p9Id,
      userId: owner6Id,
      type: 'dispute_opened',
      title: 'Lina membuka dispute pada proyek LMS',
      metadata: { disputeId: dispute1Id },
    },
    {
      projectId: p10Id,
      userId: adminId,
      type: 'team_formed',
      title: 'Tim proyek Platform Manajemen Proyek terbentuk',
      metadata: { teamSize: 2 },
    },
    {
      projectId: p10Id,
      userId: owner7Id,
      type: 'revision_requested',
      title: 'Agus meminta revisi pada Docker & CI/CD Setup',
      metadata: { milestoneId: ms13Id },
    },
    {
      projectId: p11Id,
      userId: owner7Id,
      type: 'project_on_hold',
      title: 'Proyek Tracking Armada di-hold',
      metadata: { reason: 'Pergantian manajemen' },
    },
    {
      projectId: p12Id,
      userId: owner8Id,
      type: 'status_changed',
      title: 'Proyek Reservasi Restoran dibatalkan',
      metadata: { fromStatus: 'brd_approved', toStatus: 'cancelled' },
    },
    {
      projectId: p13Id,
      userId: owner9Id,
      type: 'status_changed',
      title: 'Proyek Kasir UMKM selesai',
      metadata: { fromStatus: 'review', toStatus: 'completed' },
    },
    {
      projectId: p23Id,
      userId: adminId,
      type: 'talent_replaced',
      title: 'Hana Permata diterminasi dari Data Pipeline',
      metadata: { workPackageId: wp18Id },
    },
    {
      projectId: p24Id,
      userId: talent3Id,
      type: 'milestone_submitted',
      title: 'Eko mensubmit milestone Reports & PDF Export',
      metadata: { milestoneId: ms24Id },
    },
    {
      projectId: p25Id,
      userId: owner5Id,
      type: 'status_changed',
      title: 'Proyek Website Klinik selesai',
      metadata: { fromStatus: 'review', toStatus: 'completed' },
    },
  ]
  for (const a of activityData) {
    await db
      .insert(projectActivities)
      .values({ id: uuidv7(), ...a })
      .onConflictDoNothing()
  }

  // =====================================================================
  // 30. TALENT PLACEMENT REQUESTS
  // =====================================================================
  console.log('  Seeding talent placement requests...')
  await db
    .insert(talentPlacementRequests)
    .values([
      {
        id: uuidv7(),
        projectId: p4Id,
        ownerId: owner2Id,
        talentId: tp2Id,
        status: 'in_discussion' as const,
        estimatedAnnualSalary: 180000000,
        conversionFeePercentage: 12.5,
        conversionFeeAmount: 22500000,
        notes: 'Siti tertarik merekrut Dewi sebagai in-house UI/UX designer.',
      },
      {
        id: uuidv7(),
        projectId: p1Id,
        ownerId: owner1Id,
        talentId: tp1Id,
        status: 'requested' as const,
        estimatedAnnualSalary: 240000000,
        conversionFeePercentage: 10.0,
        conversionFeeAmount: 24000000,
        notes: 'Ahmad ingin Budi bergabung sebagai CTO startup KopiNusantara.',
      },
      {
        id: uuidv7(),
        projectId: p25Id,
        ownerId: owner5Id,
        talentId: tp1Id,
        status: 'declined' as const,
        estimatedAnnualSalary: 200000000,
        conversionFeePercentage: 12.5,
        conversionFeeAmount: 25000000,
        notes: 'Budi menolak karena ingin tetap freelance di platform.',
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 31. PLATFORM SETTINGS
  // =====================================================================
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

  // =====================================================================
  // 32. ADMIN AUDIT LOGS
  // =====================================================================
  console.log('  Seeding admin audit logs...')
  await db
    .insert(adminAuditLogs)
    .values([
      {
        id: uuidv7(),
        adminId: adminId,
        action: 'user.verify',
        targetType: 'user',
        targetId: talent1Id,
        details: { reason: 'CV parsing passed' },
      },
      {
        id: uuidv7(),
        adminId: adminId,
        action: 'project.status_change',
        targetType: 'project',
        targetId: p23Id,
        details: { reason: 'Talent terminated, project partially active', workPackageId: wp18Id },
      },
      {
        id: uuidv7(),
        adminId: adminId,
        action: 'dispute.review',
        targetType: 'dispute',
        targetId: dispute1Id,
        details: { status: 'under_review', assignedTo: adminId },
      },
      {
        id: uuidv7(),
        adminId: adminId,
        action: 'config.update',
        targetType: 'config',
        targetId: 'exploration_rate',
        details: { oldValue: 0.25, newValue: 0.3 },
      },
      {
        id: uuidv7(),
        adminId: admin2Id,
        action: 'user.suspend',
        targetType: 'user',
        targetId: talent6Id,
        details: { reason: 'Unresponsive on project, violated ToS' },
      },
      {
        id: uuidv7(),
        adminId: adminId,
        action: 'project.cancel',
        targetType: 'project',
        targetId: p12Id,
        details: { reason: 'Owner requested cancellation, refund processed' },
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 33. AI INTERACTIONS
  // =====================================================================
  console.log('  Seeding AI interactions...')
  const aiEntries = [
    {
      pid: p1Id,
      uid: owner1Id,
      type: 'chatbot' as const,
      model: 'gpt-4o-mini-ft-bytz-v1',
      pt: 850,
      ct: 1200,
      lat: 1800,
      cost: '0.002400',
    },
    {
      pid: p1Id,
      uid: owner1Id,
      type: 'brd_generation' as const,
      model: 'gpt-4o',
      pt: 2000,
      ct: 4500,
      lat: 12000,
      cost: '0.045000',
    },
    {
      pid: p1Id,
      uid: owner1Id,
      type: 'prd_generation' as const,
      model: 'gpt-4o',
      pt: 3000,
      ct: 8000,
      lat: 25000,
      cost: '0.080000',
    },
    {
      pid: p1Id,
      uid: owner1Id,
      type: 'matching' as const,
      model: 'catboost-v1',
      pt: 500,
      ct: 200,
      lat: 150,
      cost: '0.000100',
    },
    {
      pid: null,
      uid: talent1Id,
      type: 'cv_parsing' as const,
      model: 'gpt-4o',
      pt: 1500,
      ct: 2000,
      lat: 8000,
      cost: '0.025000',
    },
    {
      pid: null,
      uid: talent3Id,
      type: 'cv_parsing' as const,
      model: 'gpt-4o',
      pt: 1200,
      ct: 1800,
      lat: 7500,
      cost: '0.022000',
    },
    {
      pid: p7Id,
      uid: owner4Id,
      type: 'chatbot' as const,
      model: 'gpt-4o-mini-ft-bytz-v1',
      pt: 600,
      ct: 900,
      lat: 1500,
      cost: '0.001800',
    },
    {
      pid: p15Id,
      uid: owner1Id,
      type: 'chatbot' as const,
      model: 'gpt-4o-mini-ft-bytz-v1',
      pt: 700,
      ct: 1000,
      lat: 1600,
      cost: '0.002000',
    },
    {
      pid: p5Id,
      uid: owner2Id,
      type: 'brd_generation' as const,
      model: 'gpt-4o',
      pt: 1800,
      ct: 4000,
      lat: 11000,
      cost: '0.040000',
    },
    {
      pid: p10Id,
      uid: owner7Id,
      type: 'prd_generation' as const,
      model: 'gpt-4o',
      pt: 2500,
      ct: 7000,
      lat: 22000,
      cost: '0.070000',
    },
    {
      pid: null,
      uid: talent4Id,
      type: 'cv_parsing' as const,
      model: 'gpt-4o',
      pt: 1300,
      ct: 1900,
      lat: 7800,
      cost: '0.023000',
    },
    {
      pid: p20Id,
      uid: owner7Id,
      type: 'matching' as const,
      model: 'catboost-v1',
      pt: 600,
      ct: 250,
      lat: 180,
      cost: '0.000120',
    },
    {
      pid: null,
      uid: talent8Id,
      type: 'cv_parsing' as const,
      model: 'gpt-4o',
      pt: 1100,
      ct: 1700,
      lat: 7200,
      cost: '0.020000',
    },
    {
      pid: p9Id,
      uid: owner6Id,
      type: 'brd_generation' as const,
      model: 'gpt-4o',
      pt: 2100,
      ct: 4800,
      lat: 13000,
      cost: '0.048000',
    },
    {
      pid: p22Id,
      uid: owner9Id,
      type: 'brd_generation' as const,
      model: 'gpt-4o',
      pt: 1900,
      ct: 4200,
      lat: 11500,
      cost: '0.042000',
    },
  ]
  for (const ai of aiEntries) {
    await db
      .insert(aiInteractions)
      .values({
        id: uuidv7(),
        projectId: ai.pid,
        userId: ai.uid,
        interactionType: ai.type,
        model: ai.model,
        promptTokens: ai.pt,
        completionTokens: ai.ct,
        latencyMs: ai.lat,
        costUsd: ai.cost,
        status: 'success',
      })
      .onConflictDoNothing()
  }

  // =====================================================================
  // 34. DEAD LETTER EVENTS
  // =====================================================================
  console.log('  Seeding dead letter events...')
  await db
    .insert(deadLetterEvents)
    .values([
      {
        id: uuidv7(),
        originalEventId: uuidv7(),
        eventType: 'payment.released',
        payload: { projectId: p1Id, milestoneId: ms1Id },
        consumerService: 'notification-service',
        errorMessage: 'Connection timeout to email provider',
        retryCount: 3,
        reprocessed: true,
        reprocessedAt: new Date('2025-10-16'),
      },
      {
        id: uuidv7(),
        originalEventId: uuidv7(),
        eventType: 'milestone.submitted',
        payload: { projectId: p10Id, milestoneId: ms13Id },
        consumerService: 'notification-service',
        errorMessage: 'Template rendering error: missing variable',
        retryCount: 3,
        reprocessed: false,
      },
      {
        id: uuidv7(),
        originalEventId: uuidv7(),
        eventType: 'worker.registered',
        payload: { userId: talent4Id },
        consumerService: 'ai-service',
        errorMessage: 'CV parsing queue full, rejected',
        retryCount: 3,
        reprocessed: false,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 35. MILESTONE FILES
  // =====================================================================
  console.log('  Seeding milestone files...')
  await db
    .insert(milestoneFiles)
    .values([
      {
        id: uuidv7(),
        milestoneId: ms1Id,
        fileName: 'erd-kopinusantara.pdf',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms1/erd.pdf',
        fileSize: 1250000,
        mimeType: 'application/pdf',
        uploadedBy: talent1Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms3Id,
        fileName: 'e2e-test-results.pdf',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms3/test-results.pdf',
        fileSize: 850000,
        mimeType: 'application/pdf',
        uploadedBy: talent1Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms4Id,
        fileName: 'mobile-ui-screenshots.zip',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms4/screenshots.zip',
        fileSize: 3200000,
        mimeType: 'application/zip',
        uploadedBy: talent2Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms6Id,
        fileName: 'api-docs.pdf',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms6/api-docs.pdf',
        fileSize: 450000,
        mimeType: 'application/pdf',
        uploadedBy: talent5Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms8Id,
        fileName: 'travel-redesign-final.fig',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms8/redesign.fig',
        fileSize: 5100000,
        mimeType: 'application/octet-stream',
        uploadedBy: talent2Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms13Id,
        fileName: 'docker-compose.yml',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms13/docker-compose.yml',
        fileSize: 8500,
        mimeType: 'text/yaml',
        uploadedBy: talent7Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms17Id,
        fileName: 'kasir-app.apk',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms17/kasir.apk',
        fileSize: 12000000,
        mimeType: 'application/vnd.android.package-archive',
        uploadedBy: talent8Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms23Id,
        fileName: 'harvest-app-beta.apk',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms23/harvest.apk',
        fileSize: 8500000,
        mimeType: 'application/vnd.android.package-archive',
        uploadedBy: talent3Id,
      },
      {
        id: uuidv7(),
        milestoneId: ms25Id,
        fileName: 'klinik-website-preview.pdf',
        fileUrl: 'https://storage.kerjacus.id/milestones/ms25/preview.pdf',
        fileSize: 2100000,
        mimeType: 'application/pdf',
        uploadedBy: talent1Id,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 36. OUTBOX EVENTS
  // =====================================================================
  console.log('  Seeding outbox events...')
  const outboxData = [
    { agg: 'project', aggId: p1Id, evt: 'project.status.changed', pub: true },
    { agg: 'milestone', aggId: ms1Id, evt: 'milestone.approved', pub: true },
    { agg: 'payment', aggId: txn2Id, evt: 'payment.released', pub: true },
    { agg: 'project', aggId: p23Id, evt: 'project.status.changed', pub: true },
    { agg: 'worker', aggId: talent4Id, evt: 'worker.registered', pub: false },
    { agg: 'milestone', aggId: ms24Id, evt: 'milestone.submitted', pub: false },
    { agg: 'project', aggId: p9Id, evt: 'project.status.changed', pub: true },
    { agg: 'milestone', aggId: ms6Id, evt: 'milestone.submitted', pub: false },
  ]
  for (const o of outboxData) {
    await db
      .insert(outboxEvents)
      .values({
        id: uuidv7(),
        aggregateType: o.agg,
        aggregateId: o.aggId,
        eventType: o.evt,
        payload: { aggregateId: o.aggId, seed: true },
        published: o.pub,
        publishedAt: o.pub ? new Date() : null,
      })
      .onConflictDoNothing()
  }

  // =====================================================================
  // 37. PHONE VERIFICATIONS
  // =====================================================================
  console.log('  Seeding phone verifications...')
  for (const u of [
    owner1Id,
    owner2Id,
    owner3Id,
    owner5Id,
    talent1Id,
    talent2Id,
    talent3Id,
    talent5Id,
  ]) {
    const userData = usersData.find((x) => x.id === u)
    if (!userData) continue
    await db
      .insert(phoneVerifications)
      .values({
        id: uuidv7(),
        userId: u,
        phone: userData.phone,
        code: '123456',
        expiresAt: new Date(Date.now() + 300000),
        verified: true,
        attempts: 1,
      })
      .onConflictDoNothing()
  }

  // =====================================================================
  // 38. TALENT ASSESSMENTS
  // =====================================================================
  console.log('  Seeding talent assessments...')
  for (const tp of [tp1Id, tp2Id, tp3Id, tp4Id, tp5Id, tp6Id, tp7Id, tp8Id]) {
    await db
      .insert(talentAssessments)
      .values({
        id: uuidv7(),
        talentId: tp,
        stage: 'cv_parsing',
        status: 'passed',
        score: Number((Math.random() * 0.3 + 0.7).toFixed(2)),
        completedAt: new Date(),
      })
      .onConflictDoNothing()
  }

  // =====================================================================
  // 39. TALENT PENALTIES
  // =====================================================================
  console.log('  Seeding talent penalties...')
  await db
    .insert(talentPenalties)
    .values([
      {
        id: uuidv7(),
        talentId: tp6Id,
        type: 'suspension' as const,
        reason:
          'Tidak responsif selama >10 hari pada proyek Platform LMS EduStart tanpa pemberitahuan.',
        relatedProjectId: p9Id,
        issuedBy: adminId,
        appealStatus: 'pending' as const,
        appealNote: 'Ada masalah keluarga yang mendadak, mohon dipertimbangkan.',
        expiresAt: new Date('2026-04-18'),
      },
      {
        id: uuidv7(),
        talentId: tp6Id,
        type: 'warning' as const,
        reason: 'Diterminasi dari proyek Dashboard Fleet Analytics karena tidak aktif.',
        relatedProjectId: p23Id,
        issuedBy: adminId,
        appealStatus: 'none' as const,
      },
    ])
    .onConflictDoNothing()

  // =====================================================================
  // 40. USER NOTIFICATION PREFERENCES
  // =====================================================================
  console.log('  Seeding notification preferences...')
  const allUserIds = [
    adminId,
    admin2Id,
    owner1Id,
    owner2Id,
    owner3Id,
    owner4Id,
    owner5Id,
    owner6Id,
    owner7Id,
    owner8Id,
    owner9Id,
    owner10Id,
    talent1Id,
    talent2Id,
    talent3Id,
    talent4Id,
    talent5Id,
    talent6Id,
    talent7Id,
    talent8Id,
  ]
  for (const uid of allUserIds) {
    await db
      .insert(userNotificationPreferences)
      .values({
        id: uuidv7(),
        userId: uid,
        emailNotifications: Math.random() > 0.2,
        projectUpdates: Math.random() > 0.1,
        paymentAlerts: true,
      })
      .onConflictDoNothing()
  }

  // =====================================================================
  // SUMMARY
  // =====================================================================
  console.log('Seed completed successfully!')
  console.log(`
  Created:
    - 20 users (2 admins, 10 owners, 8 talents)
    - 20 auth accounts (credential with scrypt password)
    - 35 skills across 7 categories
    - 8 talent profiles (2 junior, 3 mid, 2 senior, 1 suspended) with 36 skill assignments
    - 25 projects across all 18 statuses:
        2 draft, 1 scoping, 1 brd_generated, 1 brd_approved, 1 brd_purchased,
        1 prd_generated, 1 prd_approved, 1 prd_purchased, 2 matching, 1 team_forming,
        1 matched, 3 in_progress, 1 partially_active, 1 review, 4 completed,
        1 cancelled, 1 disputed, 1 on_hold
    - 155+ project status logs (full audit trail)
    - 22 BRD documents (varied versions 1-3) + 18 PRD documents
    - 22 work packages with 3 dependencies
    - 16 project assignments
    - 14 contracts (NDA + IP transfer)
    - 27 milestones (approved, in_progress, submitted, pending, revision_requested)
    - 11 milestone comments + 5 revision requests
    - 15 tasks with 7 dependencies
    - 11 time log entries
    - 13 payment accounts + 20 transactions + 11 transaction events + 10 ledger entries
    - 8 reviews (completed projects, both directions)
    - 51 notifications (all types, all roles, 3-8 per user)
    - 15 chat conversations + 29 participants + 43 messages
    - 1 dispute (under_review)
    - 10 project applications (pending, withdrawn, rejected)
    - 15 project activities
    - 3 talent placement requests
    - 12 platform settings
    - 6 admin audit logs
    - 15 AI interactions
    - 3 dead letter events
    - 9 milestone files
    - 8 outbox events
    - 8 phone verifications
    - 8 talent assessments
    - 2 talent penalties
  `)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
