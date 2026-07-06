import type { CSSProperties } from 'react'
import type { Theme } from '@/shared/theme/useTheme'

export const SEGMENT_COLOR_KEYS = [
  'teal',
  'emerald',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'rose',
  'pink',
  'red',
  'orange',
  'amber',
  'lime',
  'slate',
] as const

export type SegmentColorKey = (typeof SEGMENT_COLOR_KEYS)[number]

type Rgb = readonly [number, number, number]

type SegmentTone = {
  label: string
  swatch: string
  light: { text: Rgb; pillBg: number; pillBorder: number; activeBg: number; activeBorder: number; activeText: Rgb }
  dark: { text: Rgb; pillBg: number; pillBorder: number }
  badge: { bg: number; border: number; text: Rgb }
}

function rgb([r, g, b]: Rgb): string {
  return `rgb(${r} ${g} ${b})`
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const SEGMENT_TONES: Record<SegmentColorKey, SegmentTone> = {
  teal: {
    label: 'MALI',
    swatch: 'rgb(13, 148, 136)',
    light: {
      text: [15, 118, 110],
      pillBg: 0.08,
      pillBorder: 0.26,
      activeBg: 0.24,
      activeBorder: 0.58,
      activeText: [13, 116, 106],
    },
    dark: { text: [153, 246, 228], pillBg: 0.14, pillBorder: 0.32 },
    badge: { bg: 0.14, border: 0.32, text: [15, 118, 110] },
  },
  emerald: {
    label: 'Verde',
    swatch: 'rgb(5, 150, 105)',
    light: {
      text: [4, 120, 87],
      pillBg: 0.08,
      pillBorder: 0.26,
      activeBg: 0.24,
      activeBorder: 0.58,
      activeText: [4, 100, 74],
    },
    dark: { text: [167, 243, 208], pillBg: 0.14, pillBorder: 0.32 },
    badge: { bg: 0.14, border: 0.32, text: [4, 120, 87] },
  },
  cyan: {
    label: 'Cian',
    swatch: 'rgb(8, 145, 178)',
    light: {
      text: [14, 116, 144],
      pillBg: 0.08,
      pillBorder: 0.26,
      activeBg: 0.24,
      activeBorder: 0.58,
      activeText: [21, 94, 117],
    },
    dark: { text: [165, 243, 252], pillBg: 0.14, pillBorder: 0.32 },
    badge: { bg: 0.14, border: 0.32, text: [14, 116, 144] },
  },
  sky: {
    label: 'Cielo',
    swatch: 'rgb(2, 132, 199)',
    light: {
      text: [3, 105, 161],
      pillBg: 0.08,
      pillBorder: 0.24,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [7, 89, 133],
    },
    dark: { text: [186, 230, 253], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.12, border: 0.28, text: [3, 105, 161] },
  },
  blue: {
    label: 'Azul',
    swatch: 'rgb(37, 99, 235)',
    light: {
      text: [29, 78, 216],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [29, 78, 216],
    },
    dark: { text: [191, 219, 254], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.12, border: 0.28, text: [29, 78, 216] },
  },
  indigo: {
    label: 'Índigo',
    swatch: 'rgb(79, 70, 229)',
    light: {
      text: [67, 56, 202],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [55, 48, 163],
    },
    dark: { text: [199, 210, 254], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.12, border: 0.28, text: [67, 56, 202] },
  },
  violet: {
    label: 'Violeta',
    swatch: 'rgb(124, 58, 237)',
    light: {
      text: [109, 40, 217],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [91, 33, 182],
    },
    dark: { text: [221, 214, 254], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.12, border: 0.28, text: [109, 40, 217] },
  },
  fuchsia: {
    label: 'Fucsia',
    swatch: 'rgb(192, 38, 211)',
    light: {
      text: [162, 28, 175],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [134, 25, 143],
    },
    dark: { text: [245, 208, 254], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.12, border: 0.28, text: [162, 28, 175] },
  },
  rose: {
    label: 'Rosa',
    swatch: 'rgb(225, 29, 72)',
    light: {
      text: [190, 18, 60],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [190, 18, 60],
    },
    dark: { text: [254, 205, 211], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.1, border: 0.28, text: [190, 18, 60] },
  },
  pink: {
    label: 'Rosado',
    swatch: 'rgb(219, 39, 119)',
    light: {
      text: [190, 24, 93],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [157, 23, 77],
    },
    dark: { text: [251, 207, 232], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.1, border: 0.28, text: [190, 24, 93] },
  },
  red: {
    label: 'Rojo',
    swatch: 'rgb(220, 38, 38)',
    light: {
      text: [185, 28, 28],
      pillBg: 0.08,
      pillBorder: 0.22,
      activeBg: 0.22,
      activeBorder: 0.55,
      activeText: [153, 27, 27],
    },
    dark: { text: [254, 202, 202], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.1, border: 0.28, text: [185, 28, 28] },
  },
  orange: {
    label: 'Naranja',
    swatch: 'rgb(234, 88, 12)',
    light: {
      text: [194, 65, 12],
      pillBg: 0.08,
      pillBorder: 0.24,
      activeBg: 0.24,
      activeBorder: 0.58,
      activeText: [154, 52, 18],
    },
    dark: { text: [254, 215, 170], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.14, border: 0.3, text: [194, 65, 12] },
  },
  amber: {
    label: 'Ámbar',
    swatch: 'rgb(217, 119, 6)',
    light: {
      text: [180, 83, 9],
      pillBg: 0.08,
      pillBorder: 0.24,
      activeBg: 0.24,
      activeBorder: 0.58,
      activeText: [161, 72, 8],
    },
    dark: { text: [253, 230, 138], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.14, border: 0.3, text: [180, 83, 9] },
  },
  lime: {
    label: 'Lima',
    swatch: 'rgb(101, 163, 13)',
    light: {
      text: [77, 124, 15],
      pillBg: 0.08,
      pillBorder: 0.24,
      activeBg: 0.24,
      activeBorder: 0.58,
      activeText: [63, 98, 18],
    },
    dark: { text: [217, 249, 157], pillBg: 0.14, pillBorder: 0.3 },
    badge: { bg: 0.14, border: 0.3, text: [77, 124, 15] },
  },
  slate: {
    label: 'Gris',
    swatch: 'rgb(71, 85, 105)',
    light: {
      text: [71, 85, 105],
      pillBg: 0.08,
      pillBorder: 0.25,
      activeBg: 0.22,
      activeBorder: 0.52,
      activeText: [51, 65, 85],
    },
    dark: { text: [203, 213, 225], pillBg: 0.14, pillBorder: 0.26 },
    badge: { bg: 0.1, border: 0.28, text: [71, 85, 105] },
  },
}

export const SEGMENT_COLOR_LABELS = Object.fromEntries(
  SEGMENT_COLOR_KEYS.map((key) => [key, SEGMENT_TONES[key].label]),
) as Record<SegmentColorKey, string>

export const SEGMENT_SWATCH_BG = Object.fromEntries(
  SEGMENT_COLOR_KEYS.map((key) => [key, SEGMENT_TONES[key].swatch]),
) as Record<SegmentColorKey, string>

export const SEGMENT_TONE_CLASS: Record<string, string> = {
  teal: 'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  emerald: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  cyan: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  sky: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  blue: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  indigo: 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  violet: 'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  fuchsia: 'bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
  rose: 'bg-rose-500/20 text-rose-700 dark:text-rose-300',
  pink: 'bg-pink-500/20 text-pink-700 dark:text-pink-300',
  red: 'bg-red-500/20 text-red-700 dark:text-red-300',
  orange: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  amber: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
  lime: 'bg-lime-500/20 text-lime-700 dark:text-lime-300',
  slate: 'bg-slate-500/20 text-slate-700 dark:text-slate-300',
}

export function normalizeSegmentColorKey(raw: unknown): SegmentColorKey {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  return (SEGMENT_COLOR_KEYS as readonly string[]).includes(value)
    ? (value as SegmentColorKey)
    : 'teal'
}

function toneBaseRgb(key: SegmentColorKey): Rgb {
  const match = SEGMENT_TONES[key].swatch.match(/\d+/g)
  if (!match || match.length < 3) return [13, 148, 136]
  return [Number(match[0]), Number(match[1]), Number(match[2])]
}

export function segmentToneClass(colorKey: string | null | undefined): string {
  const key = normalizeSegmentColorKey(colorKey)
  return SEGMENT_TONE_CLASS[key] ?? SEGMENT_TONE_CLASS.teal
}

export function segmentBadgeStyle(
  colorKey: string | null | undefined,
  theme: Theme,
): CSSProperties {
  const key = normalizeSegmentColorKey(colorKey)
  const tone = SEGMENT_TONES[key]
  const base = toneBaseRgb(key)
  if (theme === 'dark') {
    const darkText = tone.dark.text
    return {
      background: rgba(darkText, tone.dark.pillBg),
      borderColor: rgba(darkText, tone.dark.pillBorder),
      color: rgb(darkText),
    }
  }
  return {
    background: rgba(base, tone.badge.bg),
    borderColor: rgba(base, tone.badge.border),
    color: rgb(tone.badge.text),
  }
}

export function segmentFilterPillStyle(
  colorKey: string | null | undefined,
  theme: Theme,
  active: boolean,
): CSSProperties {
  const key = normalizeSegmentColorKey(colorKey)
  const tone = SEGMENT_TONES[key]
  const base = toneBaseRgb(key)

  if (theme === 'dark') {
    const text = tone.dark.text
    return {
      color: rgb(text),
      background: rgba(text, active ? tone.light.activeBg : tone.dark.pillBg),
      borderColor: rgba(text, active ? tone.light.activeBorder : tone.dark.pillBorder),
    }
  }

  if (active) {
    return {
      color: rgb(tone.light.activeText),
      background: rgba(base, tone.light.activeBg),
      borderColor: rgba(base, tone.light.activeBorder),
    }
  }

  return {
    color: rgb(tone.light.text),
    background: rgba(base, tone.light.pillBg),
    borderColor: rgba(base, tone.light.pillBorder),
  }
}
