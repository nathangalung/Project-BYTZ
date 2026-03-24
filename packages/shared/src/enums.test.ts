import { describe, expect, it } from 'vitest'
import {
  AcceptanceStatus,
  AccountOwnerType,
  AccountType,
  ActivityType,
  AiInteractionType,
  AppealStatus,
  ApplicationStatus,
  AssessmentStage,
  AssessmentStatus,
  AssignmentStatus,
  AvailabilityStatus,
  ChatConversationType,
  ChatParticipantRole,
  ContractType,
  DependencyType,
  DisputeStatus,
  DocumentStatus,
  LedgerEntryType,
  Locale,
  MilestoneStatus,
  MilestoneType,
  NotificationType,
  PenaltyType,
  ProficiencyLevel,
  ProjectCategory,
  ProjectStatus,
  ResolutionType,
  ReviewType,
  RevisionRequestStatus,
  RevisionSeverity,
  SenderType,
  SkillCategory,
  TalentPlacementStatus,
  TalentTier,
  TaskStatus,
  TransactionEventType,
  TransactionStatus,
  TransactionType,
  UserRole,
  VerificationStatus,
  WorkPackageStatus,
} from './enums'

describe('UserRole', () => {
  it('has owner and talent', () => {
    expect(UserRole.OWNER).toBe('owner')
    expect(UserRole.TALENT).toBe('talent')
  })
  it('has no admin in main app', () => {
    expect(Object.values(UserRole)).toEqual(['owner', 'talent'])
  })
})

describe('Locale', () => {
  it('has id and en', () => {
    expect(Locale.ID).toBe('id')
    expect(Locale.EN).toBe('en')
  })
})

describe('ProjectCategory', () => {
  it('has all categories', () => {
    expect(ProjectCategory.WEB_APP).toBe('web_app')
    expect(ProjectCategory.MOBILE_APP).toBe('mobile_app')
    expect(ProjectCategory.UI_UX_DESIGN).toBe('ui_ux_design')
    expect(ProjectCategory.DATA_AI).toBe('data_ai')
    expect(ProjectCategory.OTHER_DIGITAL).toBe('other_digital')
  })
  it('has 5 categories', () => {
    expect(Object.keys(ProjectCategory)).toHaveLength(5)
  })
})

describe('ProjectStatus', () => {
  it('has all 18 states', () => {
    expect(Object.keys(ProjectStatus)).toHaveLength(18)
  })
  it('includes lifecycle states', () => {
    expect(ProjectStatus.DRAFT).toBe('draft')
    expect(ProjectStatus.SCOPING).toBe('scoping')
    expect(ProjectStatus.BRD_GENERATED).toBe('brd_generated')
    expect(ProjectStatus.BRD_APPROVED).toBe('brd_approved')
    expect(ProjectStatus.BRD_PURCHASED).toBe('brd_purchased')
    expect(ProjectStatus.PRD_GENERATED).toBe('prd_generated')
    expect(ProjectStatus.PRD_APPROVED).toBe('prd_approved')
    expect(ProjectStatus.PRD_PURCHASED).toBe('prd_purchased')
    expect(ProjectStatus.MATCHING).toBe('matching')
    expect(ProjectStatus.TEAM_FORMING).toBe('team_forming')
    expect(ProjectStatus.MATCHED).toBe('matched')
    expect(ProjectStatus.IN_PROGRESS).toBe('in_progress')
    expect(ProjectStatus.PARTIALLY_ACTIVE).toBe('partially_active')
    expect(ProjectStatus.REVIEW).toBe('review')
    expect(ProjectStatus.COMPLETED).toBe('completed')
    expect(ProjectStatus.CANCELLED).toBe('cancelled')
    expect(ProjectStatus.DISPUTED).toBe('disputed')
    expect(ProjectStatus.ON_HOLD).toBe('on_hold')
  })
})

describe('TalentTier', () => {
  it('has 3 tiers', () => {
    expect(Object.values(TalentTier)).toEqual(['junior', 'mid', 'senior'])
  })
})

describe('AvailabilityStatus', () => {
  it('has all statuses', () => {
    expect(AvailabilityStatus.AVAILABLE).toBe('available')
    expect(AvailabilityStatus.BUSY).toBe('busy')
    expect(AvailabilityStatus.UNAVAILABLE).toBe('unavailable')
  })
})

describe('VerificationStatus', () => {
  it('has all statuses', () => {
    expect(VerificationStatus.UNVERIFIED).toBe('unverified')
    expect(VerificationStatus.CV_PARSING).toBe('cv_parsing')
    expect(VerificationStatus.VERIFIED).toBe('verified')
    expect(VerificationStatus.SUSPENDED).toBe('suspended')
  })
})

describe('SkillCategory', () => {
  it('has 7 categories', () => {
    expect(Object.keys(SkillCategory)).toHaveLength(7)
  })
})

describe('ProficiencyLevel', () => {
  it('has 4 levels', () => {
    expect(Object.values(ProficiencyLevel)).toEqual([
      'beginner',
      'intermediate',
      'advanced',
      'expert',
    ])
  })
})

describe('MilestoneStatus', () => {
  it('has all statuses', () => {
    expect(MilestoneStatus.PENDING).toBe('pending')
    expect(MilestoneStatus.IN_PROGRESS).toBe('in_progress')
    expect(MilestoneStatus.SUBMITTED).toBe('submitted')
    expect(MilestoneStatus.REVISION_REQUESTED).toBe('revision_requested')
    expect(MilestoneStatus.APPROVED).toBe('approved')
    expect(MilestoneStatus.REJECTED).toBe('rejected')
  })
})

describe('MilestoneType', () => {
  it('has individual and integration', () => {
    expect(MilestoneType.INDIVIDUAL).toBe('individual')
    expect(MilestoneType.INTEGRATION).toBe('integration')
  })
})

describe('WorkPackageStatus', () => {
  it('has 7 statuses', () => {
    expect(Object.keys(WorkPackageStatus)).toHaveLength(7)
  })
})

describe('AssignmentStatus', () => {
  it('has 4 statuses', () => {
    expect(Object.values(AssignmentStatus)).toEqual([
      'active',
      'completed',
      'terminated',
      'replaced',
    ])
  })
})

describe('AcceptanceStatus', () => {
  it('has 3 statuses', () => {
    expect(Object.values(AcceptanceStatus)).toEqual(['pending', 'accepted', 'declined'])
  })
})

describe('TransactionType', () => {
  it('includes all payment types', () => {
    expect(TransactionType.ESCROW_IN).toBe('escrow_in')
    expect(TransactionType.ESCROW_RELEASE).toBe('escrow_release')
    expect(TransactionType.BRD_PAYMENT).toBe('brd_payment')
    expect(TransactionType.PRD_PAYMENT).toBe('prd_payment')
    expect(TransactionType.REFUND).toBe('refund')
    expect(TransactionType.PARTIAL_REFUND).toBe('partial_refund')
    expect(TransactionType.REVISION_FEE).toBe('revision_fee')
    expect(TransactionType.TALENT_PLACEMENT_FEE).toBe('talent_placement_fee')
  })
  it('has 8 types', () => {
    expect(Object.keys(TransactionType)).toHaveLength(8)
  })
})

describe('TransactionStatus', () => {
  it('has 5 statuses', () => {
    expect(Object.keys(TransactionStatus)).toHaveLength(5)
  })
})

describe('DocumentStatus', () => {
  it('has 4 statuses', () => {
    expect(Object.values(DocumentStatus)).toEqual(['draft', 'review', 'approved', 'paid'])
  })
})

describe('ApplicationStatus', () => {
  it('has 4 statuses', () => {
    expect(Object.values(ApplicationStatus)).toEqual([
      'pending',
      'accepted',
      'rejected',
      'withdrawn',
    ])
  })
})

describe('DisputeStatus', () => {
  it('has 5 statuses', () => {
    expect(Object.keys(DisputeStatus)).toHaveLength(5)
  })
})

describe('ResolutionType', () => {
  it('has 3 types', () => {
    expect(Object.values(ResolutionType)).toEqual(['funds_to_talent', 'funds_to_owner', 'split'])
  })
})

describe('ReviewType', () => {
  it('has 2 types', () => {
    expect(ReviewType.OWNER_TO_TALENT).toBe('owner_to_talent')
    expect(ReviewType.TALENT_TO_OWNER).toBe('talent_to_owner')
  })
})

describe('NotificationType', () => {
  it('has 8 types', () => {
    expect(Object.keys(NotificationType)).toHaveLength(8)
  })
})

describe('ChatConversationType', () => {
  it('has 5 types', () => {
    expect(Object.keys(ChatConversationType)).toHaveLength(5)
  })
})

describe('SenderType', () => {
  it('has user, ai, system', () => {
    expect(Object.values(SenderType)).toEqual(['user', 'ai', 'system'])
  })
})

describe('TaskStatus', () => {
  it('has 3 statuses', () => {
    expect(Object.values(TaskStatus)).toEqual(['pending', 'in_progress', 'completed'])
  })
})

describe('DependencyType', () => {
  it('has 3 types', () => {
    expect(Object.keys(DependencyType)).toHaveLength(3)
  })
})

describe('RevisionSeverity', () => {
  it('has minor, moderate, major', () => {
    expect(Object.values(RevisionSeverity)).toEqual(['minor', 'moderate', 'major'])
  })
})

describe('RevisionRequestStatus', () => {
  it('has 5 statuses', () => {
    expect(Object.keys(RevisionRequestStatus)).toHaveLength(5)
  })
})

describe('PenaltyType', () => {
  it('has 4 types', () => {
    expect(Object.values(PenaltyType)).toEqual(['warning', 'rating_penalty', 'suspension', 'ban'])
  })
})

describe('AppealStatus', () => {
  it('has 4 statuses', () => {
    expect(Object.values(AppealStatus)).toEqual(['none', 'pending', 'accepted', 'rejected'])
  })
})

describe('AssessmentStage', () => {
  it('has cv_parsing only', () => {
    expect(Object.values(AssessmentStage)).toEqual(['cv_parsing'])
  })
})

describe('AssessmentStatus', () => {
  it('has 4 statuses', () => {
    expect(Object.keys(AssessmentStatus)).toHaveLength(4)
  })
})

describe('AccountOwnerType', () => {
  it('has 4 types', () => {
    expect(Object.values(AccountOwnerType)).toEqual(['platform', 'owner', 'talent', 'escrow'])
  })
})

describe('AccountType', () => {
  it('has 4 types', () => {
    expect(Object.values(AccountType)).toEqual(['asset', 'liability', 'revenue', 'expense'])
  })
})

describe('LedgerEntryType', () => {
  it('has debit and credit', () => {
    expect(LedgerEntryType.DEBIT).toBe('debit')
    expect(LedgerEntryType.CREDIT).toBe('credit')
  })
})

describe('ContractType', () => {
  it('has 2 types', () => {
    expect(ContractType.STANDARD_NDA).toBe('standard_nda')
    expect(ContractType.IP_TRANSFER).toBe('ip_transfer')
  })
})

describe('TalentPlacementStatus', () => {
  it('has 5 statuses', () => {
    expect(Object.keys(TalentPlacementStatus)).toHaveLength(5)
  })
})

describe('ActivityType', () => {
  it('has 18 activity types', () => {
    expect(Object.keys(ActivityType)).toHaveLength(18)
  })
  it('includes key activities', () => {
    expect(ActivityType.MESSAGE_SENT).toBe('message_sent')
    expect(ActivityType.MILESTONE_SUBMITTED).toBe('milestone_submitted')
    expect(ActivityType.PAYMENT_RELEASED).toBe('payment_released')
    expect(ActivityType.DISPUTE_OPENED).toBe('dispute_opened')
  })
})

describe('AiInteractionType', () => {
  it('has 6 types', () => {
    expect(Object.keys(AiInteractionType)).toHaveLength(6)
  })
})

describe('ChatParticipantRole', () => {
  it('has member and moderator', () => {
    expect(ChatParticipantRole.MEMBER).toBe('member')
    expect(ChatParticipantRole.MODERATOR).toBe('moderator')
  })
})

describe('TransactionEventType', () => {
  it('has 7 event types', () => {
    expect(Object.keys(TransactionEventType)).toHaveLength(7)
  })
})
