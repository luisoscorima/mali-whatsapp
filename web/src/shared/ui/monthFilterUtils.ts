const MONTH_NAMES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
]

export type MonthFilterOption = {
  key: string
  label: string
}

export function buildMonthFilterOptions(count = 6): MonthFilterOption[] {
  const options: MonthFilterOption[] = [{ key: '', label: 'Todos' }]
  const now = new Date()
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const year = String(d.getFullYear()).slice(-2)
    const label = `${MONTH_NAMES[d.getMonth()]} ${year}`
    options.push({ key, label })
  }
  return options
}
