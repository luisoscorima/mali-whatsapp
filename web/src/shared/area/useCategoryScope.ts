import { useEffect, useState } from 'react'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import {
  canonicalArea,
  onCategorySelection,
  readCategorySelection,
} from './category-selection'

export type CategoryOption = { slug: string; label: string }

export function categoryLabel(slug: string | null | undefined): string {
  if (!slug || slug === 'general') return 'General'
  if (slug === 'ca') return 'Cursos de Arte'
  if (slug === 'ep') return 'Extensión Profesional'
  return slug.toUpperCase()
}

export function categoryLine(slugs: Array<string | null | undefined>): string {
  const labels: string[] = []
  for (const slug of slugs) {
    const label = categoryLabel(slug)
    if (!labels.includes(label)) labels.push(label)
  }
  return labels.join(' · ')
}

/** La fila nombra la categoría solo cuando el riel mezcla varias. */
export function mixesCategories(scope: {
  enabled: boolean
  education: boolean
  slugs: string[] | null
}): boolean {
  return Boolean(scope.enabled && scope.slugs && scope.slugs.length > 1)
}

export function categorySettingsArea(
  slug: string,
  areaCanonical = 'educacion',
): string {
  if (slug === 'general') return areaCanonical
  return `${areaCanonical}_${slug}`
}

function createPrefill(
  options: CategoryOption[],
  stored: string[] | null,
): string {
  if (options.length === 1) return options[0].slug
  if (stored?.length === 1 && options.some((item) => item.slug === stored[0])) {
    return stored[0]
  }
  return ''
}

/** Selección del riel. `query` va vacío cuando van todas, para no recortar de más. */
export function useCategoryScope() {
  const user = useAppUser()
  const areaCanonical = user ? canonicalArea(user.area) : ''
  const education = areaCanonical === 'educacion'
  const [options, setOptions] = useState<CategoryOption[]>([])
  const [revision, setRevision] = useState(0)

  useEffect(() => onCategorySelection(() => setRevision((n) => n + 1)), [])

  useEffect(() => {
    if (!user) return
    void apiClient.getEducationCategories().then((result) => {
      if (result.ok) setOptions(result.data)
      else setOptions([])
    })
  }, [areaCanonical, user?.id])

  const allowed = options.map((item) => item.slug)
  const enabled = allowed.length > 0
  const stored =
    enabled && user && revision >= 0
      ? readCategorySelection(user.id, user.area)
      : null
  const slugs = !enabled ? null : stored ?? (allowed.length ? allowed : null)
  const query =
    stored && stored.length
      ? stored.map((slug) => `category=${encodeURIComponent(slug)}`).join('&')
      : ''

  return {
    enabled,
    education,
    areaCanonical,
    options,
    slugs,
    stored,
    query,
    revision,
  }
}

/**
 * Campo de categoría para altas. Selector solo si hay más de una permitida;
 * con varias en el riel no asume General: hay que elegir.
 */
export function useCreateCategoryField() {
  const scope = useCategoryScope()
  const [category, setCategory] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setCategory((current) => {
      if (current && scope.options.some((item) => item.slug === current)) {
        return current
      }
      return createPrefill(scope.options, scope.stored)
    })
  }, [scope.options, scope.stored])

  const needsPicker = scope.options.length > 1
  const categoryForApi =
    !scope.options.length
      ? undefined
      : category || (needsPicker ? undefined : scope.options[0]?.slug)
  const missingCategory = needsPicker && !category

  function onCategoryChange(next: string) {
    setTouched(true)
    setCategory(next)
  }

  function requireCategory(): boolean {
    if (!missingCategory) return true
    setTouched(true)
    return false
  }

  return {
    scope,
    needsPicker,
    options: scope.options,
    category,
    setCategory: onCategoryChange,
    categoryForApi,
    missingCategory,
    showMissing: missingCategory && touched,
    requireCategory,
  }
}

/** Categoría en la que se guardará un alta. null si el área no usa categorías o mientras carga. */
export function draftCategorySlug(scope: {
  enabled?: boolean
  education: boolean
  stored: string[] | null
  slugs: string[] | null
}): string | null {
  const active = scope.enabled ?? scope.education
  if (!active) return null
  if (!scope.stored && !scope.slugs?.length) return null
  if (scope.stored?.length === 1) return scope.stored[0]
  if (!scope.stored && scope.slugs?.length === 1) return scope.slugs[0]
  return 'general'
}

/** undefined: varias categorías marcadas, el alta queda en General. */
export function categoryToSave(scope: {
  enabled?: boolean
  education: boolean
  stored: string[] | null
  slugs: string[] | null
}): string | undefined {
  const slug = draftCategorySlug(scope)
  if (!slug) return undefined
  const single =
    scope.stored?.length === 1 || (!scope.stored && scope.slugs?.length === 1)
  if (slug === 'general' && !single) return undefined
  return slug
}

export function withCategoryQuery(path: string, query: string): string {
  if (!query) return path
  return path.includes('?') ? `${path}&${query}` : `${path}?${query}`
}
