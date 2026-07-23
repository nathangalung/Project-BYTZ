import { describe, expect, it } from 'vitest'
import dashboardSource from './_authenticated/dashboard.tsx?raw'
import authLayoutSource from './_authenticated.tsx?raw'

/**
 * The dashboard was owner-only content, two create-project CTAs and a spending
 * stat, with no role branch, so a talent that logged in landed on it. Talent
 * now redirects to its own home, and the owner project list plus its sidebar
 * entry are gated to owner.
 */
describe('owner controls stay out of the talent view', () => {
  it('redirects talent off the owner dashboard', () => {
    expect(dashboardSource).toContain("role === 'talent'")
    expect(dashboardSource).toContain("redirect({ to: '/talent' })")
  })

  it('gates the owner project list route to owner', () => {
    expect(authLayoutSource).toContain("path === '/projects'")
  })

  it('points the sidebar dashboard link at the talent home for talent', () => {
    expect(authLayoutSource).toContain("? '/talent' : '/dashboard'")
  })

  it('shows the My Projects entry to owner only', () => {
    expect(authLayoutSource).toContain("role === 'owner' && (")
  })
})
