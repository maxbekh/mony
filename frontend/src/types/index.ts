export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface Transaction {
  id: string;
  import_batch_id: string;
  source_name: string;
  source_account_ref: string;
  external_reference: string | null;
  transaction_date: string; // ISO date string (YYYY-MM-DD)
  amount_minor: number;
  currency: string;
  description: string;
  category_key: string | null;
  metadata: Record<string, JsonValue>;
  created_at: string; // ISO datetime string
}

export interface TransactionListResponse {
  items: Transaction[];
  limit: number;
  offset: number;
  returned: number;
  total_count: number;
}

export interface TransactionListParams {
  limit?: number;
  offset?: number;
  source_name?: string;
  source_account_ref?: string;
  category_key?: string;
  date_from?: string;
  date_to?: string;
  amount_min?: number;
  amount_max?: number;
  currency?: string;
  search?: string;
}

export interface TransactionUpdateParams {
  category_key?: string | null;
  metadata?: Record<string, JsonValue> | null;
}

export interface ImportResponse {
  batch_id: string;
  row_count: number;
  inserted_transactions: number;
  skipped_duplicates: number;
  message: string;
}

export interface Category {
  key: string;
  label: string;
}

export interface SpendingByCategory {
  category_key: string | null;
  total_amount_minor: number;
  currency: string;
  transaction_count: number;
}

export interface AnalyticsResponse {
  spending_by_category: SpendingByCategory[];
}

export interface StatusPayload {
  service: string;
  status: string;
}
