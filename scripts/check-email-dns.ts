/**
 * The sending domain in EMAIL_FROM must be able to send, and Resend must agree.
 *
 * Nothing in the product can report this. Password recovery answers identically
 * whether the address has an account, deliberately, so that the form cannot be
 * used as an account-existence oracle - and that same property makes a send
 * rejected for an unverified domain look exactly like a delivered one. The
 * platform sat with zero deliverable mail for months and every screen looked
 * correct throughout.
 *
 * Four records decide it, and each fails differently: DKIM missing means every
 * message is unsigned, SPF missing means the envelope fails alignment, the MX
 * on send.<domain> is where bounce and complaint feedback returns, and DMARC
 * governs what receivers do when the first two disagree.
 *
 * Run after changing DNS and again after a deploy. With RESEND_API_KEY set it
 * also asks Resend, because DNS being right and Resend having noticed are two
 * separate facts - verification is a snapshot Resend took, not a live read.
 */

const DOH = 'https://1.1.1.1/dns-query'

type Finding = { level: 'fail' | 'warn'; message: string }

const findings: Finding[] = []
const fail = (message: string) => findings.push({ level: 'fail', message })
const warn = (message: string) => findings.push({ level: 'warn', message })

async function resolve(name: string, type: 'TXT' | 'MX'): Promise<string[]> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: 'application/dns-json' },
  })
  if (!res.ok) throw new Error(`DoH ${name} ${type}: ${res.status}`)
  const body = (await res.json()) as { Answer?: { data: string }[] }
  // TXT answers arrive quoted, and long ones arrive as concatenated strings.
  return (body.Answer ?? []).map((a) => a.data.replace(/"\s*"/g, '').replace(/^"|"$/g, ''))
}

/** Domain part of `Name <local@domain>` or a bare address. */
export function senderDomain(emailFrom: string): string | undefined {
  const address = emailFrom.match(/<([^>]+)>/)?.[1] ?? emailFrom
  const domain = address.split('@')[1]?.trim().toLowerCase()
  return domain && domain.includes('.') ? domain : undefined
}

/** Root of a sending subdomain, for the orphan check. */
function registrableRoot(domain: string): string {
  const labels = domain.split('.')
  // .id runs two-label suffixes (co.id, or.id) alongside bare .id.
  const keep = labels.length > 2 && labels.at(-2)?.length === 2 ? 3 : 2
  return labels.slice(-keep).join('.')
}

async function checkDkim(domain: string) {
  const name = `resend._domainkey.${domain}`
  const records = await resolve(name, 'TXT')
  const key = records.find((r) => r.includes('p='))
  if (!key) {
    fail(`${name} has no DKIM key. Every message ships unsigned and fails DMARC.`)
    return
  }
  if (/p=\s*;?\s*$/.test(key)) fail(`${name} carries an empty p=, which revokes the key.`)
}

async function checkSpf(domain: string) {
  const name = `send.${domain}`
  const [txt, mx] = await Promise.all([resolve(name, 'TXT'), resolve(name, 'MX')])

  const spf = txt.find((r) => r.startsWith('v=spf1'))
  if (!spf) fail(`${name} has no SPF record. The envelope domain fails alignment.`)
  else if (!spf.includes('include:amazonses.com'))
    fail(`${name} SPF does not include amazonses.com, which is what Resend sends through: ${spf}`)

  if (mx.length === 0)
    fail(`${name} has no MX. Bounces and complaints have nowhere to return, so reputation decays unseen.`)
  else if (!mx.some((r) => r.includes('feedback-smtp')))
    warn(`${name} MX does not look like a Resend feedback endpoint: ${mx.join(', ')}`)
}

async function checkDmarc(domain: string) {
  const own = await resolve(`_dmarc.${domain}`, 'TXT')
  if (own.some((r) => r.startsWith('v=DMARC1'))) return

  // Absent at the subdomain, receivers fall back to the organisational domain.
  const root = registrableRoot(domain)
  const inherited = root === domain ? [] : await resolve(`_dmarc.${root}`, 'TXT')
  if (inherited.some((r) => r.startsWith('v=DMARC1'))) {
    warn(
      `_dmarc.${domain} is absent, so policy is inherited from _dmarc.${root}, which also governs mail sent by hand from that domain.`,
    )
    return
  }
  warn(
    `No DMARC for ${domain}. Sending still works, but there are no aggregate reports, so abuse of the domain is invisible. Start at p=none.`,
  )
}

/** Records left behind when a domain is removed from Resend but not from DNS. */
async function checkOrphans(domain: string) {
  const root = registrableRoot(domain)
  if (root === domain) return

  // Match the record shape, not merely a name that answers. Wildcard TXT is
  // common enough that presence alone would report an orphan on every domain.
  const [dkimRecords, spfRecords] = await Promise.all([
    resolve(`resend._domainkey.${root}`, 'TXT'),
    resolve(`send.${root}`, 'TXT'),
  ])
  const dkim = dkimRecords.filter((r) => r.includes('p=MIG'))
  const spf = spfRecords.filter((r) => r.startsWith('v=spf1') && r.includes('amazonses.com'))
  if (dkim.length > 0 || spf.length > 0) {
    warn(
      `${root} still carries Resend records (${[dkim.length && 'DKIM', spf.length && 'SPF'].filter(Boolean).join(' and ')}) while ${domain} is the sender. A DKIM key Resend no longer holds authorises nothing and reads as an active delegation. Delete them.`,
    )
  }
}

async function checkResendAgrees(domain: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    warn('RESEND_API_KEY unset, so Resend was not asked whether it agrees. DNS alone does not send mail.')
    return
  }

  const res = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (res.status === 401 || res.status === 400) {
    fail('RESEND_API_KEY is rejected by Resend. Sends will fail regardless of DNS.')
    return
  }
  if (!res.ok) {
    warn(`Resend answered ${res.status}; could not confirm the domain.`)
    return
  }

  const body = (await res.json()) as { data?: { name: string; status: string }[] }
  const match = body.data?.find((d) => d.name.toLowerCase() === domain)
  if (!match) {
    fail(`Resend has no domain named ${domain}. Every send answers 403.`)
    return
  }
  if (match.status !== 'verified') fail(`Resend reports ${domain} as "${match.status}", not verified.`)
}

async function main() {
  const emailFrom = process.env.EMAIL_FROM ?? 'KerjaCUS! <noreply@notify.kerjacus.id>'
  const domain = senderDomain(emailFrom)
  if (!domain) {
    console.error(`EMAIL_FROM does not carry a sender domain: ${emailFrom}`)
    process.exit(1)
  }

  console.log(`Sending domain: ${domain}`)

  await Promise.all([
    checkDkim(domain),
    checkSpf(domain),
    checkDmarc(domain),
    checkOrphans(domain),
    checkResendAgrees(domain),
  ])

  for (const { level, message } of findings) {
    console.log(`${level === 'fail' ? 'FAIL' : 'WARN'}  ${message}`)
  }

  const failed = findings.filter((f) => f.level === 'fail').length
  if (failed > 0) {
    console.log(`\n${failed} blocking problem${failed === 1 ? '' : 's'}. Mail will not be delivered.`)
    process.exit(1)
  }
  console.log(findings.length === 0 ? '\nAll checks passed.' : '\nNo blocking problems.')
}

if (import.meta.main) await main()
