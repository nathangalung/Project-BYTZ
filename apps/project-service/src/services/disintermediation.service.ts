const PATTERNS = {
  indonesianPhone: /(?:\+62|62|0)\s?8\d{8,12}/g,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  whatsappLink: /wa\.me\/\d+/gi,
  telegramLink: /t\.me\/[\w_]+/gi,
  instagram: /instagram\.com\/[\w._]+/gi,
  externalSocial: /(?:linkedin\.com\/in\/|github\.com\/)[\w-]+/gi,
}

export type BypassMatch = {
  pattern: keyof typeof PATTERNS
  match: string
}

export function detectBypassAttempts(content: string): BypassMatch[] {
  const matches: BypassMatch[] = []
  for (const [name, regex] of Object.entries(PATTERNS)) {
    const found = content.match(regex)
    if (found) {
      for (const m of found) {
        matches.push({ pattern: name as keyof typeof PATTERNS, match: m })
      }
    }
  }
  return matches
}

export function hasBypassAttempt(content: string): boolean {
  return detectBypassAttempts(content).length > 0
}
