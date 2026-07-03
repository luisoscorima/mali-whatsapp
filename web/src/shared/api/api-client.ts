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
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
    if (Array.isArray(record.message)) {
      return record.message.map(String).join(', ');
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

  if (res.status === 401 && !options.skipAuth) {
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

  if (!res.ok) {
    return {
      ok: false,
      error: parseErrorBody(body, `Error ${res.status}`),
    };
  }

  return { ok: true, data: body as T };
}

export const apiClient = {
  getMe(): Promise<ApiResponse<AuthUser>> {
    return request<AuthUser>('/api/me');
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

  logout(): void {
    clearToken();
    unauthorizedHandler?.();
  },

  async getHealth(): Promise<HealthResult> {
    const res = await fetch('/health');
    const body = (await res.json()) as HealthResult;
    return body;
  },
};

export type { ApiResponse, AuthUser, LoginResult, HealthResult };
