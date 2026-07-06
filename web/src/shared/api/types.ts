export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type AuthUser = {
  id: number;
  email: string;
  area: string;
  allowedAreas: string[];
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
};

export type LoginResult = {
  accessToken: string;
  user: AuthUser;
};

export type HealthResult = {
  ok: boolean;
  db?: string;
  error?: string;
};
