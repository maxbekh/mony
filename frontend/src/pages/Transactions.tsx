import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Pencil, Search, X } from 'lucide-react';
import { api } from '../services/api';
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
  const [params, setParams] = useState<TransactionListParams>({
    limit: 20,
    offset: 0,
    search: '',
  });
  const currentLimit = params.limit ?? 20;
  const currentOffset = params.offset ?? 0;

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
    void loadTransactions({
      limit: currentLimit,
      offset: currentOffset,
    });
  }, [currentOffset, currentLimit]);

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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParams({ ...params, search: e.target.value, offset: 0 });
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

      setTransactions((current) =>
        current.map((transaction) =>
          transaction.id === updated.id ? updated : transaction,
        ),
      );
      closeEditor();
    } catch (error) {
      setEditError(getErrorMessage(error, 'Failed to update transaction.'));
    } finally {
      setSaving(false);
    }
  };

  const formatAmount = (amountMinor: number, currency: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);

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
        <h1>Transactions</h1>
        <div className="page-actions">
          <form onSubmit={handleSearchSubmit} className="search-form">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search description..."
              value={params.search}
              onChange={handleSearchChange}
              className="search-input"
            />
            <button type="submit" className="button primary">
              Search
            </button>
          </form>
        </div>
      </div>

      {pageError && <div className="notice error">{pageError}</div>}

      <div className="card">
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
                  <td>
                    <span
                      className={`badge ${transaction.category_key ? 'category' : 'uncategorized'}`}
                    >
                      {transaction.category_key || 'Uncategorized'}
                    </span>
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
      </div>

      {editingTransaction && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Edit transaction</h2>
                <p className="text-muted">
                  Update the working description and manual category.
                </p>
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
                      {category.label} ({category.key})
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
          gap: 2rem;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .page-actions {
          display: flex;
          gap: 1rem;
        }
        .search-form {
          display: flex;
          align-items: center;
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          padding: 0 0.75rem;
          gap: 0.5rem;
        }
        .search-icon {
          color: var(--text-muted);
        }
        .search-input {
          border: none;
          padding: 0.625rem 0;
          outline: none;
          font-size: 0.875rem;
          width: 200px;
        }
        .card {
          background: white;
          border-radius: 0.75rem;
          border: 1px solid var(--border-color);
          overflow: hidden;
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
          background: #f8fafc;
          border-bottom: 1px solid var(--border-color);
        }
        .table td {
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--border-color);
          vertical-align: middle;
        }
        .table tr:last-child td {
          border-bottom: none;
        }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
        .font-medium { font-weight: 500; }
        .text-sm { font-size: 0.875rem; }
        .text-xs { font-size: 0.75rem; }
        .text-muted { color: var(--text-muted); }
        .transaction-description { font-weight: 500; color: var(--text-main); }
        .amount-negative { color: #ef4444; }
        .amount-positive { color: #10b981; }
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 0.125rem 0.625rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
        }
        .badge.category { background: #dbeafe; color: #1e40af; }
        .badge.uncategorized { background: #f1f5f9; color: #475569; }
        .button {
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          font-weight: 500;
          font-size: 0.875rem;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .button.primary {
          background: var(--primary-color);
          color: white;
        }
        .button.primary:hover {
          background: var(--primary-hover);
        }
        .button.secondary {
          background: white;
          border-color: var(--border-color);
          color: var(--text-main);
        }
        .button:disabled, .icon-button:disabled {
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
          background: white;
          cursor: pointer;
        }
        .pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          background: #f8fafc;
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
          background: #fef2f2;
          border-color: #fca5a5;
          color: #991b1b;
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          z-index: 20;
        }
        .modal-card {
          width: min(100%, 36rem);
          background: white;
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
        .form-group label {
          font-size: 0.875rem;
          font-weight: 600;
        }
        .form-input {
          width: 100%;
          padding: 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border-color);
          font-size: 0.875rem;
          outline: none;
        }
        .form-input:focus {
          border-color: var(--primary-color);
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
          padding: 1rem;
          border-radius: 0.75rem;
          background: #f8fafc;
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
        @media (max-width: 900px) {
          .table th:nth-child(4),
          .table td:nth-child(4) {
            display: none;
          }
        }
        @media (max-width: 640px) {
          .search-form {
            width: 100%;
          }
          .search-input {
            width: 100%;
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
