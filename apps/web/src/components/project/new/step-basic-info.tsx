import { CheckCircle, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useUploadPresignedUrl } from '@/hooks/use-talent'
import { cn } from '@/lib/utils'
import { CATEGORIES, type FormData, INPUT_BASE, INPUT_ERROR, INPUT_NORMAL } from './shared'

export function Step1BasicInfo({
  form,
  errors,
  updateField,
  t,
  projectType,
  setProjectType,
  companyName,
  setCompanyName,
  companyRole,
  setCompanyRole,
  onDocumentUploaded,
}: {
  form: FormData
  errors: Record<string, string>
  updateField: (field: keyof FormData, value: string | string[]) => void
  t: ReturnType<typeof import('react-i18next').useTranslation>[0]
  projectType: 'individual' | 'company'
  setProjectType: (v: 'individual' | 'company') => void
  companyName: string
  setCompanyName: (v: string) => void
  companyRole: string
  setCompanyRole: (v: string) => void
  onDocumentUploaded: (key: string) => void
}) {
  const uploadPresigned = useUploadPresignedUrl()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [docFile, setDocFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const handleFileChange = (file: File | null) => {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'docx'].includes(ext ?? '')) {
      setUploadError(t('upload_invalid_type'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t('upload_file_too_large'))
      return
    }
    setUploadError('')
    setDocFile(file)
    handleUpload(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFileChange(e.dataTransfer.files[0] ?? null)
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadError('')
    try {
      const presigned = await uploadPresigned.mutateAsync({
        fileName: file.name,
        fileType: file.type,
        folder: 'document',
      })
      await fetch(presigned.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      onDocumentUploaded(presigned.key)
    } catch {
      setUploadError(t('upload_failed'))
      setDocFile(null)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-primary-600">{t('basic_info')}</h2>

      {/* Document type selector */}
      <div>
        <label htmlFor="doc-type" className="mb-2 block text-sm font-medium text-on-surface">
          {t('document_type')} <span className="text-error-500">*</span>
        </label>
        <div id="doc-type" className="grid grid-cols-3 gap-3">
          {(
            [
              { value: 'brd' as const, label: t('doc_type_brd') },
              { value: 'prd' as const, label: t('doc_type_prd') },
              { value: 'both' as const, label: t('doc_type_both') },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateField('documentType', opt.value)}
              className={`rounded-xl border-2 p-3 text-center text-sm font-semibold transition-all ${form.documentType === opt.value ? 'border-primary-500 bg-primary-500/5 text-primary-600' : 'border-outline-dim/20 text-on-surface-muted hover:border-outline-dim/40'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {errors.documentType && (
          <p className="mt-1 text-xs text-error-500">{errors.documentType}</p>
        )}
      </div>

      {/* Document upload (required) */}
      <div>
        <label htmlFor="doc-upload" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('upload_existing_document')}
          <span className="text-error-500"> *</span>
        </label>
        <input
          id="doc-upload"
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
        {form.documentFileKey && docFile ? (
          <div className="flex items-center gap-3 rounded-lg border border-success-500/30 bg-success-500/5 px-4 py-3">
            <CheckCircle className="h-5 w-5 shrink-0 text-success-600" />
            <span className="flex-1 truncate text-sm text-on-surface">{docFile.name}</span>
            <button
              type="button"
              onClick={() => {
                setDocFile(null)
                onDocumentUploaded('')
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="text-on-surface-muted hover:text-error-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            disabled={uploading}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
              errors.documentFileKey
                ? 'border-error-500/50 bg-error-500/5'
                : 'border-outline-dim/30 bg-surface-container hover:border-primary-500/40 hover:bg-primary-500/5',
            )}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            ) : (
              <Upload className="h-6 w-6 text-on-surface-muted" />
            )}
            <span className="text-sm text-on-surface-muted">
              {uploading ? t('uploading') : t('drag_drop_document')}
            </span>
            <span className="text-xs text-outline">PDF, DOCX</span>
          </button>
        )}
        {uploadError && <p className="mt-1 text-xs text-error-500">{uploadError}</p>}
        {!uploadError && errors.documentFileKey && (
          <p className="mt-1 text-xs text-error-500">{errors.documentFileKey}</p>
        )}
      </div>

      {/* Individual or Company */}
      <div>
        <label htmlFor="project-type" className="mb-2 block text-sm font-medium text-on-surface">
          {t('project_type')}
        </label>
        <div id="project-type" className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setProjectType('individual')}
            className={`rounded-xl border-2 p-3 text-center text-sm font-semibold transition-all ${projectType === 'individual' ? 'border-primary-500 bg-primary-500/5 text-primary-600' : 'border-outline-dim/20 text-on-surface-muted hover:border-outline-dim/40'}`}
          >
            {t('type_individual')}
          </button>
          <button
            type="button"
            onClick={() => setProjectType('company')}
            className={`rounded-xl border-2 p-3 text-center text-sm font-semibold transition-all ${projectType === 'company' ? 'border-primary-500 bg-primary-500/5 text-primary-600' : 'border-outline-dim/20 text-on-surface-muted hover:border-outline-dim/40'}`}
          >
            {t('type_company')}
          </button>
        </div>
      </div>

      {projectType === 'company' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="company-name"
              className="mb-1.5 block text-sm font-medium text-on-surface"
            >
              {t('company_name')}
            </label>
            <input
              id="company-name"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t('company_name_placeholder')}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            />
          </div>
          <div>
            <label
              htmlFor="company-role"
              className="mb-1.5 block text-sm font-medium text-on-surface"
            >
              {t('company_role')}
            </label>
            <input
              id="company-role"
              type="text"
              value={companyRole}
              onChange={(e) => setCompanyRole(e.target.value)}
              placeholder={t('company_role_placeholder')}
              className={cn(INPUT_BASE, INPUT_NORMAL)}
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('title')} <span className="text-error-500">*</span>
        </label>
        <input
          id="title"
          type="text"
          value={form.title}
          onChange={(e) => updateField('title', e.target.value)}
          placeholder={t('title_placeholder')}
          className={cn(INPUT_BASE, errors.title ? INPUT_ERROR : INPUT_NORMAL)}
        />
        {errors.title && <p className="mt-1 text-xs text-error-500">{errors.title}</p>}
      </div>

      <div>
        <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('category')} <span className="text-error-500">*</span>
        </label>
        <select
          id="category"
          value={form.category}
          onChange={(e) => updateField('category', e.target.value)}
          className={cn(
            INPUT_BASE,
            !form.category && 'text-on-surface-muted',
            errors.category ? INPUT_ERROR : INPUT_NORMAL,
          )}
        >
          <option value="" disabled>
            {t('category_placeholder')}
          </option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {t(cat, cat)}
            </option>
          ))}
        </select>
        {errors.category && <p className="mt-1 text-xs text-error-500">{errors.category}</p>}
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-on-surface">
          {t('description')} <span className="text-error-500">*</span>
        </label>
        <textarea
          id="description"
          rows={5}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
          placeholder={t('description_placeholder')}
          className={cn(INPUT_BASE, 'resize-none', errors.description ? INPUT_ERROR : INPUT_NORMAL)}
        />
        {errors.description && <p className="mt-1 text-xs text-error-500">{errors.description}</p>}
      </div>
    </div>
  )
}

/* ── Step 2: Budget & Timeline ── */
