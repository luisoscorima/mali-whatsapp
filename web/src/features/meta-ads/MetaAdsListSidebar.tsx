import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { notify } from '@/shared/notify'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

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

type MetaAdsListSidebarProps = {
  selectedId?: number | null
}

export function MetaAdsListSidebar({ selectedId }: MetaAdsListSidebarProps) {
  const [ads, setAds] = useState<MetaAdListItem[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    void apiClient.get<MetaAdListItem[]>('/api/meta-ads').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        setAds([])
        return
      }
      setAds(result.data)
      setLoadFailed(false)
    })
  }, [])

  return (
    <WaSidebar
      title="Anuncios"
      filters={
        <p className="px-3 pb-2 text-xs text-muted">
          Leads desde Click-to-WhatsApp en Facebook o Instagram.
        </p>
      }
    >
      {!ads ? (
        <p className="inbox-empty-list">Cargando anuncios…</p>
      ) : loadFailed ? (
        <p className="inbox-empty-list">No se pudo cargar</p>
      ) : ads.length === 0 ? (
        <p className="inbox-empty-list">
          Aún no hay anuncios. Cuando alguien escriba desde una pauta CTWA, aparecerá aquí.
        </p>
      ) : (
        <ul className="inbox-chat-list">
          {ads.map((ad) => {
            const active = selectedId === ad.id
            const preview = [
              ad.platform_label,
              `${ad.lead_count} lead${ad.lead_count === 1 ? '' : 's'}`,
              ad.last_seen_at ? formatDateTime(ad.last_seen_at).split(',')[0] : null,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <li key={ad.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                <Link to={`/anuncios/${ad.id}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title">{ad.display_label}</span>
                    </span>
                    {ad.headline ? (
                      <span className="inbox-chat-preview line-clamp-1">{ad.headline}</span>
                    ) : null}
                    <span className="inbox-chat-preview">{preview}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WaSidebar>
  )
}
