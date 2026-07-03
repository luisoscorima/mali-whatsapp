export function SettingsPlaceholderPage({ title }: { title: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted">
        Este módulo se implementará en las semanas 31–32 (informes y bitácora en v2).
      </p>
    </section>
  )
}
