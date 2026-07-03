export const SEGMENT_COLOR_KEYS = [
  'teal',
  'emerald',
  'blue',
  'violet',
  'amber',
  'rose',
  'slate',
] as const

export const SEGMENT_COLOR_LABELS: Record<string, string> = {
  teal: 'MALI',
  emerald: 'Verde',
  blue: 'Azul',
  violet: 'Violeta',
  amber: 'Ámbar',
  rose: 'Rosa',
  slate: 'Gris',
}

export const SEGMENT_TONE_CLASS: Record<string, string> = {
  teal: 'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  emerald: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  blue: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  violet: 'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  amber: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  rose: 'bg-rose-500/20 text-rose-700 dark:text-rose-300',
  slate: 'bg-slate-500/20 text-slate-700 dark:text-slate-300',
}

export function segmentToneClass(colorKey: string | null | undefined): string {
  return SEGMENT_TONE_CLASS[colorKey ?? 'teal'] ?? SEGMENT_TONE_CLASS.teal
}
