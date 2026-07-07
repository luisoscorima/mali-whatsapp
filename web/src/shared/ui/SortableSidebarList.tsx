import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'

type SortableSidebarListProps<T extends { id: number }> = {
  items: T[]
  onReorder: (orderedIds: number[]) => void | Promise<void>
  renderItem: (item: T, dragHandle: ReactNode) => ReactNode
  className?: string
}

function DragHandle(props: {
  listeners: ReturnType<typeof useSortable>['listeners']
}) {
  return (
    <button
      type="button"
      className="cursor-grab px-1 text-xs text-muted active:cursor-grabbing"
      aria-label="Reordenar"
      {...props.listeners}
    >
      ⠿
    </button>
  )
}

function SortableRow<T extends { id: number }>({
  item,
  renderItem,
}: {
  item: T
  renderItem: (item: T, dragHandle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  }
  return (
    <li ref={setNodeRef} style={style} {...attributes}>
      {renderItem(item, <DragHandle listeners={listeners} />)}
    </li>
  )
}

export function SortableSidebarList<T extends { id: number }>({
  items,
  onReorder,
  renderItem,
  className = 'inbox-chat-list',
}: SortableSidebarListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((item) => item.id === active.id)
    const newIndex = items.findIndex((item) => item.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(items, oldIndex, newIndex)
    await onReorder(next.map((item) => item.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {items.map((item) => (
            <SortableRow key={item.id} item={item} renderItem={renderItem} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
