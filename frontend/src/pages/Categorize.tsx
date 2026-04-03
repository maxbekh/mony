import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Check, SkipForward, Tags } from 'lucide-react';
import { api } from '../services/api';
import type { Category, Transaction } from '../types';

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

const Categorize: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = async () => {
    setLoading(true);
    setError(null);

    try {
      const [categoryData, transactionData] = await Promise.all([
        api.getCategories(),
        api.listTransactions({
          limit: 20,
          offset: 0,
          uncategorized_only: true,
          sort_by: 'date',
          sort_direction: 'desc',
        }),
      ]);

      setCategories(categoryData);
      setQueue(transactionData.items);
      setIndex(0);
      setRemaining(transactionData.total_count);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to load categorization queue.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, []);

  const current = queue[index] ?? null;

  const goNext = async () => {
    if (index < queue.length - 1) {
      setIndex(index + 1);
      return;
    }

    await loadQueue();
  };

  const applyCategory = async (categoryKey: string | null) => {
    if (!current) {
      return;
    }

    const shouldReloadQueue = queue.length <= 1;

    setSavingKey(categoryKey ?? '__uncategorized__');
    setError(null);

    try {
      await api.updateTransaction(current.id, { category_key: categoryKey });

      if (shouldReloadQueue) {
        await loadQueue();
        return;
      }

      setQueue((previous) => previous.filter((transaction) => transaction.id !== current.id));
      setRemaining((previous) => Math.max(0, previous - 1));
      setIndex((previous) => Math.max(0, Math.min(previous, queue.length - 2)));
    } catch (saveError) {
      setError(getErrorMessage(saveError, 'Failed to update transaction category.'));
    } finally {
      setSavingKey(null);
    }
  };

  const formatAmount = (amountMinor: number, currency: string) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Categorize</h1>
          <p className="text-muted">
            Review the most recent uncategorized transactions one by one.
          </p>
        </div>
        <div className="queue-meta">
          <span>{remaining} remaining</span>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading queue...</div>
        ) : !current ? (
          <div className="empty-state">
            <Check size={20} />
            <span>No uncategorized transactions left in the current queue.</span>
          </div>
        ) : (
          <div className="categorize-layout">
            <div className="transaction-card">
              <div className="queue-progress">
                <span>Card {index + 1}</span>
                <span>{remaining} left</span>
              </div>
              <div className="transaction-header">
                <Tags size={20} />
                <span>Review transaction</span>
              </div>
              <div className="transaction-amount">
                {formatAmount(current.amount_minor, current.currency)}
              </div>
              <div className="transaction-description">{current.description}</div>
              {current.external_reference && (
                <div className="transaction-reference">{current.external_reference}</div>
              )}
              <div className="transaction-details">
                <div>
                  <span className="detail-label">Date</span>
                  <strong>{current.transaction_date}</strong>
                </div>
                <div>
                  <span className="detail-label">Source</span>
                  <strong>{current.source_name}</strong>
                </div>
                <div>
                  <span className="detail-label">Account</span>
                  <strong>{current.source_account_ref}</strong>
                </div>
              </div>
            </div>

            <div className="category-panel">
              <div className="panel-header">
                <div>
                  <h2>Assign a category</h2>
                  <p className="text-muted panel-copy">
                    Pick the best fit and move to the next card.
                  </p>
                </div>
                <button type="button" className="button secondary" onClick={() => void goNext()}>
                  <SkipForward size={16} />
                  Skip
                </button>
              </div>

              <div className="category-grid">
                {categories.map((category) => (
                  <button
                    key={category.key}
                    type="button"
                    className="category-button"
                    onClick={() => void applyCategory(category.key)}
                    disabled={savingKey !== null}
                  >
                    <span className="category-button-label">{category.label}</span>
                    <span className="category-button-key">{category.key}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
          gap: 1rem;
          flex-wrap: wrap;
        }
        .queue-meta {
          padding: 0.5rem 0.875rem;
          border-radius: 999px;
          background: white;
          border: 1px solid var(--border-color);
          font-size: 0.875rem;
          color: var(--text-muted);
        }
        .card {
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
          overflow: hidden;
        }
        .categorize-layout {
          display: grid;
          grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.2fr);
        }
        .transaction-card {
          padding: 1.5rem;
          border-right: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }
        .queue-progress {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          color: var(--text-muted);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .transaction-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .transaction-amount {
          font-size: 2rem;
          font-weight: 800;
        }
        .transaction-description {
          font-size: 1.125rem;
          font-weight: 600;
        }
        .transaction-reference {
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .transaction-details {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.75rem;
          padding-top: 0.5rem;
        }
        .detail-label {
          display: block;
          color: var(--text-muted);
          font-size: 0.75rem;
          text-transform: uppercase;
          margin-bottom: 0.125rem;
        }
        .category-panel {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
        .panel-copy {
          margin-top: 0.2rem;
        }
        .category-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.75rem;
        }
        .category-button {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.25rem;
          padding: 1rem;
          border-radius: 0.75rem;
          border: 1px solid var(--border-color);
          background: white;
          cursor: pointer;
          text-align: left;
        }
        .category-button:hover {
          border-color: var(--primary-color);
          background: #f8fbff;
        }
        .category-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .category-button-label {
          font-weight: 600;
        }
        .category-button-key {
          color: var(--text-muted);
          font-size: 0.75rem;
        }
        .button {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.55rem 0.95rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          border: 1px solid transparent;
          cursor: pointer;
        }
        .button.secondary {
          background: white;
          border-color: var(--border-color);
          color: var(--text-main);
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
        .empty-state {
          min-height: 18rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          color: var(--text-muted);
          padding: 2rem;
        }
        .text-muted { color: var(--text-muted); }
        @media (max-width: 960px) {
          .categorize-layout {
            grid-template-columns: 1fr;
          }
          .transaction-card {
            border-right: none;
            border-bottom: 1px solid var(--border-color);
          }
        }
        @media (max-width: 640px) {
          .page {
            gap: 1rem;
          }
          .page-header {
            align-items: stretch;
          }
          .queue-meta {
            width: 100%;
            display: flex;
            justify-content: center;
          }
          .transaction-card {
            padding: 1rem;
            gap: 0.85rem;
          }
          .transaction-amount {
            font-size: 2.3rem;
            line-height: 1;
          }
          .transaction-description {
            font-size: 1.2rem;
          }
          .transaction-details {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.6rem;
            padding-top: 0;
          }
          .transaction-details > div {
            padding: 0.7rem;
            border-radius: 0.8rem;
            background: white;
            border: 1px solid var(--border-color);
          }
          .category-panel {
            padding: 1rem;
            background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
          }
          .panel-header {
            flex-direction: column;
            align-items: stretch;
          }
          .panel-header .button {
            width: 100%;
            justify-content: center;
          }
          .category-grid {
            grid-template-columns: 1fr;
          }
          .category-button {
            min-height: 4.1rem;
            justify-content: center;
            gap: 0.2rem;
            border-radius: 1rem;
          }
          .category-button-label {
            font-size: 1rem;
          }
          .category-button-key {
            font-size: 0.7rem;
          }
        }
      `}</style>
    </div>
  );
};

export default Categorize;
