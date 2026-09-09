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

if (problems.length > 0) {
  console.error('Gateway upstream drift:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

console.log(
  `gateway template: ${required.size} upstreams, all set in ${Object.keys(composes).length} compose files`,
)
