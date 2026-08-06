import { useEffect, useRef, useState, type RefObject } from 'react'
import { insertAtSelection, wrapSelection } from '@/shared/textSelection'
import { apiClient } from '@/shared/api'
import {
  BODY_TEXT_MAX_LEN,
  ensureExampleValues,
  type TemplateBuilderState,
} from './templateFormUtils'
import {
  extractPlaceholders,
  labelForPlaceholder,
  sanitizeAlias,
} from './templatePreviewUtils'

type FlowOption = {
  id: number
  name: string
  trigger_payload: string
  status: string
}

type TemplateBuilderFieldsProps = {
  builder: TemplateBuilderState
  onChange: (next: TemplateBuilderState) => void
}

function StepBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
      {n}
    </span>
  )
}

function FormatToolbar({
  inputRef,
  value,
  onUpdate,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onUpdate: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        className="rounded-lg border border-line px-2.5 py-1 text-sm font-bold hover:bg-accent-soft"
        title="Negrita"
        aria-label="Negrita"
        onClick={() => wrapSelection(inputRef.current, '*', value, onUpdate)}
      >
        B
      </button>
      <button
        type="button"
        className="rounded-lg border border-line px-2.5 py-1 text-sm italic hover:bg-accent-soft"
        title="Cursiva"
        aria-label="Cursiva"
        onClick={() => wrapSelection(inputRef.current, '_', value, onUpdate)}
      >
        I
      </button>
      <span className="muted text-xs">WhatsApp: *negrita*, _cursiva_</span>
    </div>
  )
}

function promptAlias(): string | null {
  const raw = window.prompt(
    'Nombre de la variable (solo letras, números y guion bajo):',
    'fecha',
  )
  if (raw === null) return null
  const alias = sanitizeAlias(raw)
  if (!alias) {
    window.alert(
      'Ingresa un nombre válido, por ejemplo: fecha, horario o mes.',
    )
    return null
  }
  return alias
}

function ExampleFields({
  prefix,
  text,
  values,
  onChange,
}: {
  prefix: string
  text: string
  values: string[]
  onChange: (next: string[]) => void
}) {
  const placeholders = extractPlaceholders(text)
  const aligned = ensureExampleValues(values, placeholders.length)
  if (!placeholders.length) {
    return (
      <p className="text-xs text-muted">
        Este bloque no requiere ejemplos porque no tiene variables.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {placeholders.map((token, idx) => (
        <label key={`${prefix}-${token}-${idx}`} className="block text-sm">
          <span className="text-muted">
            Ejemplo {labelForPlaceholder(token, idx)}
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm"
            value={aligned[idx] || ''}
            onChange={(e) => {
              const next = [...aligned]
              next[idx] = e.target.value
              onChange(next)
            }}
            required
            autoComplete="off"
          />
        </label>
      ))}
    </div>
  )
}

export function TemplateBuilderFields({
  builder,
  onChange,
}: TemplateBuilderFieldsProps) {
  const headerTextRef = useRef<HTMLTextAreaElement>(null)
  const bodyTextRef = useRef<HTMLTextAreaElement>(null)
  const buttonUrlRefs = useRef<(HTMLInputElement | null)[]>([])
  const [flows, setFlows] = useState<FlowOption[]>([])

  useEffect(() => {
    apiClient
      .get<FlowOption[]>('/api/flows')
      .then((res) => {
        if (res.ok) {
          setFlows(res.data.filter((f) => f.status === 'active'))
        }
      })
      .catch(() => undefined)
  }, [])

  const headerPlaceholders = extractPlaceholders(builder.header.text)
  const headerExamples = ensureExampleValues(
    builder.header.exampleValues,
    headerPlaceholders.length,
  )
  const bodyExamples = ensureExampleValues(
    builder.body.exampleValues,
    extractPlaceholders(builder.body.text).length,
  )

  function updateHeader(patch: Partial<TemplateBuilderState['header']>) {
    onChange({ ...builder, header: { ...builder.header, ...patch } })
  }

  function updateBody(patch: Partial<TemplateBuilderState['body']>) {
    onChange({ ...builder, body: { ...builder.body, ...patch } })
  }

  function updateButton(
    index: number,
    patch: Partial<TemplateBuilderState['buttons'][number]>,
  ) {
    onChange({
      ...builder,
      buttons: builder.buttons.map((btn, i) =>
        i === index ? { ...btn, ...patch } : btn,
      ),
    })
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-line p-4">
        <div className="flex items-center gap-2">
          <StepBadge n={1} />
          <h3 className="font-medium">Cabecera</h3>
        </div>
        <label className="block text-sm">
          <span className="text-muted">Tipo de cabecera</span>
          <select
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
            value={builder.header.type}
            onChange={(e) => updateHeader({ type: e.target.value })}
          >
            <option value="none">Sin cabecera</option>
            <option value="text">Texto</option>
            <option value="image">Imagen</option>
            <option value="video">Video</option>
            <option value="document">Documento</option>
          </select>
        </label>

        {builder.header.type === 'none' ? (
          <p className="text-xs text-muted">
            La cabecera es opcional. Puedes usar texto o media.
          </p>
        ) : null}

        {builder.header.type === 'text' ? (
          <>
            <label className="block text-sm">
              <span className="text-muted">Texto cabecera</span>
              <textarea
                ref={headerTextRef}
                rows={2}
                className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={builder.header.text}
                onChange={(e) => updateHeader({ text: e.target.value })}
                placeholder="Invitación para {{mes}}"
                maxLength={60}
                required
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <FormatToolbar
                inputRef={headerTextRef}
                value={builder.header.text}
                onUpdate={(text) => updateHeader({ text })}
              />
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
                onClick={() => {
                  const alias = promptAlias()
                  if (!alias) return
                  insertAtSelection(
                    headerTextRef.current,
                    `{{${alias}}}`,
                    builder.header.text,
                    (text) => updateHeader({ text }),
                  )
                }}
              >
                Añadir variable
              </button>
            </div>
            <ExampleFields
              prefix="header"
              text={builder.header.text}
              values={headerExamples}
              onChange={(exampleValues) => updateHeader({ exampleValues })}
            />
            {headerPlaceholders.length > 1 ? (
              <p className="text-xs text-bad">
                La cabecera de texto solo admite 1 variable.
              </p>
            ) : null}
          </>
        ) : null}

        {['image', 'video', 'document'].includes(builder.header.type) ? (
          <>
            <label className="block text-sm">
              <span className="text-muted">
                {builder.header.type === 'image'
                  ? 'URL pública de imagen de ejemplo'
                  : builder.header.type === 'video'
                    ? 'URL pública de video de ejemplo'
                    : 'URL pública de documento PDF de ejemplo'}
              </span>
              <input
                type="url"
                className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={builder.header.exampleMediaUrl}
                onChange={(e) =>
                  updateHeader({ exampleMediaUrl: e.target.value })
                }
                placeholder="https://…"
                required
                autoComplete="off"
              />
            </label>
            <p className="text-xs text-muted">
              Meta revisa este archivo para aprobar la plantilla. Debe ser
              accesible públicamente.
            </p>
            {builder.header.exampleHandle ? (
              <p className="text-xs text-muted">
                Si no cambias la URL, se reutilizará el ejemplo media ya
                guardado localmente.
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-line p-4">
        <div className="flex items-center gap-2">
          <StepBadge n={2} />
          <h3 className="font-medium">Cuerpo</h3>
        </div>
        <label className="block text-sm">
          <span className="text-muted">Texto cuerpo</span>
          <textarea
            ref={bodyTextRef}
            rows={6}
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
            value={builder.body.text}
            onChange={(e) => updateBody({ text: e.target.value })}
            placeholder="Hola {{nombre}}, te esperamos el {{fecha}} a las {{horario}}."
            required
          />
        </label>
        <p
          className={`text-xs ${builder.body.text.length > BODY_TEXT_MAX_LEN ? 'text-bad' : 'text-muted'}`}
        >
          {builder.body.text.length} / {BODY_TEXT_MAX_LEN} caracteres
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <FormatToolbar
            inputRef={bodyTextRef}
            value={builder.body.text}
            onUpdate={(text) => updateBody({ text })}
          />
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => {
              const alias = promptAlias()
              if (!alias) return
              insertAtSelection(
                bodyTextRef.current,
                `{{${alias}}}`,
                builder.body.text,
                (text) => updateBody({ text }),
              )
            }}
          >
            Añadir variable
          </button>
        </div>
        <ExampleFields
          prefix="body"
          text={builder.body.text}
          values={bodyExamples}
          onChange={(exampleValues) => updateBody({ exampleValues })}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-line p-4">
        <div className="flex items-center gap-2">
          <StepBadge n={3} />
          <h3 className="font-medium">Pie (opcional)</h3>
        </div>
        <label className="block text-sm">
          <span className="text-muted">Texto pie</span>
          <input
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
            value={builder.footer.text}
            onChange={(e) =>
              onChange({ ...builder, footer: { text: e.target.value } })
            }
            placeholder="Cupos limitados."
            maxLength={60}
            autoComplete="off"
          />
        </label>
        <p className="text-xs text-muted">El pie no admite variables.</p>
      </section>

      <section className="space-y-3 rounded-xl border border-line p-4">
        <div className="flex items-center gap-2">
          <StepBadge n={4} />
          <h3 className="font-medium">Botones</h3>
        </div>

        {builder.buttons.length === 0 ? (
          <p className="text-xs text-muted">
            Hasta 3 botones: URL (máx. 2) o respuesta rápida. En respuesta
            rápida el texto es lo que ve el contacto; el trigger es el payload
            que inicia el flujo.
          </p>
        ) : null}

        {builder.buttons.map((btn, index) => {
          const isQr = String(btn.type || '').toLowerCase() === 'quick_reply'
          const urlPlaceholders = extractPlaceholders(btn.url)
          const urlExamples = ensureExampleValues(
            btn.exampleValues,
            urlPlaceholders.length,
          )
          return (
            <div
              key={index}
              className="space-y-2 rounded-lg border border-line p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {isQr ? 'Respuesta rápida' : 'Botón URL'} {index + 1}
                </p>
                <button
                  type="button"
                  className="text-sm text-bad"
                  onClick={() =>
                    onChange({
                      ...builder,
                      buttons: builder.buttons.filter((_, i) => i !== index),
                    })
                  }
                >
                  Quitar
                </button>
              </div>
              <label className="block text-sm">
                <span className="text-muted">Tipo</span>
                <select
                  className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                  value={isQr ? 'quick_reply' : 'url'}
                  onChange={(e) =>
                    updateButton(index, {
                      type: e.target.value,
                      url: e.target.value === 'quick_reply' ? '' : btn.url,
                      payload:
                        e.target.value === 'quick_reply' ? btn.payload || '' : '',
                      exampleValues:
                        e.target.value === 'quick_reply' ? [] : btn.exampleValues,
                    })
                  }
                >
                  <option value="url">URL</option>
                  <option value="quick_reply">Respuesta rápida</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-muted">
                  {isQr ? 'Texto del botón (lo que ve el contacto)' : 'Texto del botón'}
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                  value={btn.text}
                  onChange={(e) => updateButton(index, { text: e.target.value })}
                  maxLength={25}
                  required
                  autoComplete="off"
                  placeholder={isQr ? 'Iniciar' : undefined}
                />
              </label>
              {isQr ? (
                <>
                  <label className="block text-sm">
                    <span className="text-muted">Trigger del flujo (payload)</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 font-mono text-sm"
                      value={btn.payload || ''}
                      onChange={(e) =>
                        updateButton(index, { payload: e.target.value })
                      }
                      maxLength={256}
                      required
                      autoComplete="off"
                      placeholder="INICIAR_FLUJO"
                      list={`flow-triggers-${index}`}
                    />
                    <datalist id={`flow-triggers-${index}`}>
                      {flows.map((f) => (
                        <option
                          key={f.id}
                          value={f.trigger_payload}
                          label={`${f.name} · ${f.trigger_payload}`}
                        />
                      ))}
                    </datalist>
                  </label>
                  <p className="text-xs text-muted">
                    Debe coincidir con el Trigger key del flujo. El contacto
                    solo ve el texto de arriba.
                  </p>
                  {flows.length > 0 ? (
                    <label className="block text-sm">
                      <span className="text-muted">Usar trigger de un flujo</span>
                      <select
                        className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm"
                        value=""
                        onChange={(e) => {
                          const trigger = e.target.value
                          if (!trigger) return
                          updateButton(index, { payload: trigger })
                        }}
                      >
                        <option value="">Elegir flujo activo…</option>
                        {flows.map((f) => (
                          <option key={f.id} value={f.trigger_payload}>
                            {f.name} · {f.trigger_payload}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="text-muted">URL</span>
                    <input
                      ref={(el) => {
                        buttonUrlRefs.current[index] = el
                      }}
                      className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                      value={btn.url}
                      onChange={(e) =>
                        updateButton(index, { url: e.target.value })
                      }
                      placeholder="https://mali.pe/evento/{{codigo}}"
                      required
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
                    onClick={() => {
                      const alias = promptAlias()
                      if (!alias) return
                      insertAtSelection(
                        buttonUrlRefs.current[index],
                        `{{${alias}}}`,
                        btn.url,
                        (url) => updateButton(index, { url }),
                      )
                    }}
                  >
                    Añadir variable
                  </button>
                  <ExampleFields
                    prefix={`button-${index}`}
                    text={btn.url}
                    values={urlExamples}
                    onChange={(exampleValues) =>
                      updateButton(index, { exampleValues })
                    }
                  />
                  {urlPlaceholders.length > 1 ? (
                    <p className="text-xs text-bad">
                      Cada botón URL admite solo 1 variable.
                    </p>
                  ) : null}
                  {urlPlaceholders.length === 1 &&
                  !/\}\}\s*$/.test(btn.url || '') ? (
                    <p className="text-xs text-bad">
                      La variable del botón URL debe ir al final de la URL.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          )
        })}

        <div className="flex flex-wrap gap-2">
          {builder.buttons.length < 3 &&
          builder.buttons.filter((b) => b.type !== 'quick_reply').length < 2 ? (
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() =>
                onChange({
                  ...builder,
                  buttons: [
                    ...builder.buttons,
                    { type: 'url', text: '', payload: '', url: '', exampleValues: [] },
                  ],
                })
              }
            >
              Añadir botón URL
            </button>
          ) : null}
          {builder.buttons.length < 3 ? (
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() =>
                onChange({
                  ...builder,
                  buttons: [
                    ...builder.buttons,
                    {
                      type: 'quick_reply',
                      text: '',
                      payload: '',
                      url: '',
                      exampleValues: [],
                    },
                  ],
                })
              }
            >
              Añadir respuesta rápida
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
