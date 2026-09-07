#!/usr/bin/env bun
/**
 * Fail the build when a bundled service reads NODE_ENV in a form bun inlines.
 *
 * `bun build` substitutes the dotted `process.env.NODE_ENV` at bundle time.
 * auth-service and project-service are bundled in a Docker stage that never
 * sets NODE_ENV, so every such read compiled to the literal false and stayed
 * false regardless of what the running container said.
 *
 * That was not theoretical. In production it disabled the Secure attribute on
 * the session cookie, disabled email verification on sign-in, dropped
 * admin.kerjacus.id and www.kerjacus.id from trustedOrigins so the admin panel
 * answered 403, and folded away the guard on `devCode`, so the OTP request
 * endpoint returned the verification code in its own response body.
 *
 * Bracket access survives bundling. Verified against bun 1.3.9: the dotted
 * form compiles to `var x = false`, `process.env["NODE_ENV"]` stays a lookup.
 * Anything that must follow the deployed environment reads it that way, or
 * calls isProduction() from @kerjacus/config.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Only apps that go through bun build are affected.
const BUNDLED = ['apps/auth-service/src', 'apps/project-service/src', 'packages']
const DOTTED = /process\.env\.NODE_ENV/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const offenders: string[] = []
for (const root of BUNDLED) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Prose in a comment explaining the rule is not a violation of it.
      const code = line.replace(/^\s*(\*|\/\/).*$/, '')
      if (DOTTED.test(code)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
}

if (offenders.length > 0) {
  console.error('NODE_ENV read in a form bun build inlines:\n')
  for (const o of offenders) console.error(`  ${o}`)
  console.error(
    '\nUse isProduction() from @kerjacus/config, or process.env["NODE_ENV"].',
  )
  process.exit(1)
}

console.log(`runtime env check passed (${BUNDLED.length} roots scanned)`)
