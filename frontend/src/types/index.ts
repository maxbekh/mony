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
  uncategorized_only?: boolean;
  sort_by?: 'date' | 'amount' | 'category' | 'description';
  sort_direction?: 'asc' | 'desc';
}

export interface TransactionUpdateParams {
  category_key?: string | null;
  description?: string;
  metadata?: Record<string, JsonValue> | null;
}

export interface ImportResponse {
  batch_id: string;
  row_count: number;
  inserted_transactions: number;
  skipped_duplicates: number;
  message: string;
}

export interface ImportBatch {
  id: string;
  source_name: string;
  source_account_ref: string;
  original_filename: string;
  status: string;
  row_count: number;
  imported_at: string;
  created_at: string;
  transaction_count: number;
}

export interface ImportBatchListResponse {
  items: ImportBatch[];
}

export interface DeleteImportResponse {
  batch_id: string;
  deleted_transactions: number;
  deleted_rows: number;
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

export interface AnalyticsQueryParams {
  date_from?: string;
  date_to?: string;
}

export interface AnalyticsResponse {
  spending_by_category: SpendingByCategory[];
}

export interface MonthlySpendingByCategory {
  month_start: string;
  category_key: string | null;
  total_amount_minor: number;
  currency: string;
  transaction_count: number;
}

export interface MonthlyAnalyticsResponse {
  monthly_spending_by_category: MonthlySpendingByCategory[];
}

export interface StatusPayload {
  service: string;
  status: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthSession {
  id: string;
  device_name: string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
  revoked_at: string | null;
}

export interface AuthTokenPairResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scopes: string[];
  user: AuthUser;
  session: AuthSession;
}

export interface BootstrapStatusResponse {
  bootstrap_required: boolean;
  refresh_cookie_name: string;
  csrf_cookie_name: string;
}

export interface AuthSessionViewResponse {
  user: AuthUser;
  scopes: string[];
  session_id: string;
}

export interface AuthEvent {
  id: string;
  user_id: string | null;
  session_id: string | null;
  event_type: string;
  ip_address: string | null;
  metadata: JsonValue;
  created_at: string;
}

export interface AuthEventListResponse {
  items: AuthEvent[];
}

export interface Passkey {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface PasskeyListResponse {
  items: Passkey[];
}

export interface PasskeyRegistrationStartResponse {
  ceremony_id: string;
  options: Record<string, unknown>;
}

export interface PasskeyAuthenticationStartResponse {
  ceremony_id: string;
  options: Record<string, unknown>;
}
