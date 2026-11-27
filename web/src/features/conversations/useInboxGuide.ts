import { useEffect, useRef } from 'react'
import type { DriveStep, Driver } from 'driver.js'
import { notify } from '@/shared/notify'

type GuideSection = 'inbox' | 'chat' | 'example'

type GuideStep = {
  target: string
  fallback?: string
  title: string
  description: string
  side?: NonNullable<DriveStep['popover']>['side']
}

const chatFeatures: GuideStep[] = [
  {
    target: 'chat-voice',
    fallback: 'chat-compose',
    title: 'Graba una nota de voz',
    description: 'Con el borrador vacío, pulsa el micrófono. Puedes detener la grabación para escucharla antes de enviarla o descartarla.',
    side: 'top',
  },
  {
    target: 'chat-schedule',
    fallback: 'chat-compose',
    title: 'Programa un envío',
    description: 'Escribe un mensaje o adjunta un archivo para que aparezca el reloj junto al botón de enviar. Pulsa el reloj para elegir la fecha y hora dentro de la ventana de atención. Usa el aviso del historial para ver o cancelar un envío pendiente.',
    side: 'top',
  },
  {
    target: 'chat-attach',
    title: 'Adjunta un archivo por arrastre',
    description: 'Suelta un archivo sobre el historial o el compositor. También puedes usar el clip. El adjunto queda en el borrador hasta que lo envíes.',
    side: 'top',
  },
  {
    target: 'chat-notes',
    title: 'Guarda tus respuestas en Notas',
    description: 'Crea y edita los textos que usas con frecuencia. Tus notas son privadas. Abre Notas en el compositor para insertar una en tu borrador.',
    side: 'top',
  },
  {
    target: 'chat-compose',
    title: 'Usa / para buscar respuestas rápidas',
    description: 'Escribe / seguido de una palabra para buscar en tus notas. Usa las flechas y pulsa Enter para insertar la nota en el borrador. Esc cierra la lista.',
    side: 'top',
  },
  {
    target: 'chat-shortcuts',
    fallback: 'chat-compose',
    title: 'Escribe con atajos de teclado',
    description: 'Al redactar un mensaje con la lista de respuestas rápidas cerrada, Enter envía el borrador y Shift + Enter agrega una línea.',
    side: 'top',
  },
]

const guideSteps: Record<GuideSection, GuideStep[]> = {
  inbox: [
    {
      target: 'inbox-views',
      title: 'Organiza tu bandeja',
      description: 'Mis chats son las que te asignaron y Sin asignar las que aún no tienen asesor. Sin leer y Sin responder enfocan esa lista. Archivo cambia de lugar.',
    },
    {
      target: 'inbox-search',
      title: 'Encuentra una conversación',
      description: 'Busca por nombre o teléfono. Al escribir puedes incluir el texto de los mensajes y buscar en todo el historial.',
    },
    {
      target: 'inbox-filters',
      title: 'Afina la lista',
      description: 'Línea, segmentos, fechas y ventana se suman a la vista de arriba. Guarda esa combinación en la fila de vistas.',
    },
    {
      target: 'inbox-conversations',
      title: 'Continúa dentro del chat',
      description: 'Abre una conversación y elige Guía del chat para recorrer las herramientas de respuesta.',
      side: 'right',
    },
  ],
  chat: [
    {
      target: 'chat-window',
      title: 'Comprueba la ventana de atención',
      description: 'Este indicador muestra si la ventana de WhatsApp está abierta. Si está cerrada, el compositor te indica las opciones disponibles según tus permisos.',
    },
    {
      target: 'chat-blocked',
      title: 'Revisa por qué el chat está bloqueado',
      description: 'Aquí aparece el motivo y las acciones disponibles para retomar la atención.',
      side: 'top',
    },
    ...chatFeatures,
  ],
  example: chatFeatures,
}

function findGuideTarget(root: ParentNode, key: string) {
  const selector = `[data-inbox-guide="${key}"]`
  return Array.from(root.querySelectorAll(selector)).find((element) =>
    element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible',
  )
}

function visibleSteps(section: GuideSection, root: ParentNode): DriveStep[] {
  return guideSteps[section].flatMap(({ target, fallback, title, description, side }) => {
    const element = findGuideTarget(root, target) ?? (fallback && findGuideTarget(root, fallback))
    return element ? [{ element, popover: { title, description, side } }] : []
  })
}

export function useInboxGuide(conversationId: number | null) {
  const pending = useRef<AbortController | null>(null)
  const active = useRef<Driver | null>(null)

  useEffect(() => () => {
    pending.current?.abort()
    active.current?.destroy()
  }, [conversationId])

  return async function startGuide(section: GuideSection, trigger: HTMLElement, onEnd?: (restoreFocus: boolean) => void) {
    pending.current?.abort()
    const request = new AbortController()
    pending.current = request
    let started = false
    try {
      const [{ driver }] = await Promise.all([
        import('driver.js'),
        import('driver.js/dist/driver.css'),
      ])
      if (request.signal.aborted || !trigger.isConnected) return

      const root = section === 'example' ? trigger.closest('[data-inbox-guide-example]') : document
      const steps = root ? visibleSteps(section, root) : []
      if (!steps.length) {
        notify.error('La guía estará disponible cuando termine de cargar esta vista.')
        return
      }

      active.current?.destroy()
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const tour = driver({
        steps,
        popoverClass: 'inbox-guide-popover',
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Siguiente',
        prevBtnText: 'Atrás',
        doneBtnText: 'Listo',
        closeBtnLabel: 'Cerrar guía',
        skipMissingElement: true,
        disableActiveInteraction: true,
        animate: !reduceMotion,
        smoothScroll: !reduceMotion,
        onDestroyed: (_element, _step, { driver: ended, reason }) => {
          if (active.current === ended) active.current = null
          if (!trigger.isConnected) return
          const restoreFocus = reason !== 'api' && reason !== 'replaced'
          if (onEnd) onEnd(restoreFocus)
          else if (restoreFocus) trigger.focus({ preventScroll: true })
        },
      })
      active.current = tour
      tour.drive()
      started = true
    } catch {
      if (!request.signal.aborted) {
        active.current?.destroy()
        notify.error('No se pudo abrir la guía. Intenta de nuevo.')
      }
    } finally {
      if (pending.current === request) pending.current = null
      if (!started && trigger.isConnected) onEnd?.(!request.signal.aborted)
    }
  }
}
