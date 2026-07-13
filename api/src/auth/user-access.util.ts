import { normalizeEmail } from '../config/areas';

export const BOOTSTRAP_ADMIN_DEFAULT_EMAIL = 'loscorima@mali.pe';

export function resolveBootstrapAdminEmail(
  configured: string | undefined,
): string {
  return normalizeEmail(configured || BOOTSTRAP_ADMIN_DEFAULT_EMAIL);
}

export function isBootstrapAdminEmail(
  configured: string | undefined,
  email: unknown,
): boolean {
  const bootstrap = resolveBootstrapAdminEmail(configured);
  return normalizeEmail(email) === bootstrap;
}

export function bootstrapAdminUserData() {
  return {
    is_master: true,
    is_provisioned: true,
    must_change_password: false,
    can_edit_ai_prompt: true,
    can_view_audit_logs: true,
    can_view_integration: true,
    can_edit_business_hours: true,
    can_view_reports: true,
    can_assign_conversations: true,
    can_manage_attributes: true,
    can_manage_segments: true,
    can_view_conversation_stats: true,
    can_view_campaign_stats: true,
    can_manage_anuncios: true,
  };
}

export function newGoogleUserData(passwordHash: string) {
  return {
    area: 'ti',
    password_hash: passwordHash,
    is_master: false,
    is_provisioned: false,
    must_change_password: false,
    can_edit_ai_prompt: false,
    can_view_audit_logs: false,
    can_view_integration: false,
    can_edit_business_hours: false,
    can_view_reports: false,
    can_assign_conversations: false,
    can_manage_attributes: false,
    can_manage_segments: false,
    can_view_conversation_stats: false,
    can_view_campaign_stats: false,
    can_manage_anuncios: false,
  };
}

export function parseGoogleProfileNames(profile: {
  displayName?: string;
  name?: { givenName?: string; familyName?: string };
  _json?: { given_name?: string; family_name?: string; name?: string };
}): { first_name: string | null; last_name: string | null } {
  let firstName =
    profile.name?.givenName ?? profile._json?.given_name ?? null;
  let lastName =
    profile.name?.familyName ?? profile._json?.family_name ?? null;
  if ((!firstName || !lastName) && profile.displayName?.trim()) {
    const parts = profile.displayName.trim().split(/\s+/).filter(Boolean);
    if (!firstName && parts[0]) firstName = parts[0];
    if (!lastName && parts.length > 1) lastName = parts.slice(1).join(' ');
  }
  return {
    first_name: firstName ? String(firstName).trim().slice(0, 80) : null,
    last_name: lastName ? String(lastName).trim().slice(0, 80) : null,
  };
}
