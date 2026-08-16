#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import lighthouse from 'lighthouse'
import puppeteer from 'puppeteer'

const WEB = 'http://localhost:5173'
const ADMIN = 'http://localhost:5174'

const urls = process.argv.slice(2).filter((a) => a.startsWith('http'))

// Public pages (no auth)
const publicUrls = [
  `${WEB}`,
  `${WEB}/login`,
  `${WEB}/register`,
  `${WEB}/browse-projects`,
  `${WEB}/about`,
  `${WEB}/request-project`,
  `${WEB}/check-email`,
  `${WEB}/verify-email`,
]

// Authenticated pages - owner
const ownerUrls = [
  `${WEB}/dashboard`,
  `${WEB}/projects`,
  `${WEB}/projects/new`,
  `${WEB}/notifications`,
  `${WEB}/payments`,
  `${WEB}/messages`,
  `${WEB}/settings`,
  `${WEB}/verify-phone`,
]

// Authenticated pages - talent
const talentUrls = [
  `${WEB}/talent`,
  `${WEB}/talent/register`,
  `${WEB}/talent/profile`,
]

// Admin public (login page)
const adminPublicUrls = [
  `${ADMIN}`,
]

// Admin authenticated pages (need admin login)
const adminAuthUrls = [
  `${ADMIN}/dashboard`,
  `${ADMIN}/users`,
  `${ADMIN}/projects`,
  `${ADMIN}/disputes`,
  `${ADMIN}/finance`,
  `${ADMIN}/settings`,
  `${ADMIN}/audit-log`,
]

const publicThresholds = { performance: 50, accessibility: 90, 'best-practices': 90, seo: 90 }
const authThresholds = { performance: 50, accessibility: 85, 'best-practices': 90, seo: 0 }

const TEST_OWNER = {
  name: 'LH Owner Test',
  email: `lh-owner-${Date.now()}@kerjacus.test`,
  password: 'TestPassword123!',
  phone: `+6281${String(Date.now()).slice(-10)}`,
  role: 'owner',
}

const TEST_TALENT = {
  name: 'LH Talent Test',
  email: `lh-talent-${Date.now()}@kerjacus.test`,
  password: 'TestPassword123!',
  phone: `+6282${String(Date.now()).slice(-10)}`,
  role: 'talent',
}

async function waitForServer(url, maxWait = 5000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok || res.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function registerAndLogin(user) {
  try {
    await fetch('http://localhost:3001/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    })
    const loginRes = await fetch('http://localhost:3001/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
      redirect: 'manual',
    })
    const setCookieHeaders = loginRes.headers.getSetCookie?.() ?? []
    if (setCookieHeaders.length === 0) return null
    return setCookieHeaders.map((h) => {
      const [pair] = h.split(';')
      const [name, ...rest] = pair.split('=')
      return { name: name.trim(), value: rest.join('=').trim(), domain: 'localhost', path: '/' }
    })
  } catch {
    return null
  }
}

async function setCookiesInBrowser(browser, cookies) {
  const page = await browser.newPage()
  await page.setCookie(...cookies)
  await page.close()
}

async function run() {
  const webReady = await waitForServer(WEB)
  if (!webReady) {
    console.error(`Web server not running on ${WEB}. Start with: make dev`)
    process.exit(1)
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })
  const port = new URL(browser.wsEndpoint()).port

  mkdirSync('lighthouse-reports', { recursive: true })

  let targetUrls = urls.length ? urls : [...publicUrls]

  if (!urls.length) {
    // Login as owner
    console.log('Registering & logging in as owner...')
    const ownerCookies = await registerAndLogin(TEST_OWNER)
    if (ownerCookies) {
      console.log(`  Owner logged in. Adding ${ownerUrls.length} owner pages.`)
      await setCookiesInBrowser(browser, ownerCookies)
      targetUrls.push(...ownerUrls)
    } else {
      console.log('  Owner login failed. Skipping owner pages.')
    }

    // Login as talent (separate session - we'll set cookies before talent pages)
    console.log('Registering & logging in as talent...')
    const talentCookies = await registerAndLogin(TEST_TALENT)
    if (talentCookies) {
      console.log(`  Talent logged in. Adding ${talentUrls.length} talent pages.`)
      // Store for later
      targetUrls.push(...talentUrls.map((u) => `TALENT:${u}`))
      // Keep talent cookies for later
      globalThis.__talentCookies = talentCookies
    } else {
      console.log('  Talent login failed. Skipping talent pages.')
    }

    // Admin panel
    const adminReady = await waitForServer(ADMIN, 3000)
    if (adminReady) {
      targetUrls.push(...adminPublicUrls)
      // Admin login (seed admin: admin@bytz.id / Password123!)
      console.log('Attempting admin login...')
      const adminPage = await browser.newPage()
      try {
        await adminPage.goto(`${ADMIN}`, { waitUntil: 'networkidle0', timeout: 10000 })
        const inputs = await adminPage.$$('input')
        if (inputs.length >= 2) {
          await inputs[0].type('admin@bytz.id')
          await inputs[1].type('Password123!')
          const btn = await adminPage.$('button[type="submit"]')
          if (btn) {
            await btn.click()
            await adminPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {})
          }
        }
        const adminCookies = await adminPage.cookies()
        if (adminCookies.length > 0) {
          console.log(`  Admin logged in. Adding ${adminAuthUrls.length} admin pages.`)
          targetUrls.push(...adminAuthUrls)
        } else {
          console.log('  Admin login failed. Auditing login page only.')
        }
      } catch {
        console.log('  Admin login failed. Auditing login page only.')
      }
      await adminPage.close()
    } else {
      console.log('Admin server not running. Skipping admin pages.')
    }
  }

  console.log(`\nLighthouse audit (${targetUrls.length} pages) [mobile emulation]\n`)

  const results = []

  for (const rawUrl of targetUrls) {
    const isTalent = rawUrl.startsWith('TALENT:')
    const url = isTalent ? rawUrl.replace('TALENT:', '') : rawUrl
    const isAdmin = url.includes(':5174')
    const pageName = (isAdmin ? 'admin' : isTalent ? 'talent' : '') +
      (new URL(url).pathname.replace(/\//g, '_') || '_home')
    const label = `${isAdmin ? '[admin] ' : isTalent ? '[talent] ' : ''}${new URL(url).pathname || '/'}`

    // Switch cookies for talent pages
    if (isTalent && globalThis.__talentCookies) {
      await setCookiesInBrowser(browser, globalThis.__talentCookies)
    }

    console.log(`Auditing ${label} ...`)

    try {
      const { lhr, report } = await lighthouse(url, {
        port: Number(port),
        output: 'html',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        // Mobile emulation (Lighthouse default is mobile)
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
        throttling: { cpuSlowdownMultiplier: 2, throughputKbps: 10240, requestLatencyMs: 40 },
      })

      writeFileSync(`lighthouse-reports/${pageName}.html`, report)

      const scores = {}
      for (const [key, cat] of Object.entries(lhr.categories)) {
        scores[key] = Math.round((cat.score ?? 0) * 100)
      }

      const isAuthPage = !publicUrls.includes(url)
      const thresholds = isAuthPage ? authThresholds : publicThresholds
      const pass = Object.entries(thresholds).every(([k, min]) => (scores[k] ?? 0) >= min)

      console.log(
        `  Perf: ${scores.performance}  A11y: ${scores.accessibility}  BP: ${scores['best-practices']}  SEO: ${scores.seo}  ${pass ? 'PASS' : 'FAIL'}`,
      )

      results.push({ url: label, scores, pass })
    } catch (err) {
      console.log(`  SKIP (${err.message})`)
      results.push({ url: label, scores: { performance: 0, accessibility: 0, 'best-practices': 0, seo: 0 }, pass: false })
    }
  }

  await browser.close()

  // Summary
  console.log('\n' + 'Page'.padEnd(40) + 'Perf  A11y  BP    SEO   Status')
  for (const r of results) {
    console.log(
      r.url.padEnd(40) +
      String(r.scores.performance).padEnd(6) +
      String(r.scores.accessibility).padEnd(6) +
      String(r.scores['best-practices']).padEnd(6) +
      String(r.scores.seo).padEnd(6) +
      (r.pass ? 'PASS' : 'FAIL'),
    )
  }

  const avg = (key) => Math.round(results.reduce((s, r) => s + (r.scores[key] ?? 0), 0) / results.length)
  console.log(
    '\nAverage:'.padEnd(40) +
    String(avg('performance')).padEnd(6) +
    String(avg('accessibility')).padEnd(6) +
    String(avg('best-practices')).padEnd(6) +
    String(avg('seo')),
  )

  console.log(`\nPages audited: ${results.length} (mobile emulation)`)
  console.log(`Reports saved to lighthouse-reports/`)

  const allPass = results.every((r) => r.pass)
  console.log(allPass ? 'All pages pass thresholds' : 'Some pages below thresholds')
  process.exit(allPass ? 0 : 1)
}

run().catch((err) => {
  console.error('Lighthouse failed:', err.message)
  process.exit(1)
})
