import { useQuery } from '@tanstack/react-query'
import { Github, Globe, Linkedin, Palette } from 'lucide-react'
import { apiUrl } from '@/lib/api'

export type TalentProfile = {
  id: string
  userId: string
  bio: string
  yearsOfExperience: number
  tier: 'junior' | 'mid' | 'senior'
  educationUniversity: string | null
  educationMajor: string | null
  educationYear: number | null
  cvFileUrl: string | null
  portfolioLinks: { platform: string; url: string }[]
  availabilityStatus: 'available' | 'busy' | 'unavailable'
  verificationStatus: 'unverified' | 'cv_parsing' | 'verified' | 'suspended'
  domainExpertise: string[]
  totalProjectsCompleted: number
  totalProjectsActive: number
  averageRating: number | null
  skills: {
    name: string
    category: string
    proficiencyLevel: string
    isPrimary: boolean
  }[]
}

export type ReviewItem = {
  id: string
  projectId: string
  rating: number
  comment: string
  createdAt: string
}

export function useTalentRatings() {
  return useQuery({
    queryKey: ['talent-ratings'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/v1/talents/ratings'), {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load ratings')
      const data = await res.json()
      return (data.data ?? []) as ReviewItem[]
    },
  })
}

export const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  GitHub: <Github className="h-4 w-4" />,
  LinkedIn: <Linkedin className="h-4 w-4" />,
  Dribbble: <Palette className="h-4 w-4" />,
  Behance: <Palette className="h-4 w-4" />,
  Website: <Globe className="h-4 w-4" />,
}

export const VERIFICATION_COLORS: Record<string, string> = {
  verified: 'bg-success-500/10 text-success-600',
  cv_parsing: 'bg-warning-500/10 text-warning-600',
  unverified: 'bg-surface-container text-on-surface-muted',
  suspended: 'bg-error-500/10 text-error-600',
}

export const PROFICIENCY_COLORS: Record<string, string> = {
  beginner: 'bg-surface-container text-on-surface-muted',
  intermediate: 'bg-primary-600/15 text-primary-600',
  advanced: 'bg-success-500/10 text-success-600',
  expert: 'bg-accent-coral-500/10 text-accent-coral-600',
}

export const SKILL_CATEGORY_ORDER = [
  'frontend',
  'backend',
  'mobile',
  'design',
  'data',
  'devops',
  'other',
]
