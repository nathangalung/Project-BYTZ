import { AppError } from '@kerjacus/shared'
import { describe, expect, it } from 'vitest'
import { validateTeamAssignments } from './team-assignment'

const open = (...ids: string[]) => new Set(ids)

describe('validateTeamAssignments', () => {
  it('accepts one talent per open package', () => {
    expect(() =>
      validateTeamAssignments(open('wp-1', 'wp-2'), new Set(), [
        { workPackageId: 'wp-1', talentId: 't-1' },
        { workPackageId: 'wp-2', talentId: 't-2' },
      ]),
    ).not.toThrow()
  })

  it('rejects a package that is not open', () => {
    expect(() =>
      validateTeamAssignments(open('wp-1'), new Set(), [
        { workPackageId: 'wp-closed', talentId: 't-1' },
      ]),
    ).toThrow(AppError)
  })

  it('rejects the same package staffed twice', () => {
    expect(() =>
      validateTeamAssignments(open('wp-1', 'wp-2'), new Set(), [
        { workPackageId: 'wp-1', talentId: 't-1' },
        { workPackageId: 'wp-1', talentId: 't-2' },
      ]),
    ).toThrow('staffed twice')
  })

  it('rejects one talent taking two positions in the batch', () => {
    expect(() =>
      validateTeamAssignments(open('wp-1', 'wp-2'), new Set(), [
        { workPackageId: 'wp-1', talentId: 't-1' },
        { workPackageId: 'wp-2', talentId: 't-1' },
      ]),
    ).toThrow('two positions')
  })

  it('rejects a talent already assigned elsewhere on the project', () => {
    expect(() =>
      validateTeamAssignments(open('wp-2'), new Set(['t-1']), [
        { workPackageId: 'wp-2', talentId: 't-1' },
      ]),
    ).toThrow(AppError)
  })

  it('accepts an empty batch', () => {
    expect(() => validateTeamAssignments(open('wp-1'), new Set(), [])).not.toThrow()
  })
})
