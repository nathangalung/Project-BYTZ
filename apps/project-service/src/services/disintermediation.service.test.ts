import { describe, expect, it } from 'vitest'
import {
  type BypassMatch,
  detectBypassAttempts,
  hasBypassAttempt,
} from './disintermediation.service'

describe('disintermediation.service', () => {
  describe('detectBypassAttempts', () => {
    it('detects +62 prefixed Indonesian phone number', () => {
      const matches = detectBypassAttempts('Call me at +6281234567890')
      const phoneMatches = matches.filter((m) => m.pattern === 'indonesianPhone')
      expect(phoneMatches).toHaveLength(1)
      expect(phoneMatches[0]?.match).toContain('81234567890')
    })

    it('detects 0-prefixed Indonesian phone number', () => {
      const matches = detectBypassAttempts('Nomor saya 08123456789')
      const phoneMatches = matches.filter((m) => m.pattern === 'indonesianPhone')
      expect(phoneMatches).toHaveLength(1)
      expect(phoneMatches[0]?.match).toContain('08123456789')
    })

    it('detects email and whatsapp link in same message', () => {
      const matches = detectBypassAttempts('Hubungi saya di test@email.com atau wa.me/628123')
      expect(matches.length).toBeGreaterThanOrEqual(2)
      const patterns = matches.map((m: BypassMatch) => m.pattern)
      expect(patterns).toContain('email')
      expect(patterns).toContain('whatsappLink')
    })

    it('returns no matches for plain conversational message', () => {
      const matches = detectBypassAttempts('How is the project going?')
      expect(matches).toHaveLength(0)
    })

    it('detects telegram link', () => {
      const matches = detectBypassAttempts('Add me at t.me/some_user')
      const telegram = matches.filter((m) => m.pattern === 'telegramLink')
      expect(telegram).toHaveLength(1)
    })

    it('detects instagram handle', () => {
      const matches = detectBypassAttempts('Cek instagram.com/my.account ya')
      const ig = matches.filter((m) => m.pattern === 'instagram')
      expect(ig).toHaveLength(1)
    })

    it('detects linkedin/github external social', () => {
      const matches = detectBypassAttempts('Visit linkedin.com/in/someone and github.com/someone')
      const ext = matches.filter((m) => m.pattern === 'externalSocial')
      expect(ext.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('hasBypassAttempt', () => {
    it('returns true when any pattern matches', () => {
      expect(hasBypassAttempt('email me at foo@bar.com')).toBe(true)
    })

    it('returns false when no patterns match', () => {
      expect(hasBypassAttempt('Hello, how are you?')).toBe(false)
    })
  })
})
