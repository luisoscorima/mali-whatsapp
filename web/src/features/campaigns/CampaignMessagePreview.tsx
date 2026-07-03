import { summarizePreviewUrl } from '../templates/templatePreviewUtils'

export type CampaignMessagePreviewData = {
  headerText: string
  headerMediaType: string | null
  headerMediaUrl: string | null
  bodyText: string
  footerText: string
  buttons: { type: string; text: string; url: string }[]
}

function PreviewLine({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <>
      {parts.map((part, idx) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <span
            key={idx}
            className="rounded bg-accent-soft px-1 font-mono text-xs text-accent"
          >
            {part}
          </span>
        ) : (
          <span key={idx}>{part}</span>
        ),
      )}
    </>
  )
}

export function CampaignMessagePreview({
  preview,
}: {
  preview: CampaignMessagePreviewData
}) {
  return (
    <div className="space-y-3">
      <div className="mx-auto max-w-[280px] rounded-[2rem] border-4 border-line bg-bg p-3 shadow-sm">
        <div className="rounded-2xl bg-surface p-3">
          <div className="space-y-2 rounded-xl bg-surface-strong p-3 text-sm shadow-inner">
            {preview.headerMediaUrl && preview.headerMediaType === 'image' ? (
              <img
                src={preview.headerMediaUrl}
                alt="Cabecera"
                className="max-h-36 w-full rounded-lg object-cover"
                loading="lazy"
              />
            ) : null}

            {preview.headerMediaType === 'video' ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-xs text-muted">
                <span className="rounded bg-line px-1.5 py-0.5 font-mono">
                  VIDEO
                </span>
                Video de cabecera
              </div>
            ) : null}

            {preview.headerMediaType === 'document' ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-xs text-muted">
                <span className="rounded bg-line px-1.5 py-0.5 font-mono">
                  DOCUMENT
                </span>
                Documento de cabecera
              </div>
            ) : null}

            {preview.headerText ? (
              <p className="font-medium whitespace-pre-wrap">
                <PreviewLine text={preview.headerText} />
              </p>
            ) : null}

            {preview.bodyText ? (
              <p className="whitespace-pre-wrap">
                <PreviewLine text={preview.bodyText} />
              </p>
            ) : (
              <p className="text-muted">Sin texto de cuerpo.</p>
            )}

            {preview.footerText ? (
              <p className="text-xs text-muted">{preview.footerText}</p>
            ) : null}

            {preview.buttons.length > 0 ? (
              <div className="space-y-1 border-t border-line pt-2">
                {preview.buttons.map((button, idx) => (
                  <div
                    key={idx}
                    className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-center text-sm text-accent"
                  >
                    <p>{button.text || 'Botón'}</p>
                    {button.url ? (
                      <p
                        className="truncate text-xs text-muted"
                        title={button.url}
                      >
                        {summarizePreviewUrl(button.url, [], 'examples')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {preview.headerMediaType ? (
        <p className="text-center text-xs text-muted">
          Cabecera:{' '}
          <span className="font-medium uppercase">{preview.headerMediaType}</span>
        </p>
      ) : preview.headerText ? (
        <p className="text-center text-xs text-muted">
          Cabecera: <span className="font-medium">TEXT</span>
        </p>
      ) : null}

      <p className="text-xs text-muted">
        Valores fijos reales; los dinámicos se muestran entre corchetes.
      </p>
    </div>
  )
}
