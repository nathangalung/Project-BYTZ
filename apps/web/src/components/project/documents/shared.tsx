import { AlertCircle, CheckCircle, Clock, File, FileCheck, FileText, Receipt } from 'lucide-react'

export type DocumentItem = {
  id: string
  title: string
  type: 'brd' | 'prd' | 'contract' | 'invoice' | 'other'
  status: 'draft' | 'review' | 'approved' | 'paid' | 'signed' | 'pending'
  date: string
  version: number | null
  fileUrl: string | null
  linkTo: string | null
}

export const DOC_TYPE_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; bgColor: string }
> = {
  brd: {
    icon: <FileText className="h-6 w-6" />,
    color: 'text-accent-coral-600',
    bgColor: 'bg-accent-coral-500/10',
  },
  prd: {
    icon: <FileCheck className="h-6 w-6" />,
    color: 'text-brand-text',
    bgColor: 'bg-brand-accent/10',
  },
  contract: {
    icon: <File className="h-6 w-6" />,
    color: 'text-brand-text',
    bgColor: 'bg-brand-accent/10',
  },
  invoice: {
    icon: <Receipt className="h-6 w-6" />,
    color: 'text-warning-600',
    bgColor: 'bg-warning-500/10',
  },
  other: {
    icon: <File className="h-6 w-6" />,
    color: 'text-on-surface-muted',
    bgColor: 'bg-surface-container',
  },
}

export const DOC_STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  draft: {
    color: 'bg-surface-container text-on-surface-muted',
    icon: <Clock className="h-3 w-3" />,
  },
  review: {
    color: 'bg-warning-500/10 text-warning-600',
    icon: <AlertCircle className="h-3 w-3" />,
  },
  approved: {
    color: 'bg-success-500/10 text-success-600',
    icon: <CheckCircle className="h-3 w-3" />,
  },
  paid: {
    color: 'bg-brand-accent/15 text-brand-text',
    icon: <CheckCircle className="h-3 w-3" />,
  },
  signed: {
    color: 'bg-success-500/10 text-success-600',
    icon: <CheckCircle className="h-3 w-3" />,
  },
  pending: {
    color: 'bg-surface-container text-on-surface-muted',
    icon: <Clock className="h-3 w-3" />,
  },
}
