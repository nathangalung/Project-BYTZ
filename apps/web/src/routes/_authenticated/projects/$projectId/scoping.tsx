import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Bot,
  Calendar,
  ClipboardList,
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
import { cn, formatCurrency } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/projects/$projectId/scoping')({
  component: ScopingPage,
})

const DUMMY_MESSAGES = [
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

  const messages = liveMessages.length > 0 ? liveMessages : DUMMY_MESSAGES
  const completeness = liveMessages.length > 0 ? liveCompleteness : 72

  const [input, setInput] = useState('')
  const [showScopeSummary, setShowScopeSummary] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasWelcomed = useRef(false)

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
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row bg-[#152e34]">
      {/* Scope summary confirmation modal */}
      {showScopeSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scope-summary-title"
        >
          <div className="w-full max-w-lg rounded-xl bg-[#3b526a] shadow-2xl border border-[#5e677d]/30">
            <div className="flex items-center justify-between border-b border-[#5e677d]/30 px-6 py-4">
              <h2
                id="scope-summary-title"
                className="flex items-center gap-2 text-base font-semibold text-[#f6f3ab]"
              >
                <ClipboardList className="h-5 w-5 text-[#9fc26e]" />
                {t('scope_summary_title')}
              </h2>
              <button
                type="button"
                onClick={() => setShowScopeSummary(false)}
                className="rounded p-1 text-[#5e677d] hover:text-[#f6f3ab] transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto px-6 py-4">
              <p className="mb-3 text-sm text-[#5e677d]">{t('scope_summary_description')}</p>
              {project && (
                <div className="mb-4 rounded-lg bg-[#112630] p-3 border border-[#5e677d]/20">
                  <p className="text-xs font-medium text-[#5e677d]">{t('title')}</p>
                  <p className="text-sm font-medium text-[#f6f3ab]">{project.title}</p>
                  <p className="mt-2 text-xs font-medium text-[#5e677d]">{t('category')}</p>
                  <p className="text-sm text-[#f6f3ab]/80">{t(project.category)}</p>
                </div>
              )}
              <h3 className="mb-2 text-xs font-semibold text-[#5e677d] uppercase tracking-wider">
                {t('scope_key_points')}
              </h3>
              <ul className="space-y-2">
                {extractScopeSummary().map((point, pointIndex) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 rounded-lg bg-[#112630] p-3 text-sm text-[#f6f3ab]/80"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#9fc26e]/20 text-xs font-medium text-[#9fc26e]">
                      {pointIndex + 1}
                    </span>
                    <span className="line-clamp-3">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-[#5e677d]/30 px-6 py-4">
              <button
                type="button"
                onClick={() => setShowScopeSummary(false)}
                className="rounded-lg border border-[#5e677d]/40 px-4 py-2 text-sm font-medium text-[#f6f3ab]/70 hover:bg-[#112630] transition-colors"
              >
                {t('scope_summary_edit')}
              </button>
              <button
                type="button"
                onClick={handleConfirmGenerateBrd}
                disabled={generateBrd.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-[#e59a91] px-5 py-2 text-sm font-medium text-[#0d1e28] hover:bg-[#e59a91]/90 disabled:opacity-50 transition-colors"
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
        <div className="border-b border-[#5e677d]/20 bg-[#152e34] px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-[#f6f3ab]">{t('scoping_title')}</h1>
              <p className="text-xs text-[#5e677d]">{t('scoping_description')}</p>
            </div>
            {completeness >= 80 && (
              <button
                type="button"
                onClick={handleRequestGenerateBrd}
                disabled={generateBrd.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-[#e59a91] px-4 py-2 text-sm font-medium text-[#0d1e28] shadow-sm hover:bg-[#e59a91]/90 disabled:opacity-50 transition-colors"
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

          {/* Completeness bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#5e677d]">{t('completeness')}</span>
              <span className="font-semibold text-[#f6f3ab]">{completeness}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#112630]">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  completeness >= 80
                    ? 'bg-[#9fc26e]'
                    : completeness >= 40
                      ? 'bg-[#f6f3ab]'
                      : 'bg-[#e59a91]',
                )}
                style={{ width: `${completeness}%` }}
              />
            </div>
            {completeness >= 80 && (
              <p className="mt-1.5 text-xs text-[#9fc26e]">{t('scoping_ready')}</p>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-[#112630] px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-3 rounded-full bg-[#3b526a] p-4">
                  <Bot className="h-8 w-8 text-[#9fc26e]" />
                </div>
                <p className="text-sm text-[#5e677d]">{t('scoping_empty_hint')}</p>
              </div>
            )}
            {messages.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}
            {isLoading && (
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3b526a]">
                  <Bot className="h-4 w-4 text-[#9fc26e]" />
                </div>
                <div className="rounded-2xl rounded-tl-none bg-[#3b526a] px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[#5e677d] [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[#5e677d] [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-[#5e677d] [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-[#5e677d]/20 bg-[#152e34] px-4 py-3">
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
              className="flex-1 rounded-lg border border-[#5e677d]/30 bg-[#0d1e28] px-4 py-2.5 text-sm text-[#f6f3ab] placeholder:text-[#5e677d] focus:border-[#9fc26e]/50 focus:outline-none focus:ring-1 focus:ring-[#9fc26e]/50 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#9fc26e] text-[#0d1e28] hover:bg-[#9fc26e]/90 disabled:opacity-40 transition-colors"
              aria-label={t('send_message')}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Project summary sidebar (desktop) */}
      <div className="hidden w-80 shrink-0 border-l border-[#5e677d]/20 bg-[#152e34] lg:block">
        <div className="p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#f6f3ab]">
            <Info className="h-4 w-4 text-[#5e677d]" />
            {t('project_summary')}
          </h2>

          {project ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-[#3b526a] p-4 border border-[#5e677d]/20">
                <h3 className="text-base font-medium text-[#f6f3ab]">{project.title}</h3>
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#9fc26e]/15 px-2 py-0.5 text-xs font-medium text-[#9fc26e]">
                  <Tag className="h-3 w-3" />
                  {t(project.category)}
                </span>
              </div>

              <div className="space-y-3 rounded-lg bg-[#3b526a] p-4 border border-[#5e677d]/20">
                <div className="flex items-center gap-2 text-sm">
                  <Wallet className="h-4 w-4 text-[#5e677d]" />
                  <span className="text-[#5e677d]">{t('budget')}:</span>
                  <span className="font-medium text-[#f6f3ab]">
                    {formatCurrency(project.budgetMin)} - {formatCurrency(project.budgetMax)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-[#5e677d]" />
                  <span className="text-[#5e677d]">{t('timeline')}:</span>
                  <span className="font-medium text-[#f6f3ab]">
                    {project.estimatedTimelineDays} {t('days')}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-[#3b526a] p-4 border border-[#5e677d]/20">
                <h4 className="mb-1 text-xs font-medium text-[#5e677d]">{t('description')}</h4>
                <p className="text-sm leading-relaxed text-[#f6f3ab]/70 line-clamp-6">
                  {project.description}
                </p>
              </div>

              {/* Scoping tips */}
              <div className="rounded-lg bg-[#112630] p-3 border border-[#9fc26e]/20">
                <h4 className="mb-1.5 text-xs font-semibold text-[#9fc26e]">
                  {t('scoping_tips_title')}
                </h4>
                <ul className="space-y-1 text-xs text-[#9fc26e]/70">
                  <li>{t('scoping_tip_1')}</li>
                  <li>{t('scoping_tip_2')}</li>
                  <li>{t('scoping_tip_3')}</li>
                  <li>{t('scoping_tip_4')}</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="h-6 animate-pulse rounded bg-[#3b526a]" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-[#3b526a]" />
              <div className="h-20 animate-pulse rounded bg-[#3b526a]" />
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
        <div className="rounded-full bg-[#3b526a]/50 px-4 py-1.5 text-xs text-[#5e677d]">
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
          isUser ? 'bg-[#9fc26e]/20' : 'bg-[#3b526a]',
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-[#9fc26e]" />
        ) : (
          <Bot className="h-4 w-4 text-[#9fc26e]" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'rounded-tr-none bg-[#9fc26e] text-[#0d1e28]'
            : 'rounded-tl-none bg-[#3b526a] text-[#f6f3ab]/90',
        )}
      >
        {message.content}
      </div>
    </div>
  )
}
