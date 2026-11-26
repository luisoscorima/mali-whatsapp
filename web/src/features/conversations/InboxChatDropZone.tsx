import { useState, type DragEvent, type ReactNode, type RefObject } from 'react'
import type { InboxComposeBarHandle } from './InboxComposeBar'

type InboxChatDropZoneProps = {
  composerRef: RefObject<InboxComposeBarHandle | null>
  children: ReactNode
}

export function InboxChatDropZone({ composerRef, children }: InboxChatDropZoneProps) {
  const [draggingFiles, setDraggingFiles] = useState(false)

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    const canAttach = composerRef.current?.canAttachFiles ?? false
    event.dataTransfer.dropEffect = canAttach ? 'copy' : 'none'
    setDraggingFiles(canAttach)
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDraggingFiles(false)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    const { files, types } = event.dataTransfer
    if (!files.length && !Array.from(types).includes('Files')) return
    event.preventDefault()
    setDraggingFiles(false)
    composerRef.current?.attachFiles(Array.from(files))
  }

  return (
    <div
      className="inbox-chat-drop-zone"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {draggingFiles && (
        <div className="inbox-chat-drop-zone__overlay" aria-hidden="true">
          <span>Suelta el archivo para adjuntarlo</span>
        </div>
      )}
    </div>
  )
}
