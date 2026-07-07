export function formatAdvisorLabel(input: {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}): string {
  const local = String(input.email).split('@')[0]?.trim();
  if (local) return local;
  return String(input.email).trim();
}
