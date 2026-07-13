type TextField = HTMLInputElement | HTMLTextAreaElement

export function insertAtSelection(
  el: TextField | null,
  snippet: string,
  current: string,
  onUpdate: (value: string) => void,
) {
  if (!el) return
  const start = el.selectionStart ?? current.length
  const end = el.selectionEnd ?? current.length
  const next = current.slice(0, start) + snippet + current.slice(end)
  onUpdate(next)
  requestAnimationFrame(() => {
    el.focus()
    const pos = start + snippet.length
    el.setSelectionRange(pos, pos)
  })
}

/** Wrap selection with marker (e.g. `*` or `_`). Toggles off if already wrapped. */
export function wrapSelection(
  el: TextField | null,
  marker: string,
  current: string,
  onUpdate: (value: string) => void,
) {
  if (!el) return
  const start = el.selectionStart ?? current.length
  const end = el.selectionEnd ?? current.length
  const selected = current.slice(start, end)
  const m = marker
  const already =
    selected.length >= m.length * 2 &&
    selected.startsWith(m) &&
    selected.endsWith(m)

  let next: string
  let selStart: number
  let selEnd: number

  if (already) {
    const inner = selected.slice(m.length, selected.length - m.length)
    next = current.slice(0, start) + inner + current.slice(end)
    selStart = start
    selEnd = start + inner.length
  } else if (selected.length > 0) {
    const wrapped = `${m}${selected}${m}`
    next = current.slice(0, start) + wrapped + current.slice(end)
    selStart = start + m.length
    selEnd = start + m.length + selected.length
  } else {
    next = current.slice(0, start) + `${m}${m}` + current.slice(end)
    selStart = start + m.length
    selEnd = selStart
  }

  onUpdate(next)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}
