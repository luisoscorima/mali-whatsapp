import { clearToken, getToken, setToken } from './token';
import type {
  ApiResponse,
  AuthUser,
  HealthResult,
  LoginResult,
} from './types';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type RequestOptions = {
  method?: RequestMethod;
  body?: unknown;
  skipAuth?: boolean;
  /** 401 esperado (p. ej. comprobar sesión en login); no dispara logout global */
  sessionProbe?: boolean;
};

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

function notifyUnauthorized(): void {
  clearToken();
  unauthorizedHandler?.();
}

function parseErrorBody(
  body: unknown,
  fallback: string,
): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    // NestJS pone el detalle útil en `message`; `error` suele ser solo "Bad Request".
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (Array.isArray(record.message)) {
      return record.message.map(String).join(', ');
    }
    if (
      typeof record.error === 'string' &&
      record.error.trim() &&
      record.error !== 'Bad Request'
    ) {
      return record.error;
    }
  }
  return fallback;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: HeadersInit = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getToken();
  if (!options.skipAuth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body:
      options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (res.status === 401 && !options.skipAuth && !options.sessionProbe) {
    notifyUnauthorized();
    return { ok: false, error: 'No autenticado' };
  }

  if (res.status === 401 && options.sessionProbe) {
    return { ok: false, error: 'No autenticado' };
  }

  if (body && typeof body === 'object' && 'ok' in body) {
    const envelope = body as ApiResponse<T>;
    if (!envelope.ok) {
      return { ok: false, error: envelope.error || 'Error de solicitud' };
    }
    return envelope;
  }

  if (!res.ok) {
    return {
      ok: false,
      error: parseErrorBody(body, `Error ${res.status}`),
    };
  }

  return { ok: true, data: body as T };
}

export const apiClient = {
  async get<T>(path: string): Promise<ApiResponse<T>> {
    return request<T>(path);
  },

  async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return request<T>(path, { method: 'POST', body });
  },

  async patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return request<T>(path, { method: 'PATCH', body });
  },

  async postFormData<T>(path: string, formData: FormData): Promise<ApiResponse<T>> {
    const headers: HeadersInit = { Accept: 'application/json' };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, { method: 'POST', headers, credentials: 'include', body: formData });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (res.status === 401) {
      notifyUnauthorized();
      return { ok: false, error: 'No autenticado' };
    }

    if (body && typeof body === 'object' && 'ok' in body) {
      const envelope = body as ApiResponse<T>;
      if (!envelope.ok) {
        return { ok: false, error: envelope.error || 'Error de solicitud' };
      }
      return envelope;
    }

    if (res.status === 413) {
      return {
        ok: false,
        error:
          'Archivo demasiado grande (PDF hasta 25 MB). Si persiste, revisa el límite en Nginx Proxy Manager.',
      };
    }

    if (!res.ok) {
      return { ok: false, error: parseErrorBody(body, `Error ${res.status}`) };
    }

    return { ok: true, data: body as T };
  },

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return request<T>(path, { method: 'DELETE' });
  },

  async download(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const headers: HeadersInit = {};
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, { headers, credentials: 'include' });
    if (res.status === 401) {
      notifyUnauthorized();
      return { ok: false, error: 'No autenticado' };
    }
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text || `Error ${res.status}` };
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || 'descarga';

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  },

  getSession(): Promise<
    ApiResponse<{ authenticated: boolean; user?: AuthUser }>
  > {
    return request<{ authenticated: boolean; user?: AuthUser }>(
      '/api/auth/session',
      { skipAuth: true },
    );
  },

  getMe(options?: { sessionProbe?: boolean }): Promise<ApiResponse<AuthUser>> {
    return request<AuthUser>('/api/me', options);
  },

  getAuthConfig(): Promise<ApiResponse<{ googleEnabled: boolean }>> {
    return request<{ googleEnabled: boolean }>('/api/auth/config', {
      skipAuth: true,
    });
  },

  async login(
    email: string,
    password: string,
  ): Promise<ApiResponse<LoginResult>> {
    const result = await request<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });
    if (result.ok) {
      setToken(result.data.accessToken);
    }
    return result;
  },

  async changePassword(body: {
    current_password: string;
    new_password: string;
    confirm_password: string;
  }): Promise<ApiResponse<LoginResult>> {
    const result = await request<LoginResult>('/api/auth/change-password', {
      method: 'POST',
      body,
    });
    if (result.ok) {
      setToken(result.data.accessToken);
    }
    return result;
  },

  async logout(): Promise<void> {
    try {
      // Enviar Bearer/cookie para cerrar login_logs; sessionProbe evita loop en 401.
      await request<{ ok: true }>('/api/auth/logout', {
        method: 'POST',
        sessionProbe: true,
      });
    } catch {
      /* red de fondo: igual limpiamos cliente */
    }
    clearToken();
    unauthorizedHandler?.();
  },

  switchArea(area: string): Promise<ApiResponse<{ user: AuthUser }>> {
    return request<{ user: AuthUser }>('/api/account/switch-area', {
      method: 'POST',
      body: { area },
    });
  },

  async getHealth(): Promise<HealthResult> {
    const res = await fetch('/health');
    const body = (await res.json()) as HealthResult;
    return body;
  },
};

export type { ApiResponse, AuthUser, LoginResult, HealthResult };
