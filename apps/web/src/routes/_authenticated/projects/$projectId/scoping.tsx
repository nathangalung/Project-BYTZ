import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Bot,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FileUp,
  Info,
  Loader2,
  RefreshCw,
  Send,
  Tag,
  User,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownLite } from '@/components/chat/markdown-lite'
import { TimelineRange } from '@/components/project/timeline-range'
import { LanguageChoice } from '@/components/ui/language-choice'
import { Modal } from '@/components/ui/modal'
import { ProgressBar } from '@/components/ui/progress-bar'
import { useScopingChat } from '@/hooks/use-chat'
import { type DocLanguage, useGenerateBrd, useProject } from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

/** Server error code to i18n key in the errors namespace. */
function chatErrorKey(code: string): string {
  if (code === 'AI_SERVICE_UNAVAILABLE') return 'ai.service_unavailable'
  if (code === 'AI_RATE_LIMITED') return 'ai.rate_limit_exceeded'
  return 'general.internal_error'
}

export const Route = createFileRoute('/_authenticated/projects/$projectId/scoping')({
  component: ScopingPage,
})

function ScopingPage() {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const { t: tErrors } = useTranslation('errors')
  const { projectId } = Route.useParams()
  const navigate = useNavigate()
  const { data: project } = useProject(projectId)
  const generateBrd = useGenerateBrd()
  const addToast = useToastStore((s) => s.addToast)

  const {
    messages: liveMessages,
    completeness: liveCompleteness,
    missing: liveMissing,
    isLoading,
    sendMessage,
    error: chatError,
    historyFailed,
    retryHistory,
  } = useScopingChat(projectId)

  const messages = liveMessages
  const completeness = liveCompleteness
  const missing = liveMissing

  const [input, setInput] = useState('')
  const [showScopeSummary, setShowScopeSummary] = useState(false)
  const [genLanguage, setGenLanguage] = useState<DocLanguage>('id')
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
          body: JSON.stringify({
            fileName: file.name,
            fileType: file.type,
            folder: 'document',
            fileSize: file.size,
          }),
        })
        if (!presignRes.ok) throw new Error('Failed to get upload URL')
        const { data: presign } = await presignRes.json()

        // Upload to S3
        const putRes = await fetch(presign.url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': presign.contentType },
        })
        if (!putRes.ok) throw new Error('Failed to upload file')

        // Parse spec via backend
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
        const specRes = await fetch(apiUrl(`/api/v1/projects/${projectId}/upload-spec`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: presign.url.split('?')[0], fileType: ext }),
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  /**
   * Grow the composer downwards instead of scrolling the text sideways.
   *
   * A textarea keeps its `rows` height on its own, so a long answer would still
   * hide everything but the last line. Reset to `auto` first: scrollHeight is
   * measured against the current height, so without the reset the box can only
   * ever grow. The CSS `max-h` then caps it and hands back the scrollbar.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: input is the trigger, the height is measured
  useEffect(() => {
    const field = inputRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [input])

  function handleSend() {
    if (!input.trim() || isLoading) return
    sendMessage(input)
    setInput('')
    inputRef.current?.focus()
  }

  /** Re-run the turn that failed. The message itself is already stored. */
  function handleRetry() {
    const lastUser = [...messages].reverse().find((m) => m.senderType === 'user')
    if (!lastUser || isLoading) return
    sendMessage(lastUser.content, { retry: true })
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
      await generateBrd.mutateAsync({ projectId, language: genLanguage })
      navigate({
        to: '/projects/$projectId/brd',
        params: { projectId },
      })
    } catch (err) {
      // Surface the specific reason, e.g. the daily free limit.
      setShowScopeSummary(true)
      addToast('error', err instanceof Error ? err.message : t('generating_brd'))
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row bg-surface">
      {/* Scope summary confirmation modal */}
      {showScopeSummary && (
        <Modal open onClose={() => setShowScopeSummary(false)} title={t('scope_summary_title')}>
          <div>
            <div className="-mx-6 -mt-4 max-h-80 overflow-y-auto px-6 py-4">
              <p className="mb-3 flex items-center gap-2 text-sm text-on-surface-muted">
                <ClipboardList className="h-5 w-5 shrink-0 text-success-600" />
                {t('scope_summary_description')}
              </p>
              {project && (
                <div className="mb-4 rounded-lg bg-surface-container p-3 border border-outline-dim/20">
                  <p className="text-xs font-medium text-on-surface-muted">{t('title')}</p>
                  <p className="text-sm font-medium text-brand-text">{project.title}</p>
                  <p className="mt-2 text-xs font-medium text-on-surface-muted">{t('category')}</p>
                  <p className="text-sm text-brand-text/80">{t(project.category)}</p>
                </div>
              )}
              <h3 className="mb-2 text-xs font-semibold text-on-surface-muted uppercase tracking-wider">
                {t('scope_key_points')}
              </h3>
              <ul className="space-y-2">
                {extractScopeSummary().map((point, pointIndex) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 rounded-lg bg-surface-container p-3 text-sm text-brand-text/80"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-accent/20 text-xs font-medium text-success-600">
                      {pointIndex + 1}
                    </span>
                    <span className="line-clamp-3">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="-mx-6 -mb-4 mt-4 flex items-center justify-between gap-3 border-t border-outline-dim/20 px-6 py-4">
              <LanguageChoice
                value={genLanguage}
                onChange={setGenLanguage}
                disabled={generateBrd.isPending}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowScopeSummary(false)}
                  className="rounded-lg border border-outline-dim/20 px-4 py-2 text-sm font-medium text-brand-text/70 hover:bg-surface-container transition-colors"
                >
                  {t('scope_summary_edit')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmGenerateBrd}
                  disabled={generateBrd.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-5 py-2 text-sm font-medium text-primary-900 hover:bg-accent-coral-500/90 disabled:opacity-50 transition-colors"
                >
                  {generateBrd.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('generating_brd')}
                    </>
                  ) : (
                    <>
                      <ClipboardCheck className="h-4 w-4" />
                      {t('scope_summary_confirm')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Chat panel */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <div className="border-b border-outline-dim/20 bg-surface px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-brand-text">{t('scoping_title')}</h1>
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
              {/* Disabled, not absent. A control that vanishes below the
                  threshold is indistinguishable from one that never existed,
                  so the owner saw a percentage and no way forward. The reason
                  is the "still needed" list, named here for screen readers. */}
              <button
                type="button"
                onClick={handleRequestGenerateBrd}
                disabled={generateBrd.isPending || completeness < 80}
                aria-describedby={completeness < 80 ? 'scoping-still-needed' : undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-coral-500 px-4 py-2 text-sm font-medium text-primary-900 shadow-sm hover:bg-accent-coral-500/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {generateBrd.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('generating_brd')}
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" />
                    {t('generate_brd')}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Completeness bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-on-surface-muted">{t('completeness')}</span>
              <span className="font-semibold text-brand-text">{completeness}%</span>
            </div>
            <ProgressBar
              value={completeness}
              label={t('completeness')}
              trackClassName="mt-1.5 h-2"
              barClassName={cn(
                'transition-all duration-500',
                completeness >= 80
                  ? 'bg-brand'
                  : completeness >= 40
                    ? 'bg-accent-cream-500'
                    : 'bg-accent-coral-500',
              )}
            />
            {completeness >= 80 && (
              <p className="mt-1.5 text-xs text-success-600">{t('scoping_ready')}</p>
            )}
            {/* Shown at every score: the gaps are what the number is made of. */}
            {missing.length > 0 && (
              <div className="mt-2" id="scoping-still-needed">
                <p className="text-[11px] font-medium text-on-surface-muted">
                  {t('scoping_still_needed')}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {missing.map((key) => (
                    <span
                      key={key}
                      className="rounded-full bg-accent-coral-500/10 px-2 py-0.5 text-[10px] font-medium text-accent-coral-600"
                    >
                      {t(`missing_${key}`)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-surface-container px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {historyFailed && (
              // The transcript failed to load. Sending from here would append
              // to a thread the owner cannot see, so the opening prompts stay
              // hidden until the history is either read or known to be absent.
              <div
                role="alert"
                className="flex items-start gap-3 rounded-2xl border border-error-500/40 bg-error-500/10 px-4 py-3"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-error-600" />
                <div className="flex-1">
                  <p className="text-sm text-on-surface">{t('chat_history_load_failed')}</p>
                  <button
                    type="button"
                    onClick={retryHistory}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-outline-dim px-3 py-1.5 text-sm font-medium text-brand-text hover:bg-surface-bright focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {tCommon('retry')}
                  </button>
                </div>
              </div>
            )}
            {messages.length === 0 && !isLoading && !historyFailed && (
              <ScopingOpening completeness={completeness} missing={missing} onPick={setInput} />
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
                    <span className="h-2 w-2 animate-bounce rounded-full bg-on-surface-muted [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-on-surface-muted [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-on-surface-muted [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            {chatError && !isLoading && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-2xl border border-error-500/40 bg-error-500/10 px-4 py-3"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-error-600" />
                <div className="flex-1">
                  <p className="text-sm text-on-surface">{tErrors(chatErrorKey(chatError))}</p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-outline-dim px-3 py-1.5 text-sm font-medium text-brand-text hover:bg-surface-bright focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {tCommon('retry')}
                  </button>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-outline-dim/20 bg-surface px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-end gap-3">
            <textarea
              ref={inputRef}
              rows={1}
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
              className="max-h-40 min-h-[2.75rem] flex-1 resize-none overflow-y-auto rounded-lg border border-outline-dim/20 bg-surface-container px-4 py-2.5 text-sm leading-6 text-brand-text placeholder:text-on-surface-muted focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent/30 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white hover:bg-brand/90 disabled:opacity-40 transition-colors"
              aria-label={t('send_message')}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Project summary sidebar (desktop) */}
      <div className="hidden w-80 shrink-0 border-l border-outline-dim/20 bg-surface overflow-hidden lg:block">
        <div className="p-6 overflow-hidden">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-text">
            <Info className="h-4 w-4 text-on-surface-muted" />
            {t('project_summary')}
          </h2>

          {project ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-surface-bright p-4 border border-outline-dim/20">
                <h3 className="text-base font-medium text-brand-text">{project.title}</h3>
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-accent/15 px-2 py-0.5 text-xs font-medium text-success-600">
                  <Tag className="h-3 w-3" />
                  {t(project.category)}
                </span>
              </div>

              <div className="space-y-3 rounded-lg bg-surface-bright p-4 border border-outline-dim/20">
                <div className="flex items-center gap-2 text-sm">
                  <Wallet className="h-4 w-4 text-on-surface-muted" />
                  <span className="text-on-surface-muted">{t('budget')}:</span>
                  <span className="font-medium text-brand-text">
                    {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-on-surface-muted" />
                  <span className="text-on-surface-muted">{t('estimated_timeline')}:</span>
                  <span className="font-medium text-brand-text">
                    <TimelineRange days={project.estimatedTimelineDays} />
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-surface-bright p-4 border border-outline-dim/20">
                <h4 className="mb-1 text-xs font-medium text-on-surface-muted">
                  {t('description')}
                </h4>
                <p className="text-sm leading-relaxed text-brand-text/70 line-clamp-6">
                  {project.description}
                </p>
              </div>

              {/* Scoping tips */}
              <div className="rounded-lg bg-surface-container p-3 border border-success-500/20">
                <h4 className="mb-1.5 text-xs font-semibold text-success-600">
                  {t('scoping_tips_title')}
                </h4>
                <ul className="space-y-1 text-xs text-success-600">
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

/**
 * The assistant's first turn, rendered from the intake form rather than a
 * model call.
 *
 * Landing here used to show a grey "start the conversation" hint and nothing
 * else: the owner had just filled a long form, so an empty chat read as a
 * broken one. The gaps are already known from the form, so state them, and
 * make each gap a button that writes the opening sentence for the owner.
 */
function ScopingOpening({
  completeness,
  missing,
  onPick,
}: {
  completeness: number
  missing: string[]
  onPick: (value: string) => void
}) {
  const { t } = useTranslation('project')

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-bright">
        <Bot className="h-4 w-4 text-success-600" />
      </div>
      <div className="max-w-[75%] space-y-3 rounded-2xl rounded-tl-none bg-surface-bright px-4 py-3 text-sm leading-relaxed text-brand-text/90">
        <p>{t('scoping_welcome')}</p>
        <p>{t('scoping_opening_read_form', { percent: completeness })}</p>

        {missing.length === 0 ? (
          <p className="text-success-600">{t('scoping_opening_complete')}</p>
        ) : (
          <>
            <p className="font-medium">{t('scoping_opening_missing_intro')}</p>
            <ol className="list-decimal space-y-1 pl-5">
              {missing.map((key) => (
                <li key={key}>{t(`missing_${key}`)}</li>
              ))}
            </ol>
            <p>{t('scoping_opening_next', { item: t(`missing_${missing[0]}`) })}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {missing.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPick(t(`scoping_prompt_${key}`))}
                  className="rounded-full border border-outline-dim/30 bg-surface px-3 py-1 text-xs font-medium text-brand-text hover:bg-surface-container transition-colors"
                >
                  {t(`missing_${key}`)}
                </button>
              ))}
            </div>
          </>
        )}
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
          isUser ? 'bg-brand-accent/20' : 'bg-surface-bright',
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
            ? 'rounded-tr-none bg-brand text-white'
            : 'rounded-tl-none bg-surface-bright text-brand-text/90',
        )}
      >
        {isUser ? message.content : <MarkdownLite content={message.content} />}
      </div>
    </div>
  )
}
