export function templateStatusAllowsEdit(status: string): boolean {
  const s = String(status || '')
    .trim()
    .toUpperCase();
  return s === 'PENDING' || s === 'REJECTED';
}
