import { describe, expect, it } from 'vitest'
import en from '../locales/en/admin.json'
import id from '../locales/id/admin.json'
import dashboardSource from './_authenticated/dashboard.tsx?raw'

/**
 * ai_interactions logged every LLM call from day one and nothing ever read the
 * table: mv_ai_cost was declared as a materialized view in CLAUDE.md but landed
 * as a plain table that no writer touched, and migration 0014 dropped it. The
 * admin dashboard now aggregates the source table live, so these tests pin the
 * panel to the API contract the Go handler returns.
 */

const bundles = { id, en } as Record<string, Record<string, string>>

describe('AI usage panel', () => {
  it('reads the aiUsage field the dashboard handler sends', () => {
    expect(dashboardSource).toContain('data.aiUsage')
    expect(dashboardSource).toContain('aiUsage?.dailyCost')
  })

  it('renders both the trend chart and the per-model table', () => {
    expect(dashboardSource).toContain('ai_cost_trend')
    expect(dashboardSource).toContain('ai_cost_per_model')
  })

  it('reports the three headline figures CLAUDE.md asks for', () => {
    for (const key of ['ai_total_cost', 'ai_requests', 'ai_avg_tokens']) {
      expect(dashboardSource, key).toContain(key)
    }
  })

  // Cost is sub-cent, so it must not go through a Rupiah formatter.
  it('formats spend as USD, not Rupiah', () => {
    expect(dashboardSource).toContain('formatUsd(aiUsage?.totalCostUsd ?? 0)')
    expect(dashboardSource).not.toMatch(/formatCurrency(Compact)?\([^)]*costUsd/)
  })

  // The handler can return empty arrays; an empty panel must not read as broken.
  it('falls back to the no-data message when a series is empty', () => {
    expect(dashboardSource).toContain('aiCostSeries.length === 0')
    expect(dashboardSource).toContain('chart_no_data')
  })

  it('keeps the per-model table scrollable instead of overflowing the card', () => {
    expect(dashboardSource).toMatch(/overflow-[xy]-auto/)
  })
})

describe('dashboard translations', () => {
  // Only literal keys; template keys are resolved at runtime.
  const usedKeys = [
    ...new Set(Array.from(dashboardSource.matchAll(/\bt\('([a-z0-9_]+)'/g), (m) => m[1])),
  ]

  it('extracts the keys it is meant to check', () => {
    expect(usedKeys.length).toBeGreaterThan(20)
    expect(usedKeys).toContain('ai_cost_trend')
  })

  it.each(['id', 'en'])('defines every key the dashboard renders in %s', (lang) => {
    const missing = usedKeys.filter((k) => !bundles[lang][k])
    expect(missing, `missing in ${lang}/admin.json`).toEqual([])
  })

  it('translates the AI panel differently in each language', () => {
    for (const key of ['ai_cost_trend', 'ai_total_cost', 'ai_cost_note']) {
      expect(id[key as keyof typeof id], `id/${key}`).toBeTruthy()
      expect(en[key as keyof typeof en], `en/${key}`).toBeTruthy()
    }
    expect(id.ai_cost_note).not.toBe(en.ai_cost_note)
  })
})
