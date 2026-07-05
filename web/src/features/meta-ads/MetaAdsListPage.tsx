import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { WaSpanMainPage } from '@/shared/ui/shell/WaSpanMainPage'

type MetaAdListItem = {
  id: number
  meta_source_id: string
  display_name: string | null
  display_label: string
  platform_label: string
  headline: string | null
  lead_count: number
  last_seen_at: string | null
}

export function MetaAdsListPage() {
  const [ads, setAds] = useState<MetaAdListItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.get<MetaAdListItem[]>('/api/meta-ads').then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAds(result.data)
    })
  }, [])

  if (error) {
    return (
      <WaSpanMainPage title="Anuncios Meta">
        <p className="text-bad">{error}</p>
      </WaSpanMainPage>
    )
  }

  if (!ads) {
    return (
      <WaSpanMainPage title="Anuncios Meta">
        <p className="text-muted">Cargando anuncios…</p>
      </WaSpanMainPage>
    )
  }

  return (
    <WaSpanMainPage>
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Anuncios Meta</h1>
        <p className="text-sm text-muted">
          Leads que llegaron por Click-to-WhatsApp desde anuncios de Facebook o Instagram.
        </p>
      </div>

      {ads.length === 0 ? (
        <p className="text-sm text-muted">
          Aún no hay anuncios registrados. Cuando un usuario escriba desde una pauta CTWA,
          aparecerá aquí con su ID de Meta.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface-strong">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Anuncio</th>
                <th className="px-4 py-2 font-medium">Plataforma</th>
                <th className="px-4 py-2 font-medium">Headline</th>
                <th className="px-4 py-2 font-medium">Leads</th>
                <th className="px-4 py-2 font-medium">Último contacto</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {ads.map((ad) => (
                <tr key={ad.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <strong>{ad.display_label}</strong>
                    {ad.display_name ? (
                      <p className="font-mono text-xs text-muted">{ad.meta_source_id}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{ad.platform_label}</td>
                  <td className="px-4 py-3">{(ad.headline || '—').slice(0, 80)}</td>
                  <td className="px-4 py-3">{ad.lead_count}</td>
                  <td className="px-4 py-3">{formatDateTime(ad.last_seen_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/anuncios/${ad.id}`}
                      className="text-accent hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </WaSpanMainPage>
  )
}
