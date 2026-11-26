import { useId, type DragEvent } from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import { IconAttach, IconMicrophone, IconPostIt, IconSchedule } from './InboxComposeBar'

type InboxGuideExampleProps = {
  onStart: (trigger: HTMLButtonElement) => void
  onShowSummary: () => void
}

function ignoreFileDrop(event: DragEvent<HTMLElement>) {
  if (!Array.from(event.dataTransfer.types).includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'none'
}

export function InboxGuideExample({ onStart, onShowSummary }: InboxGuideExampleProps) {
  const headingId = useId()

  return (
    <div className="inbox-guide-empty min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <section
        className="inbox-guide-example mx-auto w-full max-w-xl"
        aria-labelledby={headingId}
        data-inbox-guide-example
      >
        <h2 id={headingId} className="text-xl font-semibold text-ink">Conoce las novedades del chat</h2>
        <p className="mt-1 text-sm text-muted">Selecciona una conversación para ver sus mensajes o inicia el recorrido en el chat de ejemplo.</p>

        <div
          className="mt-4 overflow-hidden rounded-xl border border-line bg-surface"
          onDragOver={ignoreFileDrop}
          onDrop={ignoreFileDrop}
        >
          <div className="flex items-center gap-3 border-b border-line bg-surface-strong px-3 py-2.5 sm:px-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-hidden="true">VM</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Valeria Montes</p>
              <p className="text-xs text-muted">Chat de ejemplo · Sin envíos reales</p>
            </div>
          </div>

          <div className="inbox-guide-example__drop-zone relative" data-inbox-guide="chat-attach">
            <div className="inbox-guide-example__history flex flex-col gap-3 p-3 sm:px-4">
              <p className="chat-bubble--in max-w-[86%] px-3 py-2 text-sm">Hola, ¿me puedes enviar el catálogo?</p>
              <p className="chat-bubble--out flex max-w-[86%] items-center gap-2 px-3 py-2 text-sm">
                <IconMicrophone />
                <span>Nota de voz</span>
                <span className="text-xs tabular-nums">0:08</span>
              </p>
              <p className="mx-auto flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted" data-inbox-guide="chat-schedule">
                <span className="shrink-0"><IconSchedule /></span>
                <span>Mensaje programado para hoy, 4:00 p. m.</span>
                <span className="font-medium text-accent-ink">Ver</span>
              </p>
            </div>

            <div className="border-t border-line px-3 py-2 sm:px-4">
              <div className="flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-strong px-2 py-1 text-sm text-muted">
                  <span className="shrink-0"><IconAttach /></span>
                  <span className="min-w-0 flex-1 truncate px-0.5 py-1" data-inbox-guide="chat-compose">/ respuestas rápidas</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-accent-soft px-1.5 py-1 text-xs font-medium text-accent-ink" data-inbox-guide="chat-notes">
                    <IconPostIt />
                    Notas
                  </span>
                </div>
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-accent bg-accent-soft text-accent-ink" data-inbox-guide="chat-voice" aria-label="Micrófono" role="img">
                  <IconMicrophone />
                </span>
              </div>
              <p className="mt-2 w-fit text-xs text-muted" data-inbox-guide="chat-shortcuts">
                <kbd className="font-sans font-medium text-ink">Enter</kbd> para enviar · <kbd className="font-sans font-medium text-ink">Shift + Enter</kbd> para nueva línea
              </p>
            </div>

            <div className="inbox-guide-example__drop inbox-chat-drop-zone__overlay" aria-hidden="true">
              <span>Zona para soltar archivos</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="border-accent bg-accent-soft font-semibold text-accent-ink hover:border-accent-hover"
            onClick={(event) => onStart(event.currentTarget)}
          >
            Iniciar recorrido
          </Button>
          <Button variant="secondary" className="inbox-guide-example__summary" onClick={onShowSummary}>Ver resumen de conversaciones</Button>
        </div>
      </section>
    </div>
  )
}
