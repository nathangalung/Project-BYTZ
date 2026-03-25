import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, File, FileText, Image, Loader2, Paperclip, Send, Users } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

export const Route = createFileRoute('/_authenticated/messages/$conversationId')({
  component: ConversationPage,
})

type ChatMessage = {
  id: string
  senderId: string
  senderName: string
  senderType: 'user' | 'ai' | 'system'
  content: string
  createdAt: string
  attachments?: { name: string; url: string; type: string }[]
}

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const { t } = useTranslation('chat')
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const {
    messages: chatMessages,
    loading,
    sendMessage,
    messagesEndRef,
  } = useChatMessages(conversationId)

  const messages: ChatMessage[] = chatMessages.map((m) => ({
    id: m.id,
    senderId: m.senderId ?? (m.senderType === 'system' ? 'system' : 'unknown'),
    senderName: m.senderName,
    senderType: m.senderType,
    content: m.content,
    createdAt: m.createdAt,
  }))

  const meta = {
    id: conversationId,
    name: `Conversation ${conversationId.slice(0, 8)}`,
    participantCount: 2,
    avatarInitial: conversationId.charAt(0).toUpperCase(),
    avatarColor: 'bg-primary-500',
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed) return
    sendMessage(trimmed)
    setInputValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-success-600" />
      </div>
    )
  }

  const groupedMessages = groupMessagesByDate(messages)

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-outline-dim/20 bg-surface-container px-4 py-3 lg:px-6">
        <Link
          to="/messages"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-muted transition-colors hover:bg-surface-container hover:text-on-surface-muted"
          aria-label={t('back_to_messages')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>

        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary-800',
            meta.avatarColor,
          )}
        >
          {meta.avatarInitial}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-primary-600">{meta.name}</h2>
          <div className="flex items-center gap-1 text-xs text-on-surface-muted">
            <Users className="h-3 w-3" />
            <span>
              {t('participant_count', {
                count: meta.participantCount,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-surface-container px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {groupedMessages.map((group) => (
            <div key={group.label}>
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-surface-bright/30" />
                <span className="text-xs font-medium text-on-surface-muted">{group.label}</span>
                <div className="h-px flex-1 bg-surface-bright/30" />
              </div>
              <div className="space-y-3">
                {group.messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-outline-dim/20 bg-surface-container px-4 py-3 lg:px-6">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-end gap-2">
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-on-surface-muted transition-colors hover:bg-surface-container hover:text-on-surface-muted"
            aria-label={t('attach_file')}
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('type_message')}
              rows={1}
              className="w-full resize-none rounded-lg border border-outline-dim/20 bg-surface-container px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              style={{ maxHeight: '120px' }}
            />
          </div>

          <button
            type="submit"
            disabled={!inputValue.trim()}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
              inputValue.trim()
                ? 'bg-primary-600 text-white hover:opacity-90'
                : 'bg-surface-container text-on-surface-muted',
            )}
            aria-label={t('send')}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const { user } = useAuthStore()
  const isOwn = message.senderId === user?.id
  const isSystem = message.senderType === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="rounded-full bg-surface-container/80 px-4 py-1.5 text-xs text-on-surface-muted">
          {message.content}
        </div>
      </div>
    )
  }

  const time = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(message.createdAt))

  return (
    <div className={cn('flex gap-2.5', isOwn ? 'justify-end' : 'justify-start')}>
      {!isOwn && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-bright text-xs font-semibold text-on-surface-muted">
          {message.senderName.charAt(0).toUpperCase()}
        </div>
      )}

      <div className={cn('max-w-[75%] space-y-1', isOwn ? 'items-end' : 'items-start')}>
        {!isOwn && (
          <span className="text-xs font-medium text-on-surface-muted">{message.senderName}</span>
        )}

        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isOwn
              ? 'rounded-br-md bg-primary-600 text-white'
              : 'rounded-bl-md bg-surface-bright text-on-surface',
          )}
        >
          {message.content}
        </div>

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {message.attachments.map((attachment) => (
              <AttachmentCard key={attachment.name} attachment={attachment} isOwn={isOwn} />
            ))}
          </div>
        )}

        <span
          className={cn('block text-xs text-on-surface-muted', isOwn ? 'text-right' : 'text-left')}
        >
          {time}
        </span>
      </div>
    </div>
  )
}

function AttachmentCard({
  attachment,
  isOwn,
}: {
  attachment: { name: string; url: string; type: string }
  isOwn: boolean
}) {
  function getAttachmentIcon(type: string) {
    if (type.startsWith('image/')) return <Image className="h-4 w-4" />
    if (type.includes('pdf')) return <FileText className="h-4 w-4" />
    return <File className="h-4 w-4" />
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
        isOwn
          ? 'border-primary-500/30 bg-primary-500/10 text-primary-800 hover:bg-success-500/30'
          : 'border-outline-dim/20 bg-surface-container text-on-surface-muted hover:bg-surface-container',
      )}
    >
      {getAttachmentIcon(attachment.type)}
      <span className="truncate">{attachment.name}</span>
    </a>
  )
}

type MessageGroup = {
  label: string
  messages: ChatMessage[]
}

function groupMessagesByDate(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentLabel = ''
  let currentMessages: ChatMessage[] = []

  for (const msg of messages) {
    const label = getDateLabel(msg.createdAt)
    if (label !== currentLabel) {
      if (currentMessages.length > 0) {
        groups.push({ label: currentLabel, messages: currentMessages })
      }
      currentLabel = label
      currentMessages = [msg]
    } else {
      currentMessages.push(msg)
    }
  }

  if (currentMessages.length > 0) {
    groups.push({ label: currentLabel, messages: currentMessages })
  }

  return groups
}

function getDateLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (messageDay.getTime() === today.getTime()) return 'Hari ini'
  if (messageDay.getTime() === yesterday.getTime()) return 'Kemarin'

  return new Intl.DateTimeFormat('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}
