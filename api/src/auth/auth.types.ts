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
  picture?: string;
}

export interface JwtPayload {
  sub: number;
  email: string;
  area: BusinessArea;
  picture?: string;
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
