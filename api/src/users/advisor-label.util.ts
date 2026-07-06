export function formatAdvisorLabel(input: {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}): string {
  const full = [input.first_name, input.last_name]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (full) return full;
  const local = String(input.email).split('@')[0]?.trim();
  return local || input.email;
}
