import type { PrdContent } from '@kerjacus/shared'
import { Document } from '@react-pdf/renderer'
import { Fragment, createElement as h } from 'react'
import { Body, DataTable, DocPage, H1, H2, H3, OrderedList, TableCaption } from './pdf-typography'

export type PrdLanguage = 'id' | 'en'

export type PrdPdfData = {
  projectTitle: string
  content: PrdContent
  language: PrdLanguage
  generatedAt: string
  version: number
  watermark?: string
}

const LABELS: Record<PrdLanguage, Record<string, string>> = {
  id: {
    doc: 'Dokumen Kebutuhan Produk',
    version: 'Versi',
    date: 'Tanggal',
    tech: 'Tech Stack',
    architecture: 'Arsitektur Sistem',
    api: 'Desain API',
    db: 'Skema Database',
    team: 'Komposisi Tim',
    packages: 'Work Package',
    wpDetail: 'Rincian Work Package',
    deliverables: 'Deliverables',
    acceptance: 'Kriteria Penerimaan',
    sprints: 'Rencana Sprint',
    deps: 'Ketergantungan',
    assumptions: 'Asumsi',
    risks: 'Risiko',
    estimation: 'Estimasi',
    name: 'Nama',
    category: 'Kategori',
    method: 'Method',
    path: 'Path',
    description: 'Deskripsi',
    table: 'Tabel',
    columns: 'Kolom',
    role: 'Peran',
    skills: 'Keahlian',
    hours: 'Jam',
    amount: 'Nominal',
    item: 'Komponen',
    value: 'Nilai',
    totalCost: 'Total Biaya',
    teamSize: 'Ukuran Tim',
    totalHours: 'Total Jam',
    people: 'orang',
    duration: 'Durasi',
  },
  en: {
    doc: 'Product Requirements Document',
    version: 'Version',
    date: 'Date',
    tech: 'Tech Stack',
    architecture: 'System Architecture',
    api: 'API Design',
    db: 'Database Schema',
    team: 'Team Composition',
    packages: 'Work Packages',
    wpDetail: 'Work Package Details',
    deliverables: 'Deliverables',
    acceptance: 'Acceptance Criteria',
    sprints: 'Sprint Plan',
    deps: 'Dependencies',
    assumptions: 'Assumptions',
    risks: 'Risks',
    estimation: 'Estimation',
    name: 'Name',
    category: 'Category',
    method: 'Method',
    path: 'Path',
    description: 'Description',
    table: 'Table',
    columns: 'Columns',
    role: 'Role',
    skills: 'Skills',
    hours: 'Hours',
    amount: 'Amount',
    item: 'Item',
    value: 'Value',
    totalCost: 'Total Cost',
    teamSize: 'Team Size',
    totalHours: 'Total Hours',
    people: 'people',
    duration: 'Duration',
  },
}

function rupiah(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

export function PrdDocument({ data }: { data: PrdPdfData }) {
  const t = LABELS[data.language]
  const c = data.content
  let tableIndex = 0
  const nextTable = () => ++tableIndex

  const apiHasEndpoints = c.apiDesign.some((e) => e.path)
  const dbHasTables = c.databaseSchema.some((d) => d.columns > 0)
  const detailWps = c.workPackages.filter(
    (w) => w.deliverables.length > 0 || w.acceptanceCriteria.length > 0,
  )

  return h(
    Document,
    { title: `PRD - ${data.projectTitle}` },
    h(
      DocPage,
      { watermark: data.watermark },
      h(H1, null, data.projectTitle),
      h(Body, null, `${t.doc} - ${t.version} ${data.version} - ${t.date} ${data.generatedAt}`),

      h(H2, null, t.tech),
      c.techStack.length > 0
        ? h(
            Fragment,
            null,
            h(TableCaption, { index: nextTable() }, t.tech),
            h(DataTable, {
              head: [t.name, t.category, t.description],
              rows: c.techStack.map((x) => [x.name, x.category, x.description]),
            }),
          )
        : null,

      h(H2, null, t.architecture),
      h(Body, null, c.architecture),

      h(H2, null, t.api),
      apiHasEndpoints
        ? h(
            Fragment,
            null,
            h(TableCaption, { index: nextTable() }, t.api),
            h(DataTable, {
              head: [t.method, t.path, t.description],
              rows: c.apiDesign.map((e) => [e.method, e.path, e.description]),
            }),
          )
        : h(
            Fragment,
            null,
            c.apiDesign.map((e, i) => h(Body, { key: `api-${i}` }, e.description)),
          ),

      h(H2, null, t.db),
      dbHasTables
        ? h(
            Fragment,
            null,
            h(TableCaption, { index: nextTable() }, t.db),
            h(DataTable, {
              head: [t.table, t.columns, t.description],
              rows: c.databaseSchema.map((d) => [d.name, String(d.columns), d.description]),
            }),
          )
        : h(
            Fragment,
            null,
            c.databaseSchema.map((d, i) => h(Body, { key: `db-${i}` }, d.description)),
          ),

      h(H2, null, t.packages),
      h(TableCaption, { index: nextTable() }, t.packages),
      h(DataTable, {
        head: [t.name, t.skills, t.hours, t.amount],
        rows: c.workPackages.map((w) => [
          w.name,
          w.requiredSkills.join(', '),
          String(w.estimatedHours),
          rupiah(w.amount),
        ]),
      }),

      detailWps.length > 0
        ? h(
            Fragment,
            null,
            h(H2, null, t.wpDetail),
            detailWps.map((w, i) => [
              h(H3, { key: `wpd-h-${i}` }, w.name),
              w.deliverables.length > 0
                ? h(Body, { key: `wpd-dl-${i}` }, `${t.deliverables}:`)
                : null,
              w.deliverables.length > 0
                ? h(OrderedList, {
                    key: `wpd-dll-${i}`,
                    items: w.deliverables.map((d) =>
                      d.expected ? `${d.title} - ${d.expected}` : d.title,
                    ),
                  })
                : null,
              w.acceptanceCriteria.length > 0
                ? h(Body, { key: `wpd-ac-${i}` }, `${t.acceptance}:`)
                : null,
              w.acceptanceCriteria.length > 0
                ? h(OrderedList, { key: `wpd-acl-${i}`, alpha: true, items: w.acceptanceCriteria })
                : null,
            ]),
          )
        : null,

      h(H2, null, t.sprints),
      c.sprintPlan.map((sp, i) => [
        h(H3, { key: `sh-${i}` }, sp.duration ? `${sp.name} (${sp.duration})` : sp.name),
        h(OrderedList, { key: `sl-${i}`, items: sp.milestones }),
      ]),

      c.dependencyGraph.length > 0
        ? h(
            Fragment,
            null,
            h(H2, null, t.deps),
            h(OrderedList, {
              items: c.dependencyGraph.map((d) => `${d.from} -> ${d.to} (${d.type})`),
            }),
          )
        : null,

      c.assumptions.length > 0
        ? h(Fragment, null, h(H2, null, t.assumptions), h(OrderedList, { items: c.assumptions }))
        : null,

      c.risks.length > 0
        ? h(Fragment, null, h(H2, null, t.risks), h(OrderedList, { items: c.risks }))
        : null,

      h(H2, null, t.estimation),
      h(TableCaption, { index: nextTable() }, t.estimation),
      h(DataTable, {
        head: [t.item, t.value],
        rows: [
          [t.totalCost, rupiah(c.totalCost)],
          [t.teamSize, `${c.teamSize} ${t.people}`],
          [t.totalHours, `${c.totalEstimatedHours} ${t.hours}`],
        ],
      }),
    ),
  )
}
