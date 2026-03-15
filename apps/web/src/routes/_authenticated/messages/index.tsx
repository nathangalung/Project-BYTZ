import { createFileRoute, Link } from '@tanstack/react-router'
import { FolderOpen, Headphones, MessageSquare, Paperclip, Search, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/messages/')({
  component: MessagesListPage,
})

type ConversationTab = 'all' | 'projects' | 'team' | 'support'

type Conversation = {
  id: string
  name: string
  type: ConversationTab
  lastMessage: string
  lastMessageAt: string
  unreadCount: number
  avatarInitial: string
  avatarColor: string
  participantCount: number
}

const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-1',
    name: 'E-Commerce Platform',
    type: 'projects',
    lastMessage: 'Baik, saya akan mulai dari backend API dan integrasi Midtrans.',
    lastMessageAt: new Date(Date.now() - 3600000).toISOString(),
    unreadCount: 2,
    avatarInitial: 'E',
    avatarColor: 'bg-success-500',
    participantCount: 2,
  },
  {
    id: 'conv-2',
    name: 'Mobile Banking App',
    type: 'team',
    lastMessage: 'Saya prefer Expo supaya development lebih cepat.',
    lastMessageAt: new Date(Date.now() - 86400000).toISOString(),
    unreadCount: 0,
    avatarInitial: 'M',
    avatarColor: 'bg-warning-500',
    participantCount: 4,
  },
  {
    id: 'conv-3',
    name: 'Dashboard Analytics',
    type: 'projects',
    lastMessage: 'Dashboard sudah selesai 80%, tinggal grafik revenue.',
    lastMessageAt: new Date(Date.now() - 172800000).toISOString(),
    unreadCount: 1,
    avatarInitial: 'D',
    avatarColor: 'bg-error-500',
    participantCount: 2,
  },
  {
    id: 'conv-4',
    name: 'BYTZ Support',
    type: 'support',
    lastMessage: 'Halo! Ada yang bisa kami bantu hari ini?',
    lastMessageAt: new Date(Date.now() - 259200000).toISOString(),
    unreadCount: 0,
    avatarInitial: 'B',
    avatarColor: 'bg-neutral-500',
    participantCount: 2,
  },
  {
    id: 'conv-5',
    name: 'Sistem Inventori',
    type: 'projects',
    lastMessage: 'PRD sudah di-approve, kapan bisa mulai?',
    lastMessageAt: new Date(Date.now() - 7200000).toISOString(),
    unreadCount: 3,
    avatarInitial: 'S',
    avatarColor: 'bg-success-500',
    participantCount: 3,
  },
]

const TAB_CONFIG: { key: ConversationTab; icon: React.ReactNode }[] = [
  { key: 'all', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { key: 'projects', icon: <FolderOpen className="h-3.5 w-3.5" /> },
  { key: 'team', icon: <Users className="h-3.5 w-3.5" /> },
  { key: 'support', icon: <Headphones className="h-3.5 w-3.5" /> },
]

function MessagesListPage() {
  const { t } = useTranslation('chat')
  const [activeTab, setActiveTab] = useState<ConversationTab>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredConversations = MOCK_CONVERSATIONS.filter((conv) => {
    const matchesTab = activeTab === 'all' || conv.type === activeTab
    const matchesSearch =
      !searchQuery ||
      conv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesTab && matchesSearch
  })

  const tabLabels: Record<ConversationTab, string> = {
    all: t('all_chats', 'Semua'),
    projects: t('projects', 'Proyek'),
    team: t('team', 'Tim'),
    support: t('support', 'Support'),
  }

  return (
    <div className="min-h-screen bg-primary-600 p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-warning-500">{t('messages', 'Pesan')}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t('messages_desc', 'Komunikasi dengan tim dan client')}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-600/30 bg-primary-700 p-1">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-success-500 text-primary-800'
                  : 'text-neutral-500 hover:bg-primary-800 hover:text-neutral-300',
              )}
            >
              {tab.icon}
              {tabLabels[tab.key]}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_conversations', 'Cari percakapan...')}
            className="w-full rounded-lg border border-neutral-600/30 bg-primary-700 py-2.5 pl-9 pr-3 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-success-500/50 focus:outline-none focus:ring-1 focus:ring-success-500/50 sm:w-72"
          />
        </div>
      </div>

      {filteredConversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-600/30 bg-neutral-600 py-16">
          <div className="mb-4 rounded-full bg-primary-700 p-4">
            <MessageSquare className="h-8 w-8 text-neutral-600" />
          </div>
          <h3 className="mb-1 text-base font-medium text-neutral-300">
            {t('no_messages', 'Belum ada pesan')}
          </h3>
          <p className="max-w-sm text-center text-sm text-neutral-500">
            {t('no_messages_description', 'Pesan akan muncul di sini saat ada percakapan baru')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredConversations.map((conversation) => (
            <ConversationCard key={conversation.id} conversation={conversation} />
          ))}
        </div>
      )}
    </div>
  )
}

function ConversationCard({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation('chat')

  return (
    <Link
      to="/messages/$conversationId"
      params={{ conversationId: conversation.id }}
      className="flex items-center gap-4 rounded-xl border border-neutral-600/30 bg-neutral-600 p-4 transition-all hover:border-neutral-600/50 hover:bg-neutral-600/80"
    >
      <div
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-primary-800',
          conversation.avatarColor,
        )}
      >
        {conversation.avatarInitial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3
            className={cn(
              'truncate text-sm font-medium',
              conversation.unreadCount > 0 ? 'text-warning-500' : 'text-neutral-300',
            )}
          >
            {conversation.name}
          </h3>
          <span className="shrink-0 text-xs text-neutral-600">
            {formatRelativeTime(conversation.lastMessageAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-sm text-neutral-500">
            {conversation.lastMessage.includes('File') ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {t('file_attached', 'File terlampir')}
              </span>
            ) : (
              conversation.lastMessage
            )}
          </p>

          {conversation.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-error-500 px-1.5 text-xs font-bold text-white">
              {conversation.unreadCount}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1 text-xs text-neutral-600">
          <Users className="h-3 w-3" />
          <span>
            {t('participant_count', '{{count}} peserta', {
              count: conversation.participantCount,
            })}
          </span>
        </div>
      </div>
    </Link>
  )
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`

  return new Intl.DateTimeFormat('id-ID', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}
