import { AlertTriangle, FileText, Loader2, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectDisputes } from '@/hooks/use-projects'
import { cn, formatDate } from '@/lib/utils'
import { DISPUTE_STATUS_COLORS, RESOLUTION_TYPE_ICONS } from './shared'

export function DisputeSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project')
  const { data: disputes = [], isLoading } = useProjectDisputes(projectId)

  if (isLoading) {
    return (
      <div className="mt-8 rounded-xl bg-surface-bright p-6 border border-error-500/30">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 rounded-xl bg-surface-bright p-6 border border-error-500/30">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-accent-coral-600">
        <AlertTriangle className="h-5 w-5" />
        {t('dispute_section_title')}
      </h3>

      {disputes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <Shield className="mb-3 h-8 w-8 text-on-surface-muted" />
          <p className="text-sm text-on-surface-muted">{t('no_disputes')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className="rounded-lg border border-error-500/20 bg-error-500/5 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        DISPUTE_STATUS_COLORS[dispute.status] ?? DISPUTE_STATUS_COLORS.open,
                      )}
                    >
                      {t(`dispute_status_${dispute.status}`)}
                    </span>
                    <span className="text-xs text-on-surface-muted">
                      {formatDate(dispute.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-on-surface leading-relaxed">{dispute.reason}</p>

                  {dispute.evidenceUrls && dispute.evidenceUrls.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-on-surface-muted">
                        {t('dispute_evidence')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {dispute.evidenceUrls.map((url, i) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-surface-container px-2.5 py-1 text-xs text-primary-600 hover:underline"
                          >
                            <FileText className="h-3 w-3" />
                            {t('evidence_item', { n: i + 1 })}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {dispute.status === 'resolved' && dispute.resolution && (
                    <div className="mt-3 rounded-md bg-success-500/10 border border-success-500/20 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        {dispute.resolutionType && RESOLUTION_TYPE_ICONS[dispute.resolutionType]}
                        <span className="text-xs font-medium text-success-600">
                          {t(`resolution_type_${dispute.resolutionType ?? 'split'}`)}
                        </span>
                        {dispute.resolvedAt && (
                          <span className="text-xs text-on-surface-muted">
                            · {formatDate(dispute.resolvedAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-on-surface-muted">{dispute.resolution}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
