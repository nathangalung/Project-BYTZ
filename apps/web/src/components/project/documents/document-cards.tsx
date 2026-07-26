import { Link } from '@tanstack/react-router'
import { Download, Eye, FolderOpen, Loader2, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn, formatDate } from '@/lib/utils'
import { DOC_STATUS_CONFIG, DOC_TYPE_CONFIG, type DocumentItem } from './shared'

export function DocumentCard({
  doc,
  onSign,
  isSigning = false,
}: {
  doc: DocumentItem
  onSign?: () => void
  isSigning?: boolean
}) {
  const { t } = useTranslation('document')
  const typeConfig = DOC_TYPE_CONFIG[doc.type] ?? DOC_TYPE_CONFIG.other
  const statusConfig = DOC_STATUS_CONFIG[doc.status] ?? DOC_STATUS_CONFIG.draft

  const cardContent = (
    <div className="flex items-start gap-4 rounded-xl border border-outline-dim/20 bg-surface-bright p-5 transition-shadow hover:shadow-md">
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-lg',
          typeConfig.bgColor,
        )}
      >
        <span className={typeConfig.color}>{typeConfig.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-primary-600">{doc.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {/* Type badge */}
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase',
              typeConfig.bgColor,
              typeConfig.color,
            )}
          >
            {doc.type}
          </span>
          {/* Status badge */}
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              statusConfig.color,
            )}
          >
            {statusConfig.icon}
            {t(`status_${doc.status}`)}
          </span>
          {/* Version */}
          {doc.version && (
            <span className="text-[10px] text-on-surface-muted">
              {t('version')} {doc.version}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-on-surface-muted">
          {t('date')}: {formatDate(doc.date)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {onSign && (
          <button
            type="button"
            disabled={isSigning}
            onClick={(e) => {
              e.stopPropagation()
              onSign()
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary-600 px-2.5 text-xs font-semibold text-white hover:bg-primary-600/90 disabled:opacity-50"
          >
            {isSigning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PenLine className="h-3.5 w-3.5" />
            )}
            {t('sign')}
          </button>
        )}
        {doc.linkTo && (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-muted hover:bg-surface-container hover:text-on-surface-muted">
            <Eye className="h-4 w-4" />
          </span>
        )}
        {doc.fileUrl ? (
          <a
            href={doc.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-muted hover:bg-surface-container hover:text-on-surface-muted"
            aria-label={t('download')}
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-4 w-4" />
          </a>
        ) : (
          <span className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-lg text-on-surface-muted/40">
            <Download className="h-4 w-4" />
          </span>
        )}
      </div>
    </div>
  )

  if (doc.linkTo) {
    return <Link to={doc.linkTo as never}>{cardContent}</Link>
  }

  return cardContent
}

export function EmptyDocCard({
  icon,
  message,
  linkTo,
  linkLabel,
}: {
  icon: React.ReactNode
  message: string
  linkTo?: string
  linkLabel?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-dim/20 bg-surface-bright/50 p-8 text-center">
      {icon}
      <p className="mt-2 text-sm text-on-surface-muted">{message}</p>
      {linkTo && linkLabel && (
        <Link
          to={linkTo}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-600"
        >
          <FolderOpen className="h-4 w-4" />
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
