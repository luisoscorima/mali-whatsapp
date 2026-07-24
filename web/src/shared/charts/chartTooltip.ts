/** Estilos legibles del tooltip de Recharts (evita texto --muted sobre fondo claro). */
export const chartTooltipProps = {
  contentStyle: {
    background: 'var(--surface-strong)',
    border: '1px solid var(--line)',
    borderRadius: 8,
    color: 'var(--ink)',
  },
  labelStyle: { color: 'var(--ink)' },
  itemStyle: { color: 'var(--ink)' },
} as const
