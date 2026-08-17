import { fileURLToPath } from 'node:url'
import { Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { createElement as h, type ReactNode } from 'react'

// createElement, not JSX, keeps the tsconfig include .ts only.

const fontPath = (name: string): string =>
  fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url))

Font.register({
  family: 'Plus Jakarta Sans',
  fonts: [
    { src: fontPath('PlusJakartaSans-Regular.ttf'), fontWeight: 400 },
    { src: fontPath('PlusJakartaSans-Bold.ttf'), fontWeight: 700 },
  ],
})

// Justify without hyphen breaks.
Font.registerHyphenationCallback((word) => [word])

const BODY = 11
const SMALL = 10
const LINE = 1.5
const INK = '#131c27'
const MUTED = '#5e677d'
const RULE = '#d1d5db'

const s = StyleSheet.create({
  page: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: BODY,
    lineHeight: LINE,
    color: INK,
    paddingTop: 64,
    paddingBottom: 56,
    paddingHorizontal: 64,
  },
  h1: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 5 },
  h3: { fontSize: 11, fontWeight: 700, marginTop: 10, marginBottom: 4 },
  body: { fontSize: BODY, textAlign: 'justify', textIndent: 14, marginBottom: 4 },
  listItem: { fontSize: BODY, textAlign: 'justify', marginBottom: 2, paddingLeft: 16 },
  tableCaption: { fontSize: SMALL, textAlign: 'left', marginTop: 8, marginBottom: 3 },
  bold: { fontWeight: 700 },
  table: { borderTopWidth: 1, borderColor: RULE, marginBottom: 6 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: RULE },
  th: { fontSize: SMALL, fontWeight: 700, padding: 4, flexGrow: 1, flexBasis: 0 },
  td: { fontSize: SMALL, padding: 4, flexGrow: 1, flexBasis: 0 },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: SMALL,
    color: MUTED,
  },
  watermark: {
    position: 'absolute',
    top: '42%',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 56,
    fontWeight: 700,
    color: '#152e34',
    opacity: 0.08,
    transform: 'rotate(-30deg)',
  },
})

export function H1({ children }: { children?: ReactNode }) {
  return h(Text, { style: s.h1 }, children)
}

export function H2({ children }: { children?: ReactNode }) {
  return h(Text, { style: s.h2 }, children)
}

export function H3({ children }: { children?: ReactNode }) {
  return h(Text, { style: s.h3 }, children)
}

export function Body({ children }: { children?: ReactNode }) {
  return h(Text, { style: s.body }, children)
}

// Numbered or lettered list.
export function OrderedList({ items, alpha = false }: { items: string[]; alpha?: boolean }) {
  const marker = (i: number) => (alpha ? `${String.fromCharCode(97 + i)}.` : `${i + 1}.`)
  return h(
    View,
    null,
    items.map((item, i) =>
      h(Text, { key: `${i}-${item.slice(0, 24)}`, style: s.listItem }, `${marker(i)} ${item}`),
    ),
  )
}

// Caption above the table, left aligned.
export function TableCaption({ index, children }: { index: number; children?: ReactNode }) {
  return h(
    Text,
    { style: s.tableCaption },
    h(Text, { style: s.bold }, `Tabel ${index}. `),
    children,
  )
}

export function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return h(
    View,
    { style: s.table },
    h(
      View,
      { style: s.tr },
      head.map((cell) => h(Text, { key: cell, style: s.th }, cell)),
    ),
    rows.map((row) =>
      h(
        View,
        { key: row.join('|').slice(0, 40), style: s.tr },
        row.map((cell, i) =>
          h(Text, { key: `${head[i] ?? i}-${cell.slice(0, 20)}`, style: s.td }, cell),
        ),
      ),
    ),
  )
}

function Footer() {
  return h(Text, {
    style: s.footer,
    fixed: true,
    render: ({ pageNumber }: { pageNumber: number }) => `${pageNumber}`,
  })
}

function Watermark({ text }: { text: string }) {
  return h(Text, { style: s.watermark, fixed: true }, text)
}

// Page with the fixed footer and optional preview watermark.
export function DocPage({ children, watermark }: { children?: ReactNode; watermark?: string }) {
  return h(
    Page,
    { size: 'A4', style: s.page },
    watermark ? h(Watermark, { text: watermark }) : null,
    children,
    h(Footer, null),
  )
}
