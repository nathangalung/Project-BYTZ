import { createFileRoute, Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import {
  FolderOpen,
  Headphones,
  Loader2,
  MessageSquare,
  Paperclip,
  Search,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConversations } from '@/hooks/use-chat-messages'
import { cn } from '@/lib/utils'

function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: idLocale })
  } catch {
    return ''
  }
}

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

const AVATAR_COLORS = [
  'bg-success-500',
  'bg-warning-500',
  'bg-error-500',
  'bg-primary-500',
  'bg-neutral-500',
]

function mapApiTypeToTab(type: string): ConversationTab {
  if (type === 'client_worker' || type === 'ai_scoping') return 'projects'
  if (type === 'team_group' || type === 'worker_worker') return 'team'
  if (type === 'admin_mediation') return 'support'
  return 'projects'
}

function apiToConversation(
  raw: { id: string; projectId: string; type: string; createdAt: string },
  index: number,
): Conversation {
  const tab = mapApiTypeToTab(raw.type)
  const name = raw.projectId ? `Project ${raw.projectId.slice(0, 8)}` : `Conversation ${index + 1}`
  const initial = name.charAt(0).toUpperCase()
  return {
    id: raw.id,
    name,
    type: tab,
    lastMessage: '',
    lastMessageAt: raw.createdAt,
    unreadCount: 0,
    avatarInitial: initial,
    avatarColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
    participantCount: 2,
  }
}

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
  const { data: rawConversations, isLoading } = useConversations()

  const conversations: Conversation[] = (rawConversations ?? []).map(apiToConversation)

  const filteredConversations = conversations.filter((conv) => {
    const matchesTab = activeTab === 'all' || conv.type === activeTab
    const matchesSearch =
      !searchQuery || conv.name.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesTab && matchesSearch
  })

  const tabLabels: Record<ConversationTab, string> = {
    all: t('all_chats', 'Semua'),
    projects: t('projects', 'Proyek'),
    team: t('team', 'Tim'),
    support: t('support', 'Support'),
  }

  return (
    <div className="bg-surface p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary-600">{t('messages', 'Pesan')}</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          {t('messages_desc', 'Komunikasi dengan tim dan pemilik proyek')}
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-outline-dim/20 bg-surface-container p-1">
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-primary-600 text-white'
                  : 'text-on-surface-muted hover:bg-surface-container hover:text-on-surface-muted',
              )}
            >
              {tab.icon}
              {tabLabels[tab.key]}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search_conversations', 'Cari percakapan...')}
            className="w-full rounded-lg border border-outline-dim/20 bg-surface-container py-2.5 pl-9 pr-3 text-sm text-on-surface placeholder:text-on-surface-muted focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30 sm:w-72"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-16">
          <Loader2 className="h-8 w-8 animate-spin text-success-600" />
        </div>
      ) : filteredConversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-outline-dim/20 bg-surface-bright py-16">
          <div className="mb-4 rounded-full bg-surface-container p-4">
            <MessageSquare className="h-8 w-8 text-on-surface-muted" />
          </div>
          <h3 className="mb-1 text-base font-medium text-on-surface-muted">
            {t('no_messages', 'Belum ada pesan')}
          </h3>
          <p className="max-w-sm text-center text-sm text-on-surface-muted">
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
      className="flex items-center gap-4 rounded-xl border border-outline-dim/20 bg-surface-bright p-4 transition-all hover:border-neutral-600/50 hover:bg-surface-bright/80"
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
              conversation.unreadCount > 0 ? 'text-primary-600' : 'text-on-surface-muted',
            )}
          >
            {conversation.name}
          </h3>
          <span className="shrink-0 text-xs text-on-surface-muted">
            {formatRelativeTime(conversation.lastMessageAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-sm text-on-surface-muted">
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

        <div className="mt-1 flex items-center gap-1 text-xs text-on-surface-muted">
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
