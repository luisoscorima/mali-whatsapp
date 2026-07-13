import { useState } from 'react'
import { renderWhatsAppText } from '@/shared/whatsappFormat'
import type { TemplateBuilderState } from './templateFormUtils'
import {
  applyPreviewMode,
  buildAllMappingItems,
  buildPreviewWarnings,
  parsePreviewParts,
  splitPreviewLines,
  summarizePreviewUrl,
  type PreviewMode,
} from './templatePreviewUtils'

type TemplateLivePreviewProps = {
  state: TemplateBuilderState
  showMeta?: boolean
}

function PreviewText({
  text,
  exampleValues,
  mode,
}: {
  text: string
  exampleValues: string[]
  mode: PreviewMode
}) {
  const rendered = applyPreviewMode(text, exampleValues, mode)
  const lines = splitPreviewLines(rendered)
  return (
    <>
      {lines.map((line, lineIdx) => (
        <span key={lineIdx}>
          {lineIdx > 0 ? <br /> : null}
          {parsePreviewParts(line).map((part, partIdx) =>
            part.type === 'token' ? (
              <span
                key={partIdx}
                className="rounded bg-accent-soft px-1 font-mono text-xs text-accent"
              >
                {part.value}
              </span>
            ) : (
              <span key={partIdx}>{renderWhatsAppText(part.value)}</span>
            ),
          )}
        </span>
      ))}
    </>
  )
}

export function TemplateLivePreview({
  state,
  showMeta = true,
}: TemplateLivePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('aliases')
  const warnings = buildPreviewWarnings(state)
  const mapping = buildAllMappingItems(state)
  const headerType = state.header.type

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Vista previa</h3>
          <p className="text-xs text-muted">Editorial / no exacta a Meta</p>
        </div>
        <div
          className="flex gap-1 rounded-lg border border-line p-0.5"
          role="tablist"
          aria-label="Modo de vista previa"
        >
          {(['aliases', 'examples'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                mode === value
                  ? 'bg-accent text-white'
                  : 'text-muted hover:bg-accent-soft'
              }`}
            >
              {value === 'aliases' ? 'Aliases' : 'Ejemplo'}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[280px] rounded-[2rem] border-4 border-line bg-bg p-3 shadow-sm">
        <div className="rounded-2xl bg-surface p-3">
          <div className="space-y-2 rounded-xl bg-surface-strong p-3 text-sm shadow-inner">
            {headerType === 'text' && state.header.text ? (
              <p className="font-medium">
                <PreviewText
                  text={state.header.text}
                  exampleValues={state.header.exampleValues}
                  mode={mode}
                />
              </p>
            ) : null}

            {headerType === 'image' ? (
              state.header.exampleMediaUrl ? (
                <img
                  src={state.header.exampleMediaUrl}
                  alt="Cabecera"
                  className="max-h-36 w-full rounded-lg object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-xs text-muted">
                  <span className="rounded bg-line px-1.5 py-0.5 font-mono">
                    IMAGE
                  </span>
                  Imagen de cabecera
                </div>
              )
            ) : null}

            {headerType === 'video' || headerType === 'document' ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-6 text-xs text-muted">
                <span className="rounded bg-line px-1.5 py-0.5 font-mono uppercase">
                  {headerType}
                </span>
                {headerType === 'video'
                  ? 'Video de cabecera'
                  : 'Documento de cabecera'}
              </div>
            ) : null}

            {state.body.text ? (
              <p className="whitespace-pre-wrap">
                <PreviewText
                  text={state.body.text}
                  exampleValues={state.body.exampleValues}
                  mode={mode}
                />
              </p>
            ) : (
              <p className="text-muted">
                Empieza a escribir el cuerpo para ver la vista previa.
              </p>
            )}

            {state.footer.text ? (
              <p className="text-xs text-muted">{state.footer.text}</p>
            ) : null}

            {state.buttons.length > 0 ? (
              <div className="space-y-1 border-t border-line pt-2">
                {state.buttons.map((button, idx) => (
                  <div
                    key={idx}
                    className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-center text-sm text-accent"
                  >
                    <p>{button.text || 'Botón URL'}</p>
                    {button.url ? (
                      <p className="truncate text-xs text-muted">
                        {summarizePreviewUrl(
                          button.url,
                          button.exampleValues,
                          mode,
                        )}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showMeta ? (
        <details open className="text-sm">
          <summary className="cursor-pointer text-muted">Detalles</summary>
          <div className="mt-3 space-y-3">
            {mapping.length > 0 ? (
              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Mapeo interno
                </p>
                <ul className="space-y-2 text-xs">
                  {mapping.map((item, idx) => (
                    <li key={idx}>
                      <span className="mr-2 rounded bg-line px-1.5 py-0.5">
                        {item.scope}
                      </span>
                      <code className="font-mono">{`{{${item.token}}}`}</code>
                      {' → '}
                      <code className="font-mono">{`{{${item.position}}}`}</code>
                      {item.example ? ` · ej. ${item.example}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <div className="rounded-lg border border-bad/30 bg-bad/5 p-3">
                <p className="mb-2 text-xs font-medium text-bad">Avisos</p>
                <ul className="list-disc space-y-1 pl-4 text-xs text-bad">
                  {warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}
