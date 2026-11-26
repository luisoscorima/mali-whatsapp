import { useState, type DragEvent } from 'react'
import { flushSync } from 'react-dom'
import { Button } from '@/shared/ui/shadcn/button'
import { WaMainBody, WaMainFooter, WaMainHeader } from '@/shared/ui/shell/WaMainPane'
import { IconAttach, IconMicrophone, IconPostIt, IconSchedule, IconSend } from './InboxComposeBar'

type InboxGuideExampleProps = {
  onStart: (trigger: HTMLButtonElement, onEnd: (restoreFocus: boolean) => void) => void
  onShowSummary: () => void
}

const exampleNote = {
  title: 'Envío de catálogo',
  body: '¡Claro! Te comparto el catálogo para que puedas revisar los productos.',
}

function ignoreFileDrop(event: DragEvent<HTMLElement>) {
  if (!Array.from(event.dataTransfer.types).includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'none'
}

export function InboxGuideExample({ onStart, onShowSummary }: InboxGuideExampleProps) {
  const [expanded, setExpanded] = useState(false)

  function startExample(trigger: HTMLButtonElement) {
    // Driver.js measures the controls after the chat expands.
    flushSync(() => setExpanded(true))
    onStart(trigger, (restoreFocus) => {
      setExpanded(false)
      if (restoreFocus) requestAnimationFrame(() => trigger.focus())
    })
  }

  return (
    <section
      className={expanded ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-4 sm:p-6'}
      aria-label="Guía del chat"
      data-inbox-guide-example
    >
      <h2 className={expanded ? 'hidden' : 'mt-auto shrink-0 text-center text-base font-semibold text-ink'}>
        Descubre las novedades del chat
      </h2>

      <div className={expanded ? 'flex min-h-0 flex-1 flex-col' : 'inbox-guide-example__preview flex w-full max-w-lg shrink-0 flex-col overflow-hidden rounded-xl border border-line'}>
        <WaMainHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span className="inbox-chat-avatar inbox-chat-avatar--header" aria-hidden="true">LG</span>
            <div className="min-w-0">
              <h2 className="inbox-chat-heading">Luis Gustavo</h2>
              <p className="inbox-chat-sub">Chat de ejemplo · Sin envíos reales</p>
            </div>
          </div>
        </WaMainHeader>

        <div
          className="inbox-chat-drop-zone inbox-guide-example__drop-zone"
          data-inbox-guide="chat-attach"
          onDragOver={ignoreFileDrop}
          onDrop={ignoreFileDrop}
        >
          <WaMainBody>
            <div className="mt-auto flex shrink-0 flex-col gap-2">
              <p className="chat-bubble chat-bubble--in text-sm">Hola, ¿me puedes enviar el catálogo?</p>
              <p className="chat-bubble chat-bubble--out flex items-center gap-2 text-sm">
                <IconMicrophone />
                <span>Nota de voz</span>
                <span className="text-xs tabular-nums">0:08</span>
              </p>
            </div>
          </WaMainBody>

          <div className="inbox-guide-example__scheduled-send" data-inbox-guide="chat-schedule">
            <p className="chat-timeline-event chat-timeline-event--pill inbox-guide-example__schedule-notice">
              <span className="chat-timeline-event__pill">
                <span className="shrink-0"><IconSchedule /></span>
                <span>Mensaje programado para hoy, 4:00 p. m.</span>
                <span className="font-medium text-accent-ink">Ver</span>
              </span>
            </p>
            <WaMainFooter>
              <div className="inbox-guide-example__composer relative flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface-strong px-2 py-1 text-sm text-muted">
                  <span className="shrink-0"><IconAttach /></span>
                  <span className="min-w-0 flex-1 truncate px-0.5 py-1">
                    <span className="inbox-guide-example__when-idle">/ respuestas rápidas</span>
                    <span className="inbox-guide-example__when-scheduling text-ink">Te envío el catálogo.</span>
                    <span className="inbox-guide-example__when-searching text-ink">/cat</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-accent-soft px-1.5 py-1 text-xs font-medium text-accent-ink">
                    <IconPostIt />
                    Notas
                  </span>
                </div>
                <span
                  className="inbox-guide-example__schedule absolute end-12 grid size-9 place-items-center rounded-full text-muted"
                  aria-hidden="true"
                >
                  <IconSchedule />
                </span>
                <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-accent text-white [[data-theme=dark]_&]:text-wa-chat-bg" data-inbox-guide="chat-voice">
                  <span className="inbox-guide-example__when-idle" aria-label="Micrófono" role="img"><IconMicrophone /></span>
                  <span className="inbox-guide-example__send" aria-label="Enviar mensaje" role="img"><IconSend /></span>
                </span>

                <div
                  className="inbox-guide-example__panel pointer-events-none absolute end-0 bottom-0 w-80 max-w-full pb-[50px] sm:end-12"
                  data-inbox-guide="chat-notes"
                >
                  <div className="space-y-2 rounded-xl border border-line bg-surface-strong p-3 text-ink">
                    <div>
                      <h3 className="text-sm font-medium">Mis notas</h3>
                      <p className="text-xs text-muted">Privadas para ti. Clic para pegar en el mensaje.</p>
                    </div>
                    <div className="rounded-lg border border-line bg-surface px-2 py-1.5">
                      <p className="text-sm font-medium">{exampleNote.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{exampleNote.body}</p>
                    </div>
                  </div>
                </div>

                <div
                  className="inbox-guide-example__panel inbox-guide-example__quick-replies pointer-events-none absolute start-0 bottom-0 w-96 max-w-full pb-[50px]"
                  data-inbox-guide="chat-compose"
                >
                  <div role="region" aria-label="Respuestas rápidas" className="rounded-xl border border-line bg-surface-strong p-2">
                    <div className="rounded-md bg-accent-soft px-2 py-1.5 text-accent-ink">
                      <p className="text-sm font-medium">{exampleNote.title}</p>
                      <p className="text-xs">{exampleNote.body}</p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-2 w-fit text-xs text-muted" data-inbox-guide="chat-shortcuts">
                <kbd className="font-sans font-medium text-ink">Enter</kbd> para enviar · <kbd className="font-sans font-medium text-ink">Shift + Enter</kbd> para nueva línea
              </p>
            </WaMainFooter>
          </div>

          <div className="inbox-guide-example__drop inbox-chat-drop-zone__overlay" aria-hidden="true">
            <span>Zona para soltar archivos</span>
          </div>
        </div>
      </div>

      <div className={expanded ? 'hidden' : 'mb-auto flex shrink-0 flex-col items-center gap-5 text-center'}>
        <Button
          variant="outline"
          className="border-accent bg-accent-soft font-semibold text-accent-ink hover:border-accent-hover"
          onClick={(event) => startExample(event.currentTarget)}
        >
          Iniciar recorrido
        </Button>
        <div className="flex flex-col items-center gap-2">
          <p>Selecciona una conversación para ver sus mensajes.</p>
          <Button variant="secondary" onClick={onShowSummary}>Ver resumen de conversaciones</Button>
        </div>
      </div>
    </section>
  )
}
