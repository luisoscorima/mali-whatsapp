import { Link } from 'react-router-dom'
import { summarizePreviewUrl } from '../templates/templatePreviewUtils'
import type { CampaignMessagePreviewData } from '../campaigns/CampaignMessagePreview'

type ChatCampaignPreviewProps = {
  preview: CampaignMessagePreviewData
  campaignId?: number | null
}

export function ChatCampaignPreview({ preview, campaignId }: ChatCampaignPreviewProps) {
  return (
    <div className="chat-campaign-preview">
      {preview.headerMediaUrl && preview.headerMediaType === 'image' ? (
        <div className="chat-campaign-preview__media">
          <img src={preview.headerMediaUrl} alt="" loading="lazy" decoding="async" />
        </div>
      ) : preview.headerMediaType === 'video' ? (
        <div className="chat-campaign-preview__media chat-campaign-preview__media--placeholder">
          <span aria-hidden="true">🎬</span> Video de cabecera
        </div>
      ) : preview.headerMediaType === 'document' ? (
        <div className="chat-campaign-preview__media chat-campaign-preview__media--placeholder">
          <span aria-hidden="true">📎</span> Documento de cabecera
        </div>
      ) : null}

      {preview.headerText ? (
        <div className="chat-campaign-preview__header">{preview.headerText}</div>
      ) : null}

      {preview.bodyText ? (
        <div className="chat-campaign-preview__body">{preview.bodyText}</div>
      ) : null}

      {preview.footerText ? (
        <div className="chat-campaign-preview__footer">{preview.footerText}</div>
      ) : null}

      {preview.buttons.length > 0 ? (
        <div className="chat-campaign-preview__buttons">
          {preview.buttons.map((btn, idx) => (
            <div key={idx} className="chat-campaign-preview__button">
              <span className="chat-campaign-preview__button-text">{btn.text || 'Botón'}</span>
              {btn.url ? (
                <span className="chat-campaign-preview__button-url" title={btn.url}>
                  {summarizePreviewUrl(btn.url, [], 'examples')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {campaignId ? (
        <p className="text-xs text-muted">
          <Link to={`/campaigns/${campaignId}`} className="text-accent hover:underline">
            Campaña #{campaignId}
          </Link>
        </p>
      ) : null}
    </div>
  )
}
