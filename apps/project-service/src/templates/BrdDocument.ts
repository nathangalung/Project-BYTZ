import { Document } from '@react-pdf/renderer'
import { createElement as h } from 'react'
import { Body, DataTable, DocPage, H1, H2, H3, OrderedList, TableCaption } from './pdf-typography'

export type BrdPdfContent = {
  executiveSummary: string
  businessObjectives: string[]
  successMetrics: string[]
  scope: string
  outOfScope: string[]
  stakeholders: { title: string; content: string }[]
  targetUsers: { title: string; content: string }[]
  businessRules: string[]
  expectedBenefits: string[]
  timelinePhases: { title: string; content: string }[]
  functionalRequirements: { title: string; content: string }[]
  nonFunctionalRequirements: string[]
  estimatedPriceMin: number
  estimatedPriceMax: number
  estimatedTimelineDays: number
  estimatedTeamSize: number
  riskAssessment: string[]
}

export type BrdLanguage = 'id' | 'en'

export type BrdPdfData = {
  projectTitle: string
  content: BrdPdfContent
  language: BrdLanguage
  generatedAt: string
  version: number
  watermark?: string
}

const LABELS: Record<BrdLanguage, Record<string, string>> = {
  id: {
    doc: 'Dokumen Kebutuhan Bisnis',
    summary: 'Ringkasan Eksekutif',
    objectives: 'Tujuan Bisnis',
    metrics: 'Metrik Keberhasilan',
    scope: 'Ruang Lingkup',
    outScope: 'Di Luar Ruang Lingkup',
    stakeholders: 'Pemangku Kepentingan dan Peran',
    targetUsers: 'Segmen Pengguna Sasaran',
    rules: 'Aturan Bisnis',
    benefits: 'Manfaat yang Diharapkan',
    phases: 'Tahapan Waktu',
    func: 'Kebutuhan Fungsional',
    nonFunc: 'Kebutuhan Non-Fungsional',
    estimation: 'Estimasi',
    risk: 'Penilaian Risiko',
    version: 'Versi',
    date: 'Tanggal',
    price: 'Estimasi Biaya',
    timeline: 'Estimasi Waktu',
    team: 'Estimasi Tim',
    days: 'hari',
    people: 'orang',
    item: 'Komponen',
    value: 'Nilai',
  },
  en: {
    doc: 'Business Requirements Document',
    summary: 'Executive Summary',
    objectives: 'Business Objectives',
    metrics: 'Success Metrics',
    scope: 'Scope',
    outScope: 'Out of Scope',
    stakeholders: 'Stakeholders and Roles',
    targetUsers: 'Target User Segments',
    rules: 'Business Rules',
    benefits: 'Expected Benefits',
    phases: 'High-Level Timeline Phases',
    func: 'Functional Requirements',
    nonFunc: 'Non-Functional Requirements',
    estimation: 'Estimation',
    risk: 'Risk Assessment',
    version: 'Version',
    date: 'Date',
    price: 'Estimated Cost',
    timeline: 'Estimated Timeline',
    team: 'Estimated Team',
    days: 'days',
    people: 'people',
    item: 'Item',
    value: 'Value',
  },
}

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

// An unanswered template section is omitted, not printed empty. Total on
// purpose: the content is model-authored JSONB and a row written before these
// sections existed carries none of them.
function titled(heading: string, items: { title: string; content: string }[] | undefined) {
  if (!items || items.length === 0) return null
  return [
    h(H2, { key: `h2-${heading}` }, heading),
    items.map((item, i) => [
      h(H3, { key: `h-${heading}-${item.title}-${i}` }, `${i + 1}. ${item.title}`),
      h(Body, { key: `b-${heading}-${item.title}-${i}` }, item.content),
    ]),
  ]
}

function listed(heading: string, items: string[] | undefined) {
  if (!items || items.length === 0) return null
  return [h(H2, { key: `h2-${heading}` }, heading), h(OrderedList, { key: `ol-${heading}`, items })]
}

export function BrdDocument({ data }: { data: BrdPdfData }) {
  const t = LABELS[data.language]
  const c = data.content
  return h(
    Document,
    { title: `BRD - ${data.projectTitle}` },
    h(
      DocPage,
      { watermark: data.watermark },
      h(H1, null, data.projectTitle),
      h(Body, null, `${t.doc} - ${t.version} ${data.version} - ${t.date} ${data.generatedAt}`),

      h(H2, null, t.summary),
      h(Body, null, c.executiveSummary),

      h(H2, null, t.objectives),
      h(OrderedList, { items: c.businessObjectives }),

      h(H2, null, t.metrics),
      h(OrderedList, { items: c.successMetrics }),

      h(H2, null, t.scope),
      h(Body, null, c.scope),

      h(H2, null, t.outScope),
      h(OrderedList, { items: c.outOfScope }),

      titled(t.stakeholders, c.stakeholders),
      titled(t.targetUsers, c.targetUsers),
      listed(t.benefits, c.expectedBenefits),

      h(H2, null, t.func),
      c.functionalRequirements.map((f, i) => [
        h(H3, { key: `h-${f.title}` }, `${i + 1}. ${f.title}`),
        h(Body, { key: `b-${f.title}` }, f.content),
      ]),

      h(H2, null, t.nonFunc),
      h(OrderedList, { items: c.nonFunctionalRequirements }),

      listed(t.rules, c.businessRules),

      h(H2, null, t.estimation),
      h(TableCaption, { index: 1 }, t.estimation),
      h(DataTable, {
        head: [t.item, t.value],
        rows: [
          [t.price, `${rupiah(c.estimatedPriceMin)} - ${rupiah(c.estimatedPriceMax)}`],
          [t.timeline, `${c.estimatedTimelineDays} ${t.days}`],
          [t.team, `${c.estimatedTeamSize} ${t.people}`],
        ],
      }),

      titled(t.phases, c.timelinePhases),

      h(H2, null, t.risk),
      h(OrderedList, { items: c.riskAssessment }),
    ),
  )
}
