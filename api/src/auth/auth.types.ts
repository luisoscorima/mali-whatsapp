import type { BusinessArea } from '../config/areas';

export interface AuthUser {
  id: number;
  email: string;
  area: BusinessArea;
  allowedAreas: BusinessArea[];
  isMaster: boolean;
  isProvisioned: boolean;
  isBootstrapAdmin: boolean;
  mustChangePassword: boolean;
  canEditAiPrompt: boolean;
  canViewAuditLogs: boolean;
  canViewIntegration: boolean;
  canEditBusinessHours: boolean;
  canViewReports: boolean;
  canAssignConversations: boolean;
  canManageAttributes: boolean;
  canManageSegments: boolean;
  canViewConversationStats: boolean;
  canViewCampaignStats: boolean;
  picture?: string;
  /** Id de login_logs de esta sesión (presencia “en línea”). */
  loginLogId?: number;
}

export interface JwtPayload {
  sub: number;
  email: string;
  area: BusinessArea;
  picture?: string;
  /** login_logs.id de la sesión actual. */
  lid?: number;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
