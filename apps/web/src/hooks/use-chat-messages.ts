import { useCallback, useEffect, useRef, useState } from 'react'

export type ChatMessage = {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  senderType: 'user' | 'ai' | 'system'
  content: string
  createdAt: string
  attachments?: { name: string; url: string; type: string }[]
}

const MOCK_MESSAGES: Record<string, ChatMessage[]> = {
  'conv-1': [
    {
      id: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'system',
      senderName: 'System',
      senderType: 'system',
      content: 'Percakapan dimulai untuk proyek E-Commerce Platform',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 'msg-2',
      conversationId: 'conv-1',
      senderId: 'worker-1',
      senderName: 'Worker #1',
      senderType: 'user',
      content:
        'Halo, saya sudah melihat PRD-nya. Ada beberapa hal yang ingin saya diskusikan mengenai arsitektur backend.',
      createdAt: new Date(Date.now() - 86400000 * 2 + 3600000).toISOString(),
    },
    {
      id: 'msg-3',
      conversationId: 'conv-1',
      senderId: 'me',
      senderName: 'You',
      senderType: 'user',
      content: 'Tentu, silakan. Apa yang perlu didiskusikan?',
      createdAt: new Date(Date.now() - 86400000 * 2 + 7200000).toISOString(),
    },
    {
      id: 'msg-4',
      conversationId: 'conv-1',
      senderId: 'worker-1',
      senderName: 'Worker #1',
      senderType: 'user',
      content:
        'Saya menyarankan untuk menggunakan microservice architecture agar lebih scalable. Untuk payment gateway, apakah sudah ada preferensi?',
      createdAt: new Date(Date.now() - 86400000 + 1800000).toISOString(),
    },
    {
      id: 'msg-5',
      conversationId: 'conv-1',
      senderId: 'me',
      senderName: 'You',
      senderType: 'user',
      content: 'Setuju untuk microservice. Untuk payment, kita pakai Midtrans saja.',
      createdAt: new Date(Date.now() - 86400000 + 3600000).toISOString(),
    },
    {
      id: 'msg-6',
      conversationId: 'conv-1',
      senderId: 'worker-1',
      senderName: 'Worker #1',
      senderType: 'user',
      content:
        'Baik, saya akan mulai dari backend API dan integrasi Midtrans. Milestone pertama estimasi selesai minggu depan.',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ],
  'conv-2': [
    {
      id: 'msg-10',
      conversationId: 'conv-2',
      senderId: 'system',
      senderName: 'System',
      senderType: 'system',
      content: 'Tim dibentuk untuk proyek Mobile Banking App',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: 'msg-11',
      conversationId: 'conv-2',
      senderId: 'worker-2',
      senderName: 'Worker #2',
      senderType: 'user',
      content:
        'Hai semua! Saya yang handle bagian UI/UX. Sudah lihat mood board yang di-share di dokumen.',
      createdAt: new Date(Date.now() - 86400000 * 3 + 7200000).toISOString(),
    },
    {
      id: 'msg-12',
      conversationId: 'conv-2',
      senderId: 'worker-3',
      senderName: 'Worker #3',
      senderType: 'user',
      content:
        'Saya di bagian mobile development. Untuk React Native, kita pakai Expo atau bare workflow?',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: 'msg-13',
      conversationId: 'conv-2',
      senderId: 'me',
      senderName: 'You',
      senderType: 'user',
      content: 'Saya prefer Expo supaya development lebih cepat. Bagaimana menurut kalian?',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ],
  'conv-3': [
    {
      id: 'msg-20',
      conversationId: 'conv-3',
      senderId: 'system',
      senderName: 'System',
      senderType: 'system',
      content: 'Percakapan dimulai untuk proyek Dashboard Analytics',
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: 'msg-21',
      conversationId: 'conv-3',
      senderId: 'worker-4',
      senderName: 'Worker #4',
      senderType: 'user',
      content: 'Dashboard sudah selesai 80%. Tinggal integrasi chart library dan export PDF.',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      attachments: [
        {
          name: 'dashboard-preview.png',
          url: '#',
          type: 'image/png',
        },
      ],
    },
  ],
  'conv-4': [
    {
      id: 'msg-30',
      conversationId: 'conv-4',
      senderId: 'system',
      senderName: 'System',
      senderType: 'system',
      content: 'Anda terhubung dengan BYTZ Support',
      createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
    {
      id: 'msg-31',
      conversationId: 'conv-4',
      senderId: 'support-1',
      senderName: 'BYTZ Support',
      senderType: 'ai',
      content:
        'Halo! Ada yang bisa kami bantu? Kami siap membantu Anda dengan pertanyaan seputar platform BYTZ.',
      createdAt: new Date(Date.now() - 86400000 * 1 + 60000).toISOString(),
    },
  ],
}

export function useChatMessages(conversationId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      const mockData = MOCK_MESSAGES[conversationId] ?? [
        {
          id: 'msg-default-1',
          conversationId,
          senderId: 'system',
          senderName: 'System',
          senderType: 'system' as const,
          content: 'Percakapan dimulai',
          createdAt: new Date().toISOString(),
        },
      ]
      setMessages(mockData)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [conversationId])

  useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  const sendMessage = useCallback(
    async (content: string, attachments?: { name: string; url: string; type: string }[]) => {
      const msg: ChatMessage = {
        id: `msg-${Date.now()}`,
        conversationId,
        senderId: 'me',
        senderName: 'You',
        senderType: 'user',
        content,
        createdAt: new Date().toISOString(),
        attachments,
      }
      setMessages((prev) => [...prev, msg])
    },
    [conversationId],
  )

  return { messages, loading, sendMessage, messagesEndRef }
}
