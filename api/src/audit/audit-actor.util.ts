import type { AuthUser } from '../auth/auth.types';

export function auditActor(user: AuthUser): {
  userId: number;
  email: string;
  area: string;
} {
  return { userId: user.id, email: user.email, area: user.area };
}

export function phoneMetaTail(phone: string): string | null {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `…${digits.slice(-4)}`;
}
