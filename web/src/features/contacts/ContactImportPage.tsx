import { type DragEvent, type FormEvent, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/shared/ui/shadcn/dialog'

type ImportPreview = {
  ready_to_import: number
  will_update: number
  will_create: number
  duplicate_emails_skipped: number
  parse_errors: number
  error_samples: Array<{ line: number; message: string }>
  duplicate_phones_in_file: number
  duplicate_rows_in_file: number
  duplicate_phone_examples: string[]
}

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
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const ACCEPT_TYPES = new Set([
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ])
  const ACCEPT_EXT = /\.(csv|xlsx)$/i

  function pickFile(f: File | undefined) {
    if (!f) return
    if (!ACCEPT_TYPES.has(f.type) && !ACCEPT_EXT.test(f.name)) {
      notify.error('Solo archivos .csv o .xlsx')
      return
    }
    setFile(f)
    setResult(null)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    pickFile(e.dataTransfer.files?.[0])
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      notify.error('Selecciona un archivo CSV o Excel')
      return
    }

    setLoading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    const response = await apiClient.postFormData<ImportPreview>(
      '/api/contacts/import/preview',
      formData,
    )
    setLoading(false)

    if (!response.ok) {
      notify.error(response.error)
      return
    }
    setPreview(response.data)
  }

  async function onConfirm() {
    if (!file) return
    setConfirming(true)

    const formData = new FormData()
    formData.append('file', file)

    const response = await apiClient.postFormData<ImportResult>(
      '/api/contacts/import',
      formData,
    )
    setConfirming(false)
    setPreview(null)

    if (!response.ok) {
      notify.error(response.error)
      return
    }
    setResult(response.data)
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/contacts" className="text-sm text-accent hover:underline">
          ← Contactos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Importar contactos</h1>
        <p className="text-sm text-muted">CSV o Excel (.xlsx) masivo</p>
      </div>

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
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors ${
            dragging
              ? 'border-accent bg-accent/5'
              : 'border-line hover:border-accent/50'
          }`}
        >
          <span className="text-2xl">📄</span>
          {file ? (
            <span className="text-ink">{file.name}</span>
          ) : (
            <>
              <span className="text-muted">
                Arrastra tu archivo aquí o <span className="text-accent underline">haz clic para elegir</span>
              </span>
              <span className="text-xs text-muted">.csv o .xlsx — máx. 10,000 filas</span>
            </>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || !file}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {loading ? 'Analizando…' : 'Analizar archivo'}
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
        <code className="font-mono">last_name</code> (o apellido, opcional),{' '}
        <code className="font-mono">phone</code>, <code className="font-mono">segment</code>.
        Opcional: <code className="font-mono">email</code> (o correo/mail),{' '}
        <code className="font-mono">dni</code> (o documento),{' '}
        <code className="font-mono">prefix</code> y columnas extra como atributos
        (slugs definidos en Atributos). Varios segmentos separados por ; o ,.
      </p>

      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resumen de importación</DialogTitle>
          </DialogHeader>
          {preview ? (
            <DialogBody>
              <div className="space-y-3 text-sm">
                <p>
                  <span className="font-medium text-accent">{preview.ready_to_import}</span>{' '}
                  contacto(s) listos para importar
                </p>
                <div className="space-y-1 text-muted">
                  <p>• {preview.will_create} nuevo(s)</p>
                  <p>• {preview.will_update} existente(s) a actualizar</p>
                </div>

                {preview.duplicate_emails_skipped > 0 ? (
                  <p className="text-amber-600">
                    ⚠ {preview.duplicate_emails_skipped} email(s) ya pertenecen a otro
                    contacto y se omitirán (el contacto se importará sin email).
                  </p>
                ) : null}

                {preview.duplicate_phones_in_file > 0 ? (
                  <p className="text-amber-600">
                    ⚠ {preview.duplicate_phones_in_file} teléfono(s) repetido(s) en el archivo
                    ({preview.duplicate_rows_in_file} fila(s)); se tomará la última fila.
                    {preview.duplicate_phone_examples.length > 0
                      ? ` Ej: ${preview.duplicate_phone_examples.join(', ')}`
                      : ''}
                  </p>
                ) : null}

                {preview.parse_errors > 0 ? (
                  <div>
                    <p className="text-red-500">
                      ✕ {preview.parse_errors} fila(s) con errores (se omitirán)
                    </p>
                    {preview.error_samples.length > 0 ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted">Ver detalle</summary>
                        <ul className="mt-1 list-disc pl-5 text-muted">
                          {preview.error_samples.map((item) => (
                            <li key={`${item.line}-${item.message}`}>
                              Línea {item.line}: {item.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </DialogBody>
          ) : null}
          <DialogFooter>
            <DialogClose>Cancelar</DialogClose>
            <button
              type="button"
              disabled={confirming || !preview?.ready_to_import}
              onClick={onConfirm}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white disabled:opacity-60"
            >
              {confirming ? 'Importando…' : `Importar ${preview?.ready_to_import ?? 0} contacto(s)`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
