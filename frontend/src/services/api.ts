import axios from 'axios';
import type {
  AuthEventListResponse,
  PasskeyAuthenticationStartResponse,
  PasskeyListResponse,
  PasskeyRegistrationStartResponse,
  AuthSessionViewResponse,
  AuthTokenPairResponse,
  BootstrapStatusResponse,
  Category,
  Transaction,
  TransactionListResponse,
  TransactionListParams,
  TransactionUpdateParams,
  ImportResponse,
  ImportBatchListResponse,
  DeleteImportResponse,
  SuggestionRequest,
  SuggestionResponse,
  AnalyticsQueryParams,
  AnalyticsResponse,
  MonthlyAnalyticsResponse,
  StatusPayload,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

const client = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let accessToken: string | null = null;

const readCookie = (name: string) => {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null;
};

const withCsrfHeader = () => {
  const csrfToken = readCookie('mony_csrf_token');
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {};
};

client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

export const authTokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
  },
  clear: () => {
    accessToken = null;
  },
};

export const api = {
  bootstrapStatus: async () => {
    const { data } = await client.get<BootstrapStatusResponse>('/v1/auth/bootstrap/status');
    return data;
  },

  bootstrap: async (username: string, password: string, deviceName: string) => {
    const { data } = await client.post<AuthTokenPairResponse>('/v1/auth/bootstrap', {
      username,
      password,
      device_name: deviceName,
    });
    return data;
  },

  login: async (username: string, password: string, deviceName: string) => {
    const { data } = await client.post<AuthTokenPairResponse>('/v1/auth/login', {
      username,
      password,
      device_name: deviceName,
    });
    return data;
  },

  refreshAuth: async () => {
    const { data } = await client.post<AuthTokenPairResponse>(
      '/v1/auth/refresh',
      {},
      {
        headers: withCsrfHeader(),
      },
    );
    return data;
  },

  logout: async () => {
    const { data } = await client.post<{ message: string }>(
      '/v1/auth/logout',
      {},
      {
        headers: withCsrfHeader(),
      },
    );
    return data;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data } = await client.post<{ message: string }>('/v1/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return data;
  },

  currentSession: async () => {
    const { data } = await client.get<AuthSessionViewResponse>('/v1/auth/session');
    return data;
  },

  listAuthEvents: async (limit = 20) => {
    const { data } = await client.get<AuthEventListResponse>('/v1/auth/events', {
      params: { limit },
    });
    return data;
  },

  listPasskeys: async () => {
    const { data } = await client.get<PasskeyListResponse>('/v1/auth/passkeys');
    return data;
  },

  startPasskeyRegistration: async (label: string) => {
    const { data } = await client.post<PasskeyRegistrationStartResponse>(
      '/v1/auth/passkeys/register/start',
      { label },
    );
    return data;
  },

  finishPasskeyRegistration: async (ceremonyId: string, credential: Record<string, unknown>) => {
    const { data } = await client.post('/v1/auth/passkeys/register/finish', {
      ceremony_id: ceremonyId,
      credential,
    });
    return data;
  },

  deletePasskey: async (id: string) => {
    const { data } = await client.delete<{ message: string }>(`/v1/auth/passkeys/${id}`);
    return data;
  },

  startPasskeyLogin: async (username: string | undefined, deviceName: string) => {
    const { data } = await client.post<PasskeyAuthenticationStartResponse>(
      '/v1/auth/passkeys/authenticate/start',
      {
        username,
        device_name: deviceName,
      },
    );
    return data;
  },

  finishPasskeyLogin: async (ceremonyId: string, credential: Record<string, unknown>) => {
    const { data } = await client.post<AuthTokenPairResponse>(
      '/v1/auth/passkeys/authenticate/finish',
      {
        ceremony_id: ceremonyId,
        credential,
      },
    );
    return data;
  },

  health: async () => {
    const { data } = await client.get<StatusPayload>('/health');
    return data;
  },

  ready: async () => {
    const { data } = await client.get<StatusPayload>('/ready');
    return data;
  },

  listTransactions: async (params: TransactionListParams = {}) => {
    const { data } = await client.get<TransactionListResponse>('/v1/transactions', { params });
    return data;
  },

  getTransaction: async (id: string) => {
    const { data } = await client.get<Transaction>(`/v1/transactions/${id}`);
    return data;
  },

  updateTransaction: async (id: string, params: TransactionUpdateParams) => {
    const { data } = await client.patch<Transaction>(`/v1/transactions/${id}`, params);
    return data;
  },

  getAnalyticsSpending: async (params: AnalyticsQueryParams = {}) => {
    const { data } = await client.get<AnalyticsResponse>('/v1/analytics/spending-by-category', {
      params,
    });
    return data;
  },

  getMonthlyAnalyticsSpending: async (params: AnalyticsQueryParams = {}) => {
    const { data } = await client.get<MonthlyAnalyticsResponse>(
      '/v1/analytics/spending-by-category-monthly',
      {
        params,
      },
    );
    return data;
  },

  getCategories: async () => {
    const { data } = await client.get<Category[]>('/v1/categories');
    return data;
  },

  importCsv: async (file: File, sourceName: string, sourceAccountRef: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_name', sourceName);
    formData.append('source_account_ref', sourceAccountRef);

    const { data } = await client.post<ImportResponse>('/v1/imports', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },

  listImports: async () => {
    const { data } = await client.get<ImportBatchListResponse>('/v1/imports');
    return data;
  },

  deleteImport: async (id: string) => {
    const { data } = await client.delete<DeleteImportResponse>(`/v1/imports/${id}`);
    return data;
  },

  suggestCategory: async (request: SuggestionRequest) => {
    const { data } = await client.post<SuggestionResponse>('/v1/assistant/suggest-category', request);
    return data;
  },

  getAiSettings: async () => {
    const { data } = await client.get<Record<string, any>>('/v1/user/ai-settings');
    return data;
  },

  updateAiSettings: async (settings: Record<string, any>) => {
    const { data } = await client.put<Record<string, any>>('/v1/user/ai-settings', settings);
    return data;
  },
};
