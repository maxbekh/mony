import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Transaction, TransactionListParams } from '../types';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

const Transactions: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [params, setParams] = useState<TransactionListParams>({
    limit: 20,
    offset: 0,
    search: '',
  });
  const currentLimit = params.limit ?? 20;
  const currentOffset = params.offset ?? 0;

  useEffect(() => {
    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const response = await api.listTransactions({
          limit: currentLimit,
          offset: currentOffset,
        });
        setTransactions(response.items);
        setTotalCount(response.total_count);
      } catch (error) {
        console.error('Failed to fetch transactions:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchTransactions();
  }, [currentOffset, currentLimit]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setParams({ ...params, search: e.target.value, offset: 0 });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void (async () => {
      setLoading(true);
      try {
        const response = await api.listTransactions(params);
        setTransactions(response.items);
        setTotalCount(response.total_count);
      } catch (error) {
        console.error('Failed to fetch transactions:', error);
      } finally {
        setLoading(false);
      }
    })();
  };

  const formatAmount = (amount_minor: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount_minor / 100);
  };

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
            <button type="submit" className="button primary">Search</button>
          </form>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Source</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-8">Loading transactions...</td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8">No transactions found.</td>
              </tr>
            ) : (
              transactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.transaction_date}</td>
                  <td>
                    <div className="transaction-description">{t.description}</div>
                    {t.external_reference && (
                      <div className="text-muted text-xs">{t.external_reference}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${t.category_key ? 'category' : 'uncategorized'}`}>
                      {t.category_key || 'Uncategorized'}
                    </span>
                  </td>
                  <td>
                    <div className="text-sm">{t.source_name}</div>
                    <div className="text-muted text-xs">{t.source_account_ref}</div>
                  </td>
                  <td className={`text-right font-medium ${t.amount_minor < 0 ? 'amount-negative' : 'amount-positive'}`}>
                    {formatAmount(t.amount_minor, t.currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="pagination">
          <div className="text-sm text-muted">
            Showing {currentOffset + 1} to {Math.min(currentOffset + currentLimit, totalCount)} of {totalCount} transactions
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
        .pagination-controls button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

export default Transactions;
