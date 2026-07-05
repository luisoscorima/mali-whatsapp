import { type FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { WaSpanMainPage } from '@/shared/ui/shell/WaSpanMainPage'

type ImportResult = {
  imported: number
  errors: number
  error_samples: Array<{ line: number; message: string }>
  duplicate_phones_in_file: number
  duplicate_rows_in_file: number
  duplicate_phone_examples: string[]
}

export function ContactImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Selecciona un archivo CSV o Excel')
      return
    }

    setImporting(true)
    setError('')
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    const response = await apiClient.postFormData<ImportResult>(
      '/api/contacts/import',
      formData,
    )
    setImporting(false)

    if (!response.ok) {
      setError(response.error)
      return
    }
    setResult(response.data)
  }

  return (
    <WaSpanMainPage>
    <div className="space-y-4">
      <div>
        <Link to="/contacts" className="text-sm text-accent hover:underline">
          ← Contactos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Importar contactos</h1>
        <p className="text-sm text-muted">CSV o Excel (.xlsx) masivo</p>
      </div>

      {error ? <p className="text-bad">{error}</p> : null}

      {result ? (
        <div className="rounded-xl border border-line bg-surface-strong p-4 text-sm">
          <p className="text-accent">
            Importadas: {result.imported} fila(s).
            {result.errors > 0 ? ` Omitidas: ${result.errors}.` : ''}
          </p>
          {result.duplicate_phones_in_file > 0 ? (
            <p className="mt-2 text-muted">
              Aviso: {result.duplicate_phones_in_file} teléfono(s) repetido(s) en el
              archivo ({result.duplicate_rows_in_file} fila(s)); gana la última fila.
              {result.duplicate_phone_examples.length > 0
                ? ` Ejemplos: ${result.duplicate_phone_examples.join(', ')}.`
                : ''}
            </p>
          ) : null}
          {result.error_samples.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-muted">
                Ver errores de filas ({result.error_samples.length})
              </summary>
              <ul className="mt-2 list-disc pl-5 text-muted">
                {result.error_samples.map((item) => (
                  <li key={`${item.line}-${item.message}`}>
                    Línea {item.line}: {item.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="max-w-lg space-y-4 rounded-xl border border-line bg-surface-strong p-4"
      >
        <label className="block text-sm">
          <span className="text-muted">Archivo CSV o Excel</span>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={importing}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {importing ? 'Importando…' : 'Importar'}
          </button>
          <a
            href="/api/contacts/import/sample"
            className="text-sm text-accent hover:underline"
          >
            Descargar plantilla Excel
          </a>
        </div>
      </form>

      <p className="max-w-lg text-sm text-muted">
        Columnas: <code className="font-mono">name</code>,{' '}
        <code className="font-mono">last_name</code> (o apellido),{' '}
        <code className="font-mono">phone</code>, <code className="font-mono">segment</code>.
        Opcional: <code className="font-mono">prefix</code> y columnas extra como atributos
        (slugs definidos en Atributos). Varios segmentos separados por ; o ,.
      </p>
    </div>
    </WaSpanMainPage>
  )
}
