import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  APPLY_ERROR_KEYS,
  APPLY_PRESENTATION,
  type ApplyGate,
  type ApplyGateInput,
  applyErrorKey,
  applyRejectionMessage,
  isOpenToTalent,
  resolveApplyGate,
} from './apply-gate'

/**
 * One ordered decision behind the apply button, so every refusal the server
 * can hand back has a state the page can render before the click.
 */

const VERIFIED = { id: 't-1', cvFileUrl: 'cv.pdf', verificationStatus: 'verified' }

function input(overrides: Partial<ApplyGateInput> = {}): ApplyGateInput {
  return {
    projectStatus: 'matching',
    openPositions: 2,
    ownerId: 'owner-1',
    userId: 'u-1',
    userRole: 'talent',
    profile: VERIFIED,
    profileMissing: false,
    hasLiveApplication: false,
    ...overrides,
  }
}

describe('isOpenToTalent', () => {
  it.each([
    ['matching', true],
    ['team_forming', true],
    ['draft', false],
    ['matched', false],
    ['completed', false],
  ])('reads %s as %s', (status, expected) => {
    expect(isOpenToTalent(status)).toBe(expected)
  })
})

describe('resolveApplyGate', () => {
  it('lets a verified talent with a CV apply', () => {
    expect(resolveApplyGate(input())).toBe('ready')
  })

  it('closes a project that is not taking talent', () => {
    expect(resolveApplyGate(input({ projectStatus: 'matched' }))).toBe('closed')
  })

  it('sends a signed-out visitor to register', () => {
    expect(resolveApplyGate(input({ userId: null }))).toBe('guest')
  })

  it('offers nothing to a viewer who is not a talent', () => {
    expect(resolveApplyGate(input({ userRole: 'owner' }))).toBe('not_talent')
  })

  it('refuses the owner of the project being viewed', () => {
    expect(resolveApplyGate(input({ ownerId: 'u-1' }))).toBe('own_project')
  })

  /** A null ownerId on the public projection must not read as a match. */
  it('does not call a missing owner id the viewer', () => {
    expect(resolveApplyGate(input({ ownerId: null }))).toBe('ready')
  })

  it('asks a talent with no profile to finish signing up', () => {
    expect(resolveApplyGate(input({ profileMissing: true, profile: null }))).toBe('no_profile')
  })

  it('waits while the profile is still loading', () => {
    expect(resolveApplyGate(input({ profile: undefined }))).toBe('loading')
  })

  it('stops a suspended talent', () => {
    expect(
      resolveApplyGate(input({ profile: { ...VERIFIED, verificationStatus: 'suspended' } })),
    ).toBe('suspended')
  })

  it('asks for a CV before anything else about the profile', () => {
    expect(
      resolveApplyGate(
        input({ profile: { ...VERIFIED, cvFileUrl: null, verificationStatus: 'unverified' } }),
      ),
    ).toBe('no_cv')
  })

  it('waits for a CV that is still being verified', () => {
    expect(
      resolveApplyGate(input({ profile: { ...VERIFIED, verificationStatus: 'cv_parsing' } })),
    ).toBe('cv_parsing')
  })

  it('reports an application that is already live', () => {
    expect(resolveApplyGate(input({ hasLiveApplication: true }))).toBe('applied')
  })

  it('reports a project whose seats are all taken', () => {
    expect(resolveApplyGate(input({ openPositions: 0 }))).toBe('no_seats')
  })

  /**
   * A projection without the field must not read as zero seats: that would
   * disable the button on every project it was missing from.
   */
  it('treats an absent seat count as no obstacle', () => {
    expect(resolveApplyGate(input({ openPositions: null }))).toBe('ready')
  })
})

describe('APPLY_PRESENTATION', () => {
  it('covers every gate', () => {
    const gates: ApplyGate[] = [
      'closed',
      'guest',
      'not_talent',
      'own_project',
      'no_profile',
      'loading',
      'suspended',
      'no_cv',
      'cv_parsing',
      'applied',
      'no_seats',
      'ready',
    ]
    for (const gate of gates) expect(APPLY_PRESENTATION[gate]).toBeDefined()
  })

  it('only makes the ready and loading states look pressable', () => {
    expect(APPLY_PRESENTATION.ready.label).toBe('apply_project')
    expect(APPLY_PRESENTATION.applied.label).toBe('applied')
    expect(APPLY_PRESENTATION.closed.label).toBeNull()
  })

  it('gives a fixable state somewhere to go', () => {
    expect(APPLY_PRESENTATION.no_cv.notice?.to).toBe('/talent/profile')
    expect(APPLY_PRESENTATION.no_profile.notice?.to).toBe('/talent/register')
    expect(APPLY_PRESENTATION.no_seats.notice?.to).toBeNull()
  })
})

/**
 * These keys reach i18next through a variable, not a literal.
 *
 * `i18n-keys.test.ts` reads `t('literal')` out of files that declare exactly
 * one namespace, and this flow satisfies neither condition: the detail view
 * binds three namespaces, and every key here arrives as `tt(notice.key)`. So
 * the parity guard the repo relies on has a hole exactly where the indirection
 * is, and it is closed here instead.
 */
describe('every key this module names', () => {
  const LOCALES = resolve(dirname(fileURLToPath(import.meta.url)), '../../locales')

  const used = [
    ...Object.values(APPLY_PRESENTATION).flatMap((p) =>
      p.notice ? [p.notice.key, p.notice.action] : [],
    ),
    ...Object.values(APPLY_ERROR_KEYS),
    // The two the component names directly.
    'apply_success',
    'apply_error',
  ].filter((key): key is string => key !== null)

  it.each(['id', 'en'])('resolves in %s', (language) => {
    const catalog = JSON.parse(
      readFileSync(join(LOCALES, language, 'talent.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(used.filter((key) => typeof catalog[key] !== 'string')).toEqual([])
  })

  it('reads enough keys to be worth trusting', () => {
    expect(new Set(used).size).toBeGreaterThan(8)
  })
})

describe('applyErrorKey', () => {
  it.each([
    ['TALENT_CV_REQUIRED', 'apply_blocked_no_cv'],
    ['TALENT_NOT_VERIFIED', 'apply_blocked_cv_parsing'],
    ['TALENT_SUSPENDED', 'apply_blocked_suspended'],
    ['CONFLICT', 'apply_already_applied'],
    ['VALIDATION_ERROR', 'apply_own_project'],
    ['PROJECT_VALIDATION_INVALID_STATUS', 'apply_project_closed'],
    ['AUTH_FORBIDDEN', 'apply_blocked_no_profile'],
  ])('sharpens %s', (code, key) => {
    expect(applyErrorKey(code)).toBe(key)
  })

  it('leaves a code it has no better wording for alone', () => {
    expect(applyErrorKey('INTERNAL_ERROR')).toBeNull()
  })

  it('survives a response that carried no code', () => {
    expect(applyErrorKey(undefined)).toBeNull()
  })
})

describe('applyRejectionMessage', () => {
  const translate = (key: string) => `t:${key}`

  it('prefers the wording written for this flow', () => {
    const err = new ApiError('Data konflik', 409, 'CONFLICT')
    expect(applyRejectionMessage(err, translate)).toBe('t:apply_already_applied')
  })

  it('keeps the localized message for every other code', () => {
    const err = new ApiError('Terjadi kesalahan', 500, 'INTERNAL_ERROR')
    expect(applyRejectionMessage(err, translate)).toBe('Terjadi kesalahan')
  })

  it('reports a network failure that never reached the server', () => {
    expect(applyRejectionMessage(new TypeError('Failed to fetch'), translate)).toBe(
      'Failed to fetch',
    )
  })

  it('still says something when the thrown value is not an error', () => {
    expect(applyRejectionMessage('boom', translate)).toBe('t:apply_error')
  })
})
