import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Download,
  Eye,
  File,
  FileCheck,
  FileText,
  FolderOpen,
  Loader2,
  PenLine,
  Receipt,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useProject,
  useProjectBrd,
  useProjectContracts,
  useProjectInvoices,
  useProjectPrd,
  useProjectTransactions,
  useSignContract,
} from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

export const Route = createFileRoute('/_authenticated/projects/$projectId/documents')({
  component: DocumentsPage,
})

async function uploadFileToS3(file: File): Promise<string> {
  const presignRes = await fetch(apiUrl('/api/v1/upload/presigned-url'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileType: file.type, folder: 'document' }),
  })
  if (!presignRes.ok) throw new Error('presign failed')
  const presignJson = (await presignRes.json()) as { data: { url: string } }
  const { url } = presignJson.data
  await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
  return url.split('?')[0]
}

type DocumentItem = {
  id: string
  title: string
  type: 'brd' | 'prd' | 'contract' | 'invoice' | 'other'
  status: 'draft' | 'review' | 'approved' | 'paid' | 'signed' | 'pending'
  date: string
  version: number | null
  fileUrl: string | null
  linkTo: string | null
}

const DOC_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  brd: {
    icon: <FileText className="h-6 w-6" />,
    color: 'text-accent-coral-600',
    bgColor: 'bg-accent-coral-500/10',
  },
  prd: {
    icon: <FileCheck className="h-6 w-6" />,
    color: 'text-primary-600',
    bgColor: 'bg-primary-600/10',
  },
  contract: {
    icon: <File className="h-6 w-6" />,
    color: 'text-primary-600',
    bgColor: 'bg-primary-600/10',
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

const DOC_STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
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
    color: 'bg-primary-600/15 text-primary-600',
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

function DocumentsPage() {
  const { t } = useTranslation('document')
  const { projectId } = Route.useParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: brd } = useProjectBrd(projectId)
  const { data: prd } = useProjectPrd(projectId)
  const { data: contracts = [] } = useProjectContracts(projectId)
  const { data: projectTxns = [] } = useProjectTransactions(projectId)
  const { data: projectInvoices = [] } = useProjectInvoices(projectId)
  const signContract = useSignContract()
  const { addToast } = useToastStore()
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ name: string; size: number; type: string; url: string }>
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Build document list from real data + mock contracts/invoices
  const documents: DocumentItem[] = []

  if (brd) {
    documents.push({
      id: brd.id,
      title: t('brd_document'),
      type: 'brd',
      status: brd.status as DocumentItem['status'],
      date: brd.updatedAt ?? brd.createdAt,
      version: brd.version,
      fileUrl: null,
      linkTo: `/projects/${projectId}/brd`,
    })
  }

  if (prd) {
    documents.push({
      id: prd.id,
      title: t('prd_document'),
      type: 'prd',
      status: prd.status as DocumentItem['status'],
      date: prd.updatedAt ?? prd.createdAt,
      version: prd.version,
      fileUrl: null,
      linkTo: `/projects/${projectId}/prd`,
    })
  }

  // Contracts from DB
  for (const contract of contracts) {
    const label = contract.type === 'standard_nda' ? 'NDA' : 'IP Transfer Agreement'
    const isSigned = contract.signedByOwner && contract.signedByTalent
    documents.push({
      id: contract.id,
      title: `${label} - ${project?.title ?? 'Project'}`,
      type: 'contract',
      status: isSigned ? 'signed' : 'pending',
      date: contract.signedAt ?? contract.createdAt,
      version: 1,
      fileUrl: null,
      linkTo: null,
    })
  }

  // Build milestoneId -> pdfUrl lookup from invoice records
  const invoicePdfByMilestone = new Map(
    projectInvoices.filter((i) => !i.isAdminCopy).map((i) => [i.milestoneId, i.pdfUrl]),
  )

  // Invoices from DB (escrow_release + brd/prd payments)
  const invoiceTxns = projectTxns.filter(
    (tx) => tx.type === 'escrow_release' || tx.type === 'brd_payment' || tx.type === 'prd_payment',
  )
  for (const tx of invoiceTxns) {
    const typeLabel =
      tx.type === 'brd_payment' ? 'BRD' : tx.type === 'prd_payment' ? 'PRD' : 'Milestone'
    const pdfUrl = tx.milestoneId ? (invoicePdfByMilestone.get(tx.milestoneId) ?? null) : null
    documents.push({
      id: tx.id,
      title: `Invoice - ${typeLabel}`,
      type: 'invoice',
      status: tx.status === 'completed' ? 'paid' : 'pending',
      date: tx.createdAt,
      version: null,
      fileUrl: pdfUrl,
      linkTo: null,
    })
  }

  // Include uploaded files as "other" with real S3 URLs
  for (const file of uploadedFiles) {
    documents.push({
      id: `upload-${file.name}`,
      title: file.name,
      type: 'other',
      status: 'draft',
      date: new Date().toISOString(),
      version: null,
      fileUrl: file.url,
      linkTo: null,
    })
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      setUploading(true)
      Promise.all(
        files.map(async (f) => {
          const url = await uploadFileToS3(f)
          return { name: f.name, size: f.size, type: f.type, url }
        }),
      )
        .then((uploaded) => {
          setUploadedFiles((prev) => [...prev, ...uploaded])
        })
        .catch(() => {
          addToast('error', t('upload_failed'))
        })
        .finally(() => {
          setUploading(false)
        })
    },
    [addToast, t],
  )

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploading(true)
    Promise.all(
      files.map(async (f) => {
        const url = await uploadFileToS3(f)
        return { name: f.name, size: f.size, type: f.type, url }
      }),
    )
      .then((uploaded) => {
        setUploadedFiles((prev) => [...prev, ...uploaded])
      })
      .catch(() => {
        addToast('error', t('upload_failed'))
      })
      .finally(() => {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      })
  }

  async function handleSignContract(contractId: string) {
    try {
      await signContract.mutateAsync({ contractId, projectId })
      addToast('success', t('sign_success'))
    } catch {
      addToast('error', t('upload_failed'))
    }
  }

  function handleRemoveUpload(fileName: string) {
    setUploadedFiles((prev) => prev.filter((f) => f.name !== fileName))
  }

  if (projectLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    )
  }

  // Group documents by type for empty states
  const hasBrd = documents.some((d) => d.type === 'brd')
  const hasPrd = documents.some((d) => d.type === 'prd')
  const contractDocs = documents.filter((d) => d.type === 'contract')
  const invoiceDocs = documents.filter((d) => d.type === 'invoice')

  return (
    <div className="p-6 lg:p-8">
      {/* Breadcrumb */}
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-on-surface-muted hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" />
        {project?.title ?? 'Project'}
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary-600">{t('documents')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">{t('documents_for_project')}</p>
      </div>

      {/* Document sections */}
      <div className="space-y-8">
        {/* BRD / PRD section */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-primary-600">
            {t('brd_document')} / {t('prd_document')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {hasBrd ? (
              documents
                .filter((d) => d.type === 'brd')
                .map((doc) => <DocumentCard key={doc.id} doc={doc} />)
            ) : (
              <EmptyDocCard
                icon={<FileText className="h-8 w-8 text-on-surface-muted" />}
                message={t('no_brd')}
                linkTo={`/projects/${projectId}/scoping`}
                linkLabel={t('go_to_brd')}
              />
            )}
            {hasPrd ? (
              documents
                .filter((d) => d.type === 'prd')
                .map((doc) => <DocumentCard key={doc.id} doc={doc} />)
            ) : (
              <EmptyDocCard
                icon={<FileCheck className="h-8 w-8 text-on-surface-muted" />}
                message={t('no_prd')}
              />
            )}
          </div>
        </section>

        {/* Contracts section */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-primary-600">{t('contract')}</h2>
          {contractDocs.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {contractDocs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onSign={doc.status === 'pending' ? () => handleSignContract(doc.id) : undefined}
                  isSigning={signContract.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-outline-dim/20 p-8 text-center">
              <File className="mx-auto mb-2 h-8 w-8 text-on-surface-muted" />
              <p className="text-sm text-on-surface-muted">{t('no_contracts')}</p>
            </div>
          )}
        </section>

        {/* Invoices section */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-primary-600">{t('invoice')}</h2>
          {invoiceDocs.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {invoiceDocs.map((doc) => (
                <DocumentCard key={doc.id} doc={doc} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-outline-dim/20 p-8 text-center">
              <Receipt className="mx-auto mb-2 h-8 w-8 text-on-surface-muted" />
              <p className="text-sm text-on-surface-muted">{t('no_invoices')}</p>
            </div>
          )}
        </section>

        {/* Upload area */}
        <section>
          <h2 className="mb-4 text-sm font-semibold text-primary-600">{t('upload_document')}</h2>

          {/* Uploaded files list */}
          {uploadedFiles.length > 0 && (
            <div className="mb-4 space-y-2">
              {uploadedFiles.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center gap-3 rounded-lg border border-outline-dim/20 bg-surface-bright p-3"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container">
                    <File className="h-4 w-4 text-on-surface-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-primary-600">{file.name}</p>
                    <p className="text-xs text-on-surface-muted">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveUpload(file.name)}
                    className="rounded p-1 text-on-surface-muted hover:text-error-500"
                    aria-label="Remove"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Drop zone */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone requires drag events */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'rounded-xl border-2 border-dashed p-8 text-center transition-colors',
              isDragging
                ? 'border-primary-500/40 bg-primary-600/5'
                : 'border-outline-dim/20 bg-surface-bright/50 hover:border-outline-dim/30',
            )}
          >
            <Upload
              className={cn(
                'mx-auto mb-3 h-8 w-8',
                isDragging ? 'text-primary-500' : 'text-on-surface-muted',
              )}
            />
            <p className="mb-1 text-sm font-medium text-on-surface-muted">{t('drag_drop_files')}</p>
            <p className="mb-4 text-xs text-on-surface-muted">{t('file_types_allowed')}</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.png,.jpg,.jpeg"
              disabled={uploading}
              onChange={handleFileSelect}
              className="hidden"
              id="doc-upload-input"
            />
            <label
              htmlFor="doc-upload-input"
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-outline-dim/20 bg-surface-bright px-4 py-2 text-sm font-medium text-primary-600 shadow-sm hover:bg-surface-container',
                uploading && 'pointer-events-none opacity-50',
              )}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t('upload_document')}
            </label>
          </div>
        </section>
      </div>
    </div>
  )
}

function DocumentCard({
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

function EmptyDocCard({
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
