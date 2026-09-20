import { ExternalLink, Loader2, ShieldCheck, Stamp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type ContractItem, useAffixMeterai } from '@/hooks/use-projects'
import { apiUrl } from '@/lib/api'
import { useToastStore } from '@/stores/toast'

// Official Peruri retail portal: an individual can buy and affix a stamp with a
// KTP, so the parties do it themselves and the platform never handles meterai.
const EMETERAI_PORTAL = 'https://e-meterai.co.id'

async function uploadStampedContract(file: File): Promise<string> {
  const presignRes = await fetch(apiUrl('/api/v1/upload/presigned-url'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      folder: 'document',
      fileSize: file.size,
    }),
  })
  if (!presignRes.ok) throw new Error('presign failed')
  const { data } = (await presignRes.json()) as { data: { url: string; contentType: string } }
  await fetch(data.url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': data.contentType },
  })
  return data.url.split('?')[0]
}

/**
 * Prompts the parties to stamp a contract that crosses the Bea Meterai
 * threshold. The platform is not a meterai distributor, so this links them to
 * the official portal to buy and affix it, then takes the stamped copy back for
 * the record. Renders nothing when no contract needs a stamp.
 */
export function MeteraiNotice({
  contracts,
  projectId,
}: {
  contracts: ContractItem[]
  projectId: string
}) {
  const { t } = useTranslation('document')
  const required = contracts.filter((c) => c.meteraiRequired)
  if (required.length === 0) return null

  return (
    <section className="rounded-lg border border-warning-600/40 bg-warning-500/10 p-4">
      <div className="flex items-center gap-2 text-on-surface">
        <Stamp className="size-5 text-warning-600" aria-hidden />
        <h3 className="font-semibold">{t('meterai_title')}</h3>
      </div>
      <p className="mt-1 text-sm text-on-surface-muted">{t('meterai_desc')}</p>
      <a
        href={EMETERAI_PORTAL}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-text hover:underline"
      >
        {t('meterai_buy')}
        <ExternalLink className="size-4" aria-hidden />
      </a>
      <ul className="mt-3 space-y-2">
        {required.map((contract) => (
          <MeteraiRow key={contract.id} contract={contract} projectId={projectId} />
        ))}
      </ul>
    </section>
  )
}

function MeteraiRow({ contract, projectId }: { contract: ContractItem; projectId: string }) {
  const { t } = useTranslation('document')
  const affix = useAffixMeterai()
  const addToast = useToastStore((s) => s.addToast)
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const label =
    contract.type === 'standard_nda' ? t('meterai_contract_nda') : t('meterai_contract_ip')

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const documentUrl = await uploadStampedContract(file)
      await affix.mutateAsync({ contractId: contract.id, projectId, documentUrl })
      addToast('success', t('meterai_uploaded'))
    } catch {
      addToast('error', t('meterai_upload_failed'))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2 text-sm">
      <span className="text-on-surface">{label}</span>
      {contract.meteraiAffixedAt ? (
        <a
          href={contract.meteraiDocumentUrl ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-success-600 hover:underline"
        >
          <ShieldCheck className="size-4" aria-hidden />
          {t('meterai_affixed')}
        </a>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 font-medium text-primary-100 hover:bg-brand-hover disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {t('meterai_upload')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={onFile}
          />
        </>
      )}
    </li>
  )
}
