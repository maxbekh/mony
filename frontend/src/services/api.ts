import axios from 'axios';
import type {
  Category,
  Transaction,
  TransactionListResponse,
  TransactionListParams,
  TransactionUpdateParams,
  ImportResponse,
  AnalyticsResponse,
  StatusPayload,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = {
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

  getAnalyticsSpending: async () => {
    const { data } = await client.get<AnalyticsResponse>('/v1/analytics/spending-by-category');
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
};
