import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthUser } from '../auth/auth.types';
export type BusinessAccessScope = {
  businessAreaId: number;
  canonicalArea: string;
  mode: 'all' | 'restricted';
  programIds: number[];
  lineIds: number[];
  /** null: ve todas las categorías. En Educación restringida, las que tiene marcadas. */
  categorySlugs: string[] | null;
};
export const businessAccessContext = new AsyncLocalStorage<BusinessAccessScope | undefined>();
export function restrictedAccess(): BusinessAccessScope | undefined {
  const scope = businessAccessContext.getStore();
  return scope?.mode === 'restricted' ? scope : undefined;
}
export function runWithBusinessAccess<T>(user: AuthUser, fn: () => T): T {
  return businessAccessContext.run(user.isMaster ? undefined : user.businessAccess, fn);
}
