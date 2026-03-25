import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Bot,
  Calendar,
  ClipboardList,
  FileUp,
  Info,
  Loader2,
  Send,
  Sparkles,
  Tag,
  User,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useScopingChat } from '@/hooks/use-chat'
import { useGenerateBrd, useProject } from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/scoping')({
  component: ScopingPage,
})

const WELCOME_MESSAGES = [
  {
    id: 'dm-1',
    senderType: 'system' as const,
    content: 'AI Scoping Assistant is ready to help you define your project.',
    createdAt: '2026-03-15T08:00:00Z',
  },
  {
    id: 'dm-2',
    senderType: 'user' as const,
    content:
      'I need an e-commerce platform for selling artisan coffee beans. It should support subscriptions, a product catalog with filters, and integrated payments via Midtrans.',
    createdAt: '2026-03-15T08:01:00Z',
  },
  {
    id: 'dm-3',
    senderType: 'ai' as const,
    content:
      'Great starting point! To build a comprehensive BRD, I need a few more details. Who is your target audience -- individual consumers, cafes, or both? And do you have an existing brand identity or will you need UI/UX design from scratch?',
    createdAt: '2026-03-15T08:01:30Z',
  },
  {
    id: 'dm-4',
    senderType: 'user' as const,
    content:
      'Target is individual consumers and small cafes. We already have a brand guide with logo and color palette, but we need the full UI/UX designed for web and responsive mobile.',
    createdAt: '2026-03-15T08:02:00Z',
  },
  {
    id: 'dm-5',
    senderType: 'ai' as const,
    content:
      'Understood. For the subscription feature, should customers be able to choose delivery frequency (weekly, bi-weekly, monthly)? Also, do you need inventory management on the admin side, or will that be handled externally?',
    createdAt: '2026-03-15T08:02:45Z',
  },
  {
    id: 'dm-6',
    senderType: 'user' as const,
    content:
      'Yes, flexible delivery frequency is a must. We need basic inventory management built in -- stock levels, low stock alerts, and the ability to mark items as out of stock.',
    createdAt: '2026-03-15T08:03:30Z',
  },
  {
    id: 'dm-7',
    senderType: 'ai' as const,
    content:
      'Perfect. The scope is becoming clear. A few final questions: do you need a customer review/rating system? And should there be a loyalty or rewards program? Also, any specific shipping integrations (JNE, SiCepat, etc.)?',
    createdAt: '2026-03-15T08:04:15Z',
  },
]

function ScopingPage() {
  const { t } = useTranslation('project')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: project } = useProject(projectId)
  const generateBrd = useGenerateBrd()

  const {
    messages: liveMessages,
    completeness: liveCompleteness,
    isLoading,
    sendMessage,
  } = useScopingChat(projectId)

  const messages = liveMessages.length > 0 ? liveMessages : WELCOME_MESSAGES
  const completeness = liveMessages.length > 0 ? liveCompleteness : 72

  const [input, setInput] = useState('')
  const [showScopeSummary, setShowScopeSummary] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasWelcomed = useRef(false)

  const handleUploadSpec = useCallback(
    async (file: File) => {
      if (isUploading) return
      setIsUploading(true)
      try {
        // Get presigned URL
        const presignRes = await fetch(apiUrl('/api/v1/upload/presigned-url'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
        })
        if (!presignRes.ok) throw new Error('Failed to get upload URL')
        const { data: presign } = await presignRes.json()

        // Upload to S3
        await fetch(presign.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        })

        // Parse spec via backend
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
        const specRes = await fetch(apiUrl(`/api/v1/projects/${projectId}/upload-spec`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: presign.fileUrl, fileType: ext }),
        })
        if (!specRes.ok) throw new Error('Failed to parse specification')
        const specData = await specRes.json()
        const msg = specData?.data?.message ?? t('spec_uploaded')
        sendMessage(`[${t('spec_uploaded')}] ${msg}`)
      } catch {
        sendMessage(`[${t('spec_upload_failed')}]`)
      } finally {
        setIsUploading(false)
      }
    },
    [isUploading, projectId, sendMessage, t],
  )

  useEffect(() => {
    if (!hasWelcomed.current && liveMessages.length === 0) {
      hasWelcomed.current = true
    }
  }, [liveMessages.length])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  function handleSend() {
    if (!input.trim() || isLoading) return
    sendMessage(input)
    setInput('')
    inputRef.current?.focus()
  }

  const extractScopeSummary = useCallback(() => {
    const userMessages = messages.filter((m) => m.senderType === 'user').map((m) => m.content)
    return userMessages
  }, [messages])

  function handleRequestGenerateBrd() {
    setShowScopeSummary(true)
  }

  async function handleConfirmGenerateBrd() {
    setShowScopeSummary(false)
    try {
      await generateBrd.mutateAsync(projectId)
      navigate({
        to: '/projects/$projectId/brd',
        params: { projectId },
      })
    } catch {
      // Error handled by mutation state
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row bg-surface">
      {/* Scope summary confirmation modal */}
      {showScopeSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scope-summary-title"
        >
          <div className="w-full max-w-lg rounded-xl bg-surface-bright shadow-2xl border border-outline-dim/20">
            <div className="flex items-center justify-between border-b border-outline-dim/20 px-6 py-4">
              <h2
                id="scope-summary-title"
                className="flex items-center gap-2 text-base font-semibold text-primary-600"
              >
                <ClipboardList className="h-5 w-5 text-success-600" />
                {t('scope_summary_title')}
              </h2>
              <button
                type="button"
                onClick={() => setShowScopeSummary(false)}
                className="rounded p-1 text-on-surface-muted hover:text-primary-600 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto px-6 py-4">
              <p className="mb-3 text-sm text-on-surface-muted">{t('scope_summary_description')}</p>
              {project && (
                <div className="mb-4 rounded-lg bg-surface-container p-3 border border-outline-dim/20">
                  <p className="text-xs font-medium text-on-surface-muted">{t('title')}</p>
                  <p className="text-sm font-medium text-primary-600">{project.title}</p>
                  <p className="mt-2 text-xs font-medium text-on-surface-muted">{t('category')}</p>
                  <p className="text-sm text-primary-600/80">{t(project.category)}</p>
                </div>
              )}
              <h3 className="mb-2 text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                {t('scope_key_points')}
              </h3>
              <ul className="space-y-2">
                {extractScopeSummary().map((point, pointIndex) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 rounded-lg bg-surface-container p-3 text-sm text-primary-600/80"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600/20 text-xs font-medium text-success-600">
                      {pointIndex + 1}
                    </span>
                    <span className="line-clamp-3">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-outline-dim/20 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowScopeSummary(false)}
                className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-primary-600/70 hover:bg-surface-container transition-colors"
              >
                {t('scope_summary_edit')}
              </button>
              <button
                type="button"
                onClick={handleConfirmGenerateBrd}
                disabled={generateBrd.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-5 py-2 text-sm font-medium text-white hover:bg-accent-coral-500/90 disabled:opacity-50 transition-colors"
              >
                {generateBrd.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('generating_brd')}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {t('scope_summary_confirm')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat panel */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-outline-dim/20 bg-surface px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-primary-600">{t('scoping_title')}</h1>
              <p className="text-xs text-on-surface-muted">{t('scoping_description')}</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Upload spec button */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleUploadSpec(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-2 rounded-lg border border-outline-dim/30 bg-surface px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                {t('upload_spec')}
              </button>
              {completeness >= 80 && (
                <button
                  type="button"
                  onClick={handleRequestGenerateBrd}
                  disabled={generateBrd.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-coral-500/90 disabled:opacity-50 transition-colors"
                >
                  {generateBrd.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('generating_brd')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {t('generate_brd')}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Completeness bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-on-surface-muted">{t('completeness')}</span>
              <span className="font-semibold text-primary-600">{completeness}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-container">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  completeness >= 80
                    ? 'bg-primary-600'
                    : completeness >= 40
                      ? 'bg-accent-cream-500'
                      : 'bg-accent-coral-500',
                )}
                style={{ width: `${completeness}%` }}
              />
            </div>
            {completeness >= 80 && (
              <p className="mt-1.5 text-xs text-success-600">{t('scoping_ready')}</p>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-surface-container px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-3 rounded-full bg-surface-bright p-4">
                  <Bot className="h-8 w-8 text-success-600" />
                </div>
                <p className="text-sm text-on-surface-muted">{t('scoping_empty_hint')}</p>
              </div>
            )}
            {messages.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-bright">
                  <Bot className="h-4 w-4 text-success-600" />
                </div>
                <div className="rounded-2xl rounded-tl-none bg-surface-bright px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500 [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-outline-dim/20 bg-surface px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={t('send_message')}
              disabled={isLoading}
              className="flex-1 rounded-lg border border-outline-dim/20 bg-surface-container px-4 py-2.5 text-sm text-primary-600 placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-600/90 disabled:opacity-40 transition-colors"
              aria-label={t('send_message')}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Project summary sidebar (desktop) */}
      <div className="hidden w-80 shrink-0 border-l border-outline-dim/20 bg-surface lg:block">
        <div className="p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary-600">
            <Info className="h-4 w-4 text-on-surface-muted" />
            {t('project_summary')}
          </h2>

          {project ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-surface-bright p-4 border border-outline-dim/20">
                <h3 className="text-base font-medium text-primary-600">{project.title}</h3>
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary-600/15 px-2 py-0.5 text-xs font-medium text-success-600">
                  <Tag className="h-3 w-3" />
                  {t(project.category)}
                </span>
              </div>

              <div className="space-y-3 rounded-lg bg-surface-bright p-4 border border-outline-dim/20">
                <div className="flex items-center gap-2 text-sm">
                  <Wallet className="h-4 w-4 text-on-surface-muted" />
                  <span className="text-on-surface-muted">{t('budget')}:</span>
                  <span className="font-medium text-primary-600">
                    {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-on-surface-muted" />
                  <span className="text-on-surface-muted">{t('timeline')}:</span>
                  <span className="font-medium text-primary-600">
                    {project.estimatedTimelineDays} {t('days')}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-surface-bright p-4 border border-outline-dim/20">
                <h4 className="mb-1 text-xs font-medium text-on-surface-muted">
                  {t('description')}
                </h4>
                <p className="text-sm leading-relaxed text-primary-600/70 line-clamp-6">
                  {project.description}
                </p>
              </div>

              {/* Scoping tips */}
              <div className="rounded-lg bg-surface-container p-3 border border-success-500/20">
                <h4 className="mb-1.5 text-xs font-semibold text-success-600">
                  {t('scoping_tips_title')}
                </h4>
                <ul className="space-y-1 text-xs text-success-600/70">
                  <li>{t('scoping_tip_1')}</li>
                  <li>{t('scoping_tip_2')}</li>
                  <li>{t('scoping_tip_3')}</li>
                  <li>{t('scoping_tip_4')}</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="h-6 animate-pulse rounded bg-surface-bright" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-surface-bright" />
              <div className="h-20 animate-pulse rounded bg-surface-bright" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatBubble({
  message,
}: {
  message: {
    id: string
    senderType: string
    content: string
    createdAt: string
  }
}) {
  if (message.senderType === 'system') {
    return (
      <div className="flex justify-center">
        <div className="rounded-full bg-surface-bright/50 px-4 py-1.5 text-xs text-on-surface-muted">
          {message.content}
        </div>
      </div>
    )
  }

  const isUser = message.senderType === 'user'

  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary-600/20' : 'bg-surface-bright',
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-success-600" />
        ) : (
          <Bot className="h-4 w-4 text-success-600" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-none bg-primary-600 text-white'
            : 'rounded-tl-none bg-surface-bright text-primary-600/90',
        )}
      >
        {message.content}
      </div>
    </div>
  )
}
