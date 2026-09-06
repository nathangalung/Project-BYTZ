import { afterEach, describe, expect, it } from 'vitest'
import { isProduction } from './index'

/**
 * The value must follow the running container, not the machine that built the
 * bundle. Reading it at call time is the whole point, so the test changes the
 * environment between calls: a build-time constant cannot pass this.
 */
describe('isProduction', () => {
  const original = process.env['NODE_ENV']
  afterEach(() => {
    if (original === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = original
  })

  it('is true in production', () => {
    process.env['NODE_ENV'] = 'production'
    expect(isProduction()).toBe(true)
  })

  it('is false in development', () => {
    process.env['NODE_ENV'] = 'development'
    expect(isProduction()).toBe(false)
  })

  it('is false when unset', () => {
    delete process.env['NODE_ENV']
    expect(isProduction()).toBe(false)
  })

  it('follows a change made after the module loaded', () => {
    process.env['NODE_ENV'] = 'development'
    expect(isProduction()).toBe(false)
    process.env['NODE_ENV'] = 'production'
    expect(isProduction()).toBe(true)
  })
})
