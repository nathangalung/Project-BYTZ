import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, File, FileText, Image, Paperclip, Send, Users } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

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

type ConversationMeta = {
  id: string
  name: string
  participantCount: number
  avatarInitial: string
  avatarColor: string
}

const MOCK_CONVERSATION_META: Record<string, ConversationMeta> = {
  'conv-1': {
    id: 'conv-1',
    name: 'E-Commerce Platform',
    participantCount: 2,
    avatarInitial: 'E',
    avatarColor: 'bg-success-500',
  },
  'conv-2': {
    id: 'conv-2',
    name: 'Mobile Banking App',
    participantCount: 4,
    avatarInitial: 'M',
    avatarColor: 'bg-warning-500',
  },
  'conv-3': {
    id: 'conv-3',
    name: 'Dashboard Analytics',
    participantCount: 2,
    avatarInitial: 'D',
    avatarColor: 'bg-error-500',
  },
  'conv-4': {
    id: 'conv-4',
    name: 'BYTZ Support',
    participantCount: 2,
    avatarInitial: 'B',
    avatarColor: 'bg-neutral-500',
  },
  'conv-5': {
    id: 'conv-5',
    name: 'Sistem Inventori',
    participantCount: 3,
    avatarInitial: 'S',
    avatarColor: 'bg-success-500',
  },
}

const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: 'm1',
    senderId: 'other',
    senderName: 'Siti Rahayu',
    senderType: 'user',
    content:
      'Halo, saya sudah review PRD-nya. Ada beberapa pertanyaan tentang integrasi payment gateway.',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'm2',
    senderId: 'me',
    senderName: 'Anda',
    senderType: 'user',
    content:
      'Silakan, pertanyaan apa saja? Saya siap menjawab supaya kita bisa mulai sprint 1 minggu depan.',
    createdAt: new Date(Date.now() - 7000000).toISOString(),
  },
  {
    id: 'm3',
    senderId: 'other',
    senderName: 'Siti Rahayu',
    senderType: 'user',
    content:
      'Untuk Midtrans, apakah kita pakai Snap atau Core API? Dan apakah perlu support semua metode pembayaran?',
    createdAt: new Date(Date.now() - 6800000).toISOString(),
  },
  {
    id: 'm-system',
    senderId: 'system',
    senderName: 'System',
    senderType: 'system',
    content: 'Milestone 1: Backend API - deadline 20 Maret 2026',
    createdAt: new Date(Date.now() - 5000000).toISOString(),
  },
  {
    id: 'm4',
    senderId: 'me',
    senderName: 'Anda',
    senderType: 'user',
    content:
      'Pakai Snap saja dulu untuk MVP. Support: bank transfer, QRIS, GoPay, OVO. Nanti bisa ditambah.',
    createdAt: new Date(Date.now() - 4500000).toISOString(),
  },
  {
    id: 'm5',
    senderId: 'other',
    senderName: 'Siti Rahayu',
    senderType: 'user',
    content:
      'Baik, saya akan mulai dari backend API dan integrasi Midtrans. Estimasi 5 hari kerja untuk endpoint payment.',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    attachments: [
      {
        name: 'payment-flow-diagram.pdf',
        url: '#',
        type: 'application/pdf',
      },
    ],
  },
]

function ConversationPage() {
  const { conversationId } = Route.useParams()
  const { t } = useTranslation('chat')
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(MOCK_MESSAGES)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const meta = MOCK_CONVERSATION_META[conversationId] ?? {
    id: conversationId,
    name: 'Conversation',
    participantCount: 2,
    avatarInitial: '?',
    avatarColor: 'bg-neutral-600',
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (!trimmed) return
    const newMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      senderId: 'me',
      senderName: 'Anda',
      senderType: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, newMsg])
    setInputValue('')
    inputRef.current?.focus()
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const groupedMessages = groupMessagesByDate(messages)

  return (
    <div className="flex h-screen flex-col bg-primary-600">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-600/30 bg-primary-800 px-4 py-3 lg:px-6">
        <Link
          to="/messages"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-primary-700 hover:text-neutral-300"
          aria-label={t('back_to_messages', 'Kembali')}
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
          <h2 className="truncate text-sm font-semibold text-warning-500">{meta.name}</h2>
          <div className="flex items-center gap-1 text-xs text-neutral-600">
            <Users className="h-3 w-3" />
            <span>
              {t('participant_count', '{{count}} peserta', {
                count: meta.participantCount,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-primary-700 px-4 py-4 lg:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {groupedMessages.map((group) => (
            <div key={group.label}>
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-neutral-600/30" />
                <span className="text-xs font-medium text-neutral-600">{group.label}</span>
                <div className="h-px flex-1 bg-neutral-600/30" />
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
      <div className="border-t border-neutral-600/30 bg-primary-800 px-4 py-3 lg:px-6">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl items-end gap-2">
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-primary-700 hover:text-neutral-400"
            aria-label={t('attach_file', 'Lampirkan file')}
          >
            <Paperclip className="h-5 w-5" />
          </button>

          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('type_message', 'Ketik pesan...')}
              rows={1}
              className="w-full resize-none rounded-lg border border-neutral-600/30 bg-primary-700 px-4 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50"
              style={{ maxHeight: '120px' }}
            />
          </div>

          <button
            type="submit"
            disabled={!inputValue.trim()}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors',
              inputValue.trim()
                ? 'bg-success-500 text-primary-800 hover:bg-success-500/90'
                : 'bg-primary-700 text-neutral-600',
            )}
            aria-label={t('send', 'Kirim')}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isOwn = message.senderId === 'me'
  const isSystem = message.senderType === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="rounded-full bg-primary-800/80 px-4 py-1.5 text-xs text-neutral-500">
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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-600 text-xs font-semibold text-neutral-300">
          {message.senderName.charAt(0).toUpperCase()}
        </div>
      )}

      <div className={cn('max-w-[75%] space-y-1', isOwn ? 'items-end' : 'items-start')}>
        {!isOwn && (
          <span className="text-xs font-medium text-neutral-500">{message.senderName}</span>
        )}

        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isOwn
              ? 'rounded-br-md bg-success-500/90 text-primary-800'
              : 'rounded-bl-md bg-neutral-600 text-neutral-200',
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

        <span className={cn('block text-xs text-neutral-600', isOwn ? 'text-right' : 'text-left')}>
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
          ? 'border-success-500/30 bg-success-500/20 text-primary-800 hover:bg-success-500/30'
          : 'border-neutral-600/30 bg-primary-700 text-neutral-400 hover:bg-primary-800',
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

  if (messageDay.getTime() === today.getTime()) return 'Today'
  if (messageDay.getTime() === yesterday.getTime()) return 'Yesterday'

  return new Intl.DateTimeFormat('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}
