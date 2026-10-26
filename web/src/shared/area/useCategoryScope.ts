import { useEffect, useState } from 'react'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import {
  canonicalArea,
  onCategorySelection,
  readCategorySelection,
} from './category-selection'

export function categoryLabel(slug: string | null | undefined): string {
  if (!slug || slug === 'general') return 'General'
  return slug.toUpperCase()
}

export function categorySettingsArea(slug: string): string {
  if (slug === 'general') return 'educacion'
  return `educacion_${slug}`
}

/** Selección del riel. `query` va vacío cuando están todas, para no recortar de más. */
export function useCategoryScope() {
  const user = useAppUser()
  const education = !!user && canonicalArea(user.area) === 'educacion'
  const [allowed, setAllowed] = useState<string[]>([])
  const [revision, setRevision] = useState(0)

  useEffect(() => onCategorySelection(() => setRevision((n) => n + 1)), [])

  useEffect(() => {
    if (!education) return
    void apiClient.getEducationCategories().then((result) => {
      if (result.ok) setAllowed(result.data.map((item) => item.slug))
    })
  }, [education, user?.id])

  const stored =
    education && user && revision >= 0
      ? readCategorySelection(user.id, user.area)
      : null
  const slugs = !education ? null : stored ?? (allowed.length ? allowed : null)
  const query =
    stored && stored.length
      ? stored.map((slug) => `category=${encodeURIComponent(slug)}`).join('&')
      : ''

  return { education, slugs, stored, query, revision }
}

/** Categoría en la que se guardará un alta. null fuera de Educación o mientras carga. */
export function draftCategorySlug(scope: {
  education: boolean
  stored: string[] | null
  slugs: string[] | null
}): string | null {
  if (!scope.education) return null
  if (!scope.stored && !scope.slugs?.length) return null
  if (scope.stored?.length === 1) return scope.stored[0]
  if (!scope.stored && scope.slugs?.length === 1) return scope.slugs[0]
  return 'general'
}

/** undefined: varias categorías marcadas, el alta queda en General. */
export function categoryToSave(scope: {
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
