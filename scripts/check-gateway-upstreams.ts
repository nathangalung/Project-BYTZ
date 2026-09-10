/**
 * Every upstream the gateway template names must be supplied by both compose
 * files.
 *
 * The routing table is one template rendered per environment. Because
 * NGINX_ENVSUBST_FILTER pins substitution to the KC_ prefix, an unset variable
 * is left in the file verbatim, and nginx then reads ${KC_X} as one of its own
 * variables and refuses to start: `unknown "kc_x" variable`. Measured, not
 * assumed. That is the good failure - loud, and at container start rather than
 * silently proxying somewhere wrong - but it still only happens in whichever
 * environment was forgotten, and only at deploy time. Development
 * previously held a second copy of this table in dynamic.yml and the copies
 * drifted for months; this is the guard that stops the same class of drift
 * returning through the substitution layer instead.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

const template = read('apps/gateway/nginx-api-gateway.conf.template')
const composes = {
  'docker-compose.yml': read('docker-compose.yml'),
  'docker-compose.prod.yml': read('docker-compose.prod.yml'),
}

// Placeholders as written in proxy_pass and Host, not the prose above them.
const required = new Set(
  [...template.matchAll(/\$\{(KC_[A-Z0-9_]+)\}/g)].map((m) => m[1]),
)

const problems: string[] = []

if (required.size === 0) {
  problems.push('no ${KC_*} placeholders found; the template is no longer parameterised')
}

for (const [file, body] of Object.entries(composes)) {
  for (const key of required) {
    // Compose supplies these as `KEY: value` under the gateway service.
    const supplied = new RegExp(`^\\s+${key}:\\s*\\S`, 'm').test(body)
    if (!supplied) problems.push(`${file} does not set ${key}`)
  }
}

// The second copy of the routing table must stay gone.
for (const [file, body] of Object.entries(composes)) {
  if (/dynamic\.ya?ml:/.test(body)) {
    problems.push(`${file} mounts a dynamic.yml again; the routing table is the template`)
  }
}

/**
 * The internal-payment refusal must not be a prefix location.
 *
 * nginx matches prefix locations byte-exactly; Fiber's CaseSensitive defaults
 * to false and payment-service did not set it. So the two tiers disagreed
 * about what a path is, and one capital letter walked through: measured
 * against the rendered template, `/api/v1/payments/internal/release` answered
 * 404 while `/api/v1/payments/Internal/release` answered 200 and returned a
 * real escrow balance. Those routes release escrow and issue refunds on
 * X-Service-Auth alone, with no session behind them.
 *
 * Checked here rather than by rendering nginx, because this gate already reads
 * the template and CI has no nginx. It asserts the property that failed - a
 * case-insensitive match - not the exact spelling of the line.
 */
// Comments stripped first: the prose above this location says the word
// "location" too, and matching it reports the comment as the directive.
const directives = template
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

const internalRefusal = /^\s*location\s+([^{]+)\{[^}]*return\s+404/gm
let sawInternalRefusal = false
for (const match of directives.matchAll(internalRefusal)) {
  const pattern = (match[1] ?? '').trim()
  if (!/payments\/internal/i.test(pattern)) continue
  sawInternalRefusal = true
  // `~*` is the only nginx form that matches regardless of case, and a regex
  // location outranks every prefix location whatever the order.
  if (!pattern.startsWith('~*')) {
    problems.push(
      `the /api/v1/payments/internal refusal is \`location ${pattern}\`, which nginx matches ` +
        'case-sensitively while Fiber does not; use `location ~* ^/api/v1/payments/internal`',
    )
  }
}
if (!sawInternalRefusal) {
  problems.push('no location refuses /api/v1/payments/internal; escrow release is public')
}

if (problems.length > 0) {
  console.error('Gateway upstream drift:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

console.log(
  `gateway template: ${required.size} upstreams, all set in ${Object.keys(composes).length} compose files`,
)
