import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Pencil,
  Search,
  Tags,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { formatCurrency } from '../utils/currency';
import type { Category, Transaction, TransactionListParams } from '../types';

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (typeof payload === 'string' && payload.trim() !== '') {
      return payload;
    }
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editCategoryKey, setEditCategoryKey] = useState('');
  const [inlineCategoryTransactionId, setInlineCategoryTransactionId] = useState<string | null>(
    null,
  );
  const [inlineSavingTransactionId, setInlineSavingTransactionId] = useState<string | null>(null);
  const [inlineCategoryError, setInlineCategoryError] = useState<string | null>(null);
  const [params, setParams] = useState<TransactionListParams>({
    limit: 20,
    offset: 0,
    search: '',
    category_key: '',
    uncategorized_only: false,
    sort_by: 'date',
    sort_direction: 'desc',
  });
  const currentLimit = params.limit ?? 20;
  const currentOffset = params.offset ?? 0;

  const categoryLabels = useMemo(
    () =>
      new Map(categories.map((category) => [category.key, category.label])),
    [categories],
  );

  const getCategoryLabel = (categoryKey: string | null) => {
    if (!categoryKey) {
      return 'Uncategorized';
    }

    return categoryLabels.get(categoryKey) ?? categoryKey;
  };

  const transactionMatchesActiveFilters = (transaction: Transaction) => {
    if (params.uncategorized_only) {
      return transaction.category_key === null;
    }

    if (params.category_key && transaction.category_key !== params.category_key) {
      return false;
    }

    return true;
  };

  const applyTransactionUpdate = (updated: Transaction) => {
    if (!transactionMatchesActiveFilters(updated)) {
      setTransactions((current) => current.filter((transaction) => transaction.id !== updated.id));
      setTotalCount((current) => Math.max(0, current - 1));
      return;
    }

    setTransactions((current) =>
      current.map((transaction) => (transaction.id === updated.id ? updated : transaction)),
    );
  };

  const loadTransactions = async (requestParams: TransactionListParams) => {
    setLoading(true);
    setPageError(null);

    try {
      const response = await api.listTransactions(requestParams);
      setTransactions(response.items);
      setTotalCount(response.total_count);
    } catch (error) {
      setPageError(getErrorMessage(error, 'Failed to fetch transactions.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const response = await api.getCategories();
        setCategories(response);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      }
    })();
  }, []);

  useEffect(() => {
    void loadTransactions({
      limit: currentLimit,
      offset: currentOffset,
      search: params.search,
      category_key: params.category_key,
      uncategorized_only: params.uncategorized_only,
      sort_by: params.sort_by,
      sort_direction: params.sort_direction,
    });
  }, [
    currentOffset,
    currentLimit,
    params.search,
    params.category_key,
    params.uncategorized_only,
    params.sort_by,
    params.sort_direction,
  ]);

  const openEditor = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditDescription(transaction.description);
    setEditCategoryKey(transaction.category_key ?? '');
    setEditError(null);
  };

  const closeEditor = () => {
    setEditingTransaction(null);
    setEditDescription('');
    setEditCategoryKey('');
    setEditError(null);
  };

  const openInlineCategoryEditor = (transactionId: string) => {
    setInlineCategoryError(null);
    setInlineCategoryTransactionId(transactionId);
  };

  const closeInlineCategoryEditor = () => {
    setInlineCategoryTransactionId(null);
    setInlineCategoryError(null);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParams({ ...params, search: e.target.value, offset: 0 });
  };

  const handleCategoryFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setParams({
      ...params,
      category_key: e.target.value,
      uncategorized_only: false,
      offset: 0,
    });
  };

  const handleUncategorizedToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setParams({
      ...params,
      uncategorized_only: checked,
      category_key: checked ? '' : params.category_key,
      offset: 0,
    });
  };

  const handleSortByChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setParams({ ...params, sort_by: e.target.value as TransactionListParams['sort_by'], offset: 0 });
  };

  const handleSortDirectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setParams({
      ...params,
      sort_direction: e.target.value as TransactionListParams['sort_direction'],
      offset: 0,
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadTransactions(params);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingTransaction) {
      return;
    }

    setSaving(true);
    setEditError(null);

    try {
      const updated = await api.updateTransaction(editingTransaction.id, {
        description: editDescription,
        category_key: editCategoryKey || null,
      });

      applyTransactionUpdate(updated);
      closeEditor();
    } catch (error) {
      setEditError(getErrorMessage(error, 'Failed to update transaction.'));
    } finally {
      setSaving(false);
    }
  };

  const updateInlineCategory = async (transaction: Transaction, categoryKey: string | null) => {
    setInlineSavingTransactionId(transaction.id);
    setInlineCategoryError(null);

    try {
      const updated = await api.updateTransaction(transaction.id, { category_key: categoryKey });
      applyTransactionUpdate(updated);
      closeInlineCategoryEditor();
    } catch (error) {
      setInlineCategoryError(getErrorMessage(error, 'Failed to update transaction category.'));
    } finally {
      setInlineSavingTransactionId(null);
    }
  };

  const renderCategoryControl = (transaction: Transaction) => {
    if (inlineCategoryTransactionId === transaction.id) {
      return (
        <div className="inline-category-editor">
          <div className="inline-category-header">
            <span className="text-xs text-muted">Choose a category</span>
            <button
              type="button"
              className="inline-close-button"
              onClick={closeInlineCategoryEditor}
              aria-label="Close category editor"
            >
              <X size={14} />
            </button>
          </div>
          <select
            value={transaction.category_key ?? ''}
            onChange={(e) => void updateInlineCategory(transaction, e.target.value || null)}
            className="inline-category-select"
            disabled={inlineSavingTransactionId === transaction.id}
            autoFocus
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>
          <div className="inline-category-actions">
            <button
              type="button"
              className="inline-link-button"
              onClick={() => void updateInlineCategory(transaction, null)}
              disabled={
                inlineSavingTransactionId === transaction.id || transaction.category_key === null
              }
            >
              Clear
            </button>
            {inlineSavingTransactionId === transaction.id ? (
              <span className="text-xs text-muted">Saving...</span>
            ) : (
              <span className="text-xs text-muted inline-save-hint">
                <Check size={12} />
                Save on select
              </span>
            )}
          </div>
          {inlineCategoryError && <div className="text-xs inline-error">{inlineCategoryError}</div>}
        </div>
      );
    }

    return (
      <>
        <button
          type="button"
          className={`badge category-trigger ${transaction.category_key ? 'category' : 'uncategorized'}`}
          onClick={() => openInlineCategoryEditor(transaction.id)}
          aria-label={`Change category for ${transaction.description}`}
        >
          <span>{getCategoryLabel(transaction.category_key)}</span>
          <ChevronDown size={14} />
        </button>
        {transaction.category_key && (
          <div className="text-muted text-xs category-key">{transaction.category_key}</div>
        )}
      </>
    );
  };

  const formatAmount = formatCurrency;

  const nextPage = () => {
    if (currentOffset + currentLimit < totalCount) {
      setParams({ ...params, offset: currentOffset + currentLimit });
    }
  };

  const prevPage = () => {
    if (currentOffset > 0) {
      setParams({ ...params, offset: Math.max(0, currentOffset - currentLimit) });
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="text-muted">Search, sort, review, and categorize transactions.</p>
        </div>
        <Link to="/categorize" className="button primary quick-link">
          <Tags size={16} />
          Quick categorize
        </Link>
      </div>

      <form onSubmit={handleSearchSubmit} className="toolbar-card">
        <div className="search-form">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search description..."
            value={params.search}
            onChange={handleSearchChange}
            className="search-input"
          />
          <button type="submit" className="button primary search-submit">
            Search
          </button>
        </div>

        <div className="filter-grid">
          <label className="control">
            <span className="control-label">
              <Filter size={14} />
              Category
            </span>
            <select
              value={params.category_key ?? ''}
              onChange={handleCategoryFilterChange}
              className="control-input"
              disabled={params.uncategorized_only}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>

          <label className="control">
            <span className="control-label">Sort by</span>
            <select
              value={params.sort_by ?? 'date'}
              onChange={handleSortByChange}
              className="control-input"
            >
              <option value="date">Date</option>
              <option value="amount">Amount</option>
              <option value="category">Category</option>
              <option value="description">Description</option>
            </select>
          </label>

          <label className="control">
            <span className="control-label">Direction</span>
            <select
              value={params.sort_direction ?? 'desc'}
              onChange={handleSortDirectionChange}
              className="control-input"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>

          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={params.uncategorized_only ?? false}
              onChange={handleUncategorizedToggle}
            />
            <span>Only uncategorized</span>
          </label>
        </div>
      </form>

      {pageError && <div className="notice error">{pageError}</div>}

      <div className="card table-shell">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Source</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  Loading transactions...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8">
                  No transactions found.
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.transaction_date}</td>
                  <td>
                    <div className="transaction-description">{transaction.description}</div>
                    {transaction.external_reference && (
                      <div className="text-muted text-xs">{transaction.external_reference}</div>
                    )}
                  </td>
                  <td className="category-cell">
                    {renderCategoryControl(transaction)}
                  </td>
                  <td>
                    <div className="text-sm">{transaction.source_name}</div>
                    <div className="text-muted text-xs">{transaction.source_account_ref}</div>
                  </td>
                  <td
                    className={`text-right font-medium ${
                      transaction.amount_minor < 0 ? 'amount-negative' : 'amount-positive'
                    }`}
                  >
                    {formatAmount(transaction.amount_minor, transaction.currency)}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => openEditor(transaction)}
                      aria-label={`Edit transaction ${transaction.description}`}
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-transaction-list">
        {loading ? (
          <div className="mobile-empty card">Loading transactions...</div>
        ) : transactions.length === 0 ? (
          <div className="mobile-empty card">No transactions found.</div>
        ) : (
          transactions.map((transaction) => (
            <article key={transaction.id} className="mobile-transaction-card">
              <div className="mobile-transaction-top">
                <div>
                  <div className="mobile-transaction-date">{transaction.transaction_date}</div>
                  <div className="transaction-description">{transaction.description}</div>
                </div>
                <div
                  className={`mobile-amount ${
                    transaction.amount_minor < 0 ? 'amount-negative' : 'amount-positive'
                  }`}
                >
                  {formatAmount(transaction.amount_minor, transaction.currency)}
                </div>
              </div>
              {transaction.external_reference && (
                <div className="text-muted text-xs">{transaction.external_reference}</div>
              )}
              <div className="mobile-source-card">
                <span>{transaction.source_name}</span>
                <span className="text-muted">{transaction.source_account_ref}</span>
              </div>
              <div className="mobile-category-block">{renderCategoryControl(transaction)}</div>
              <div className="mobile-card-actions">
                <button
                  type="button"
                  className="button secondary mobile-edit-button"
                  onClick={() => openEditor(transaction)}
                >
                  <Pencil size={16} />
                  Edit details
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="pagination">
        <div className="text-sm text-muted">
          Showing {totalCount === 0 ? 0 : currentOffset + 1} to{' '}
          {Math.min(currentOffset + currentLimit, totalCount)} of {totalCount} transactions
        </div>
        <div className="pagination-controls">
          <button
            onClick={prevPage}
            disabled={currentOffset === 0 || loading}
            className="icon-button"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={nextPage}
            disabled={currentOffset + currentLimit >= totalCount || loading}
            className="icon-button"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {editingTransaction && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Edit transaction</h2>
                <p className="text-muted">Update the working description and manual category.</p>
              </div>
              <button type="button" className="icon-button" onClick={closeEditor}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="edit-form">
              <div className="form-group">
                <label htmlFor="edit-description">Description</label>
                <input
                  id="edit-description"
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="form-input"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-category">Category</label>
                <select
                  id="edit-category"
                  value={editCategoryKey}
                  onChange={(e) => setEditCategoryKey(e.target.value)}
                  className="form-input"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.key} value={category.key}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="summary-grid">
                <div>
                  <span className="summary-label">Date</span>
                  <strong>{editingTransaction.transaction_date}</strong>
                </div>
                <div>
                  <span className="summary-label">Amount</span>
                  <strong>
                    {formatAmount(editingTransaction.amount_minor, editingTransaction.currency)}
                  </strong>
                </div>
                <div>
                  <span className="summary-label">Source</span>
                  <strong>{editingTransaction.source_name}</strong>
                </div>
                <div>
                  <span className="summary-label">Account</span>
                  <strong>{editingTransaction.source_account_ref}</strong>
                </div>
              </div>

              {editError && <div className="notice error">{editError}</div>}

              <div className="modal-actions">
                <button type="button" className="button secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="submit" className="button primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .page {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .toolbar-card {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          background:
            var(--surface-reflection),
            var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
          padding: 1rem;
        }
        .search-form {
          display: flex;
          align-items: center;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          padding-left: 0.75rem;
          gap: 0.5rem;
          min-height: 2.75rem;
          overflow: hidden;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .search-form:focus-within {
          border-color: color-mix(in srgb, var(--primary-color) 35%, var(--border-color));
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 14%, transparent);
        }
        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .search-input {
          border: none;
          padding: 0;
          outline: none;
          font-size: 0.875rem;
          width: 100%;
          align-self: stretch;
          min-width: 0;
          background: transparent;
          color: var(--text-main);
          appearance: none;
          -webkit-appearance: none;
          box-shadow: none;
        }
        .search-input::placeholder {
          color: var(--text-muted);
        }
        .filter-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.75rem;
          align-items: end;
        }
        .control {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .control-label {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .control-input,
        .form-input {
          width: 100%;
          min-height: 2.75rem;
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          padding: 0.75rem;
          font-size: 0.875rem;
          background: var(--surface-color);
          color: var(--text-main);
        }
        select.control-input,
        select.form-input,
        .inline-category-select {
          padding-right: 2.4rem;
        }
        .checkbox-control {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          min-height: 2.75rem;
          padding: 0 0.25rem;
          font-size: 0.875rem;
        }
        .card {
          background:
            var(--surface-reflection),
            var(--surface-color);
          border-radius: 0.75rem;
          border: 1px solid var(--border-color);
          overflow: hidden;
        }
        .table-shell {
          display: block;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .table th {
          padding: 0.75rem 1.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-muted);
          background: var(--surface-muted);
          border-bottom: 1px solid var(--border-color);
        }
        .table td {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--border-color);
          vertical-align: top;
        }
        .table tr:last-child td {
          border-bottom: none;
        }
        .transaction-description {
          font-weight: 500;
          color: var(--text-main);
        }
        .category-cell {
          min-width: 170px;
        }
        .category-key {
          margin-top: 0.3rem;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.2rem 0.65rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .category-trigger {
          width: auto;
          max-width: 100%;
          gap: 0.35rem;
          border: none;
          cursor: pointer;
          transition: transform 120ms ease, box-shadow 120ms ease;
        }
        .category-trigger:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.12);
        }
        .badge.category { background: var(--surface-accent-strong); color: var(--primary-color); }
        .badge.uncategorized { background: var(--surface-hover); color: var(--text-muted); }
        .inline-category-editor {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          width: 100%;
          max-width: 13.5rem;
          padding: 0.7rem 0.85rem 0.7rem 0.7rem;
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
          background:
            var(--surface-reflection),
            var(--surface-muted);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }
        .inline-category-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .inline-close-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.75rem;
          height: 1.75rem;
          border: none;
          border-radius: 999px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
        }
        .inline-close-button:hover {
          background: rgba(148, 163, 184, 0.14);
          color: var(--text-main);
        }
        .inline-category-select {
          width: 100%;
          min-height: 2.35rem;
          border: 1px solid var(--border-color);
          border-radius: 0.6rem;
          padding: 0.55rem 2.4rem 0.55rem 0.7rem;
          background: var(--surface-color);
          color: var(--text-main);
          font: inherit;
        }
        .inline-category-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          min-height: 1.25rem;
        }
        .inline-link-button {
          border: none;
          background: transparent;
          color: var(--text-muted);
          padding: 0;
          font: inherit;
          cursor: pointer;
        }
        .inline-link-button:hover {
          color: var(--text-main);
        }
        .inline-link-button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .inline-save-hint {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
        }
        .inline-error {
          color: var(--danger-text);
        }
        .mobile-transaction-list {
          display: none;
          flex-direction: column;
          gap: 0.9rem;
        }
        .mobile-transaction-card {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
          background:
            var(--surface-reflection),
            var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 1rem;
          padding: 1rem;
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.05);
        }
        .mobile-transaction-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
        }
        .mobile-transaction-date {
          font-size: 0.76rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          margin-bottom: 0.3rem;
        }
        .mobile-amount {
          font-size: 1rem;
          font-weight: 700;
          text-align: right;
          flex-shrink: 0;
        }
        .mobile-source-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.8rem;
          padding: 0.7rem 0.8rem;
          border-radius: 0.85rem;
          background:
            var(--surface-reflection),
            var(--surface-muted);
          font-size: 0.82rem;
        }
        .mobile-category-block {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .mobile-card-actions {
          display: flex;
          justify-content: flex-end;
        }
        .mobile-edit-button {
          width: 100%;
        }
        .mobile-empty {
          padding: 1.5rem;
          text-align: center;
          color: var(--text-muted);
        }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
        .font-medium { font-weight: 500; }
        .text-sm { font-size: 0.875rem; }
        .text-xs { font-size: 0.75rem; }
        .text-muted { color: var(--text-muted); }
        .amount-negative { color: var(--negative-color); }
        .amount-positive { color: var(--positive-color); }
        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.55rem 0.95rem;
          border-radius: 0.5rem;
          font-weight: 500;
          font-size: 0.875rem;
          cursor: pointer;
          border: 1px solid transparent;
          text-decoration: none;
        }
        .button.primary {
          background: var(--primary-color);
          color: var(--primary-contrast);
        }
        .button.primary:hover {
          background: var(--primary-hover);
        }
        .button.secondary {
          background: var(--surface-color);
          border-color: var(--border-color);
          color: var(--text-main);
        }
        .search-submit {
          align-self: stretch;
          border-radius: 0;
          min-height: 2.75rem;
          padding-left: 1rem;
          padding-right: 1rem;
          border-top: none;
          border-right: none;
          border-bottom: none;
          border-left: 1px solid var(--border-color);
          box-shadow: none;
          flex-shrink: 0;
        }
        .quick-link {
          flex-shrink: 0;
        }
        .button:disabled,
        .icon-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          cursor: pointer;
        }
        .pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          background: var(--surface-muted);
        }
        .pagination-controls {
          display: flex;
          gap: 0.5rem;
        }
        .notice {
          padding: 0.875rem 1rem;
          border-radius: 0.75rem;
          border: 1px solid;
        }
        .notice.error {
          background: var(--danger-bg);
          border-color: var(--danger-border);
          color: var(--danger-text);
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: var(--overlay-color);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          z-index: 20;
        }
        .modal-card {
          width: min(100%, 36rem);
          background: var(--surface-color);
          border-radius: 1rem;
          border: 1px solid var(--border-color);
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.16);
          padding: 1.5rem;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        .edit-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
          padding: 1rem;
          border-radius: 0.75rem;
          background: var(--surface-muted);
        }
        .summary-grid > div {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .summary-label {
          color: var(--text-muted);
          font-size: 0.75rem;
          text-transform: uppercase;
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
        }
        @media (max-width: 1080px) {
          .filter-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 900px) {
          .table th:nth-child(4),
          .table td:nth-child(4) {
            display: none;
          }
        }
        @media (max-width: 640px) {
          .filter-grid {
            grid-template-columns: 1fr;
          }
          .table-shell {
            display: none;
          }
          .mobile-transaction-list {
            display: flex;
          }
          .page-header {
            align-items: stretch;
          }
          .quick-link {
            width: 100%;
          }
          .mobile-transaction-top {
            flex-direction: column;
          }
          .mobile-amount {
            text-align: left;
          }
          .mobile-source-card {
            flex-direction: column;
            align-items: flex-start;
          }
          .category-cell,
          .inline-category-editor {
            max-width: none;
          }
          .summary-grid {
            grid-template-columns: 1fr;
          }
          .modal-actions {
            flex-direction: column-reverse;
          }
        }
      `}</style>
    </div>
  );
};

export default Transactions;
