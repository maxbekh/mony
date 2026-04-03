import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowDownCircle, ArrowUpCircle, CalendarSearch, LineChart, PieChart, TableProperties } from 'lucide-react';
import { api } from '../services/api';
import type { Category, MonthlySpendingByCategory, SpendingByCategory } from '../types';

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const INITIAL_DATE_FROM = daysAgoIsoDate(89);
const INITIAL_DATE_TO = todayIsoDate();

const Analytics: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [analytics, setAnalytics] = useState<SpendingByCategory[]>([]);
  const [monthlyAnalytics, setMonthlyAnalytics] = useState<MonthlySpendingByCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(INITIAL_DATE_FROM);
  const [dateTo, setDateTo] = useState(INITIAL_DATE_TO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async (from: string, to: string) => {
    setLoading(true);
    setError(null);

    try {
      const [analyticsResponse, monthlyResponse, categoriesResponse] = await Promise.all([
        api.getAnalyticsSpending({
          date_from: from || undefined,
          date_to: to || undefined,
        }),
        api.getMonthlyAnalyticsSpending({
          date_from: from || undefined,
          date_to: to || undefined,
        }),
        api.getCategories(),
      ]);
      setAnalytics(analyticsResponse.spending_by_category);
      setMonthlyAnalytics(monthlyResponse.monthly_spending_by_category);
      setCategories(categoriesResponse);
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Failed to fetch analytics.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics(INITIAL_DATE_FROM, INITIAL_DATE_TO);
  }, []);

  const categoryLabels = useMemo(
    () => new Map(categories.map((category) => [category.key, category.label])),
    [categories],
  );

  const getCategoryLabel = (categoryKey: string | null) =>
    categoryKey ? categoryLabels.get(categoryKey) ?? categoryKey : 'Uncategorized';

  const spendingRows = analytics
    .filter((item) => item.total_amount_minor < 0)
    .sort((left, right) => left.total_amount_minor - right.total_amount_minor);
  const incomeRows = analytics
    .filter((item) => item.total_amount_minor > 0)
    .sort((left, right) => right.total_amount_minor - left.total_amount_minor);

  const totalSpending = spendingRows.reduce((sum, row) => sum + Math.abs(row.total_amount_minor), 0);
  const totalIncome = incomeRows.reduce((sum, row) => sum + row.total_amount_minor, 0);

  const formatAmount = (amountMinor: number, currency = 'EUR') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);

  useEffect(() => {
    if (spendingRows.length === 0) {
      if (selectedCategory !== null) {
        setSelectedCategory(null);
      }
      return;
    }

    const hasSelection = spendingRows.some((row) => row.category_key === selectedCategory);
    if (!hasSelection) {
      setSelectedCategory(spendingRows[0].category_key);
    }
  }, [selectedCategory, spendingRows]);

  const selectedTrendRows = monthlyAnalytics
    .filter((item) => item.total_amount_minor < 0 && item.category_key === selectedCategory)
    .sort((left, right) => left.month_start.localeCompare(right.month_start));

  const trendRows = selectedTrendRows.map((row) => ({
    ...row,
    absolute_amount_minor: Math.abs(row.total_amount_minor),
    label: new Date(`${row.month_start}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }));
  const trendMax = trendRows.reduce((max, row) => Math.max(max, row.absolute_amount_minor), 0);
  const trendLatest = trendRows[trendRows.length - 1];
  const trendPrevious = trendRows[trendRows.length - 2];
  const rollingAverage =
    trendRows.length === 0
      ? 0
      : trendRows.reduce((sum, row) => sum + row.absolute_amount_minor, 0) / trendRows.length;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadAnalytics(dateFrom, dateTo);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p className="text-muted">
            Explore category aggregates over a custom period, beyond the dashboard summary.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="toolbar-card">
        <div className="date-controls">
          <label className="control">
            <span className="control-label">
              <CalendarSearch size={14} />
              From
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="control-input"
            />
          </label>

          <label className="control">
            <span className="control-label">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="control-input"
            />
          </label>

          <div className="preset-group">
            <button type="button" className="button secondary" onClick={() => {
              setDateFrom(daysAgoIsoDate(29));
              setDateTo(todayIsoDate());
            }}>
              30 days
            </button>
            <button type="button" className="button secondary" onClick={() => {
              setDateFrom(daysAgoIsoDate(89));
              setDateTo(todayIsoDate());
            }}>
              90 days
            </button>
            <button type="button" className="button secondary" onClick={() => {
              const date = new Date();
              date.setFullYear(date.getFullYear() - 1);
              setDateFrom(date.toISOString().slice(0, 10));
              setDateTo(todayIsoDate());
            }}>
              12 months
            </button>
          </div>

          <button type="submit" className="button primary apply-button">
            Apply
          </button>
        </div>
      </form>

      {error && <div className="notice error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon spending">
            <ArrowDownCircle size={22} />
          </div>
          <div>
            <span className="stat-label">Spending categories</span>
            <strong className="stat-value">{spendingRows.length}</strong>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon income">
            <ArrowUpCircle size={22} />
          </div>
          <div>
            <span className="stat-label">Income categories</span>
            <strong className="stat-value">{incomeRows.length}</strong>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon total">
            <PieChart size={22} />
          </div>
          <div>
            <span className="stat-label">Total spending</span>
            <strong className="stat-value">{formatAmount(totalSpending)}</strong>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon total">
            <TableProperties size={22} />
          </div>
          <div>
            <span className="stat-label">Total income</span>
            <strong className="stat-value">{formatAmount(totalIncome)}</strong>
          </div>
        </div>
      </div>

      <div className="analytics-grid">
        <div className="card">
          <div className="card-header">
            <ArrowDownCircle size={18} />
            <h2>Spending breakdown</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="empty">Loading analytics...</p>
            ) : spendingRows.length === 0 ? (
              <p className="empty">No spending data for this period.</p>
            ) : (
              <div className="stack-list">
                {spendingRows.map((row) => {
                  const share = totalSpending === 0 ? 0 : (Math.abs(row.total_amount_minor) / totalSpending) * 100;

                  return (
                    <div key={`spend-${row.category_key ?? 'uncategorized'}`} className="stack-item">
                      <div className="stack-row">
                        <span>{getCategoryLabel(row.category_key)}</span>
                        <strong>{formatAmount(Math.abs(row.total_amount_minor), row.currency)}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${share}%` }} />
                      </div>
                      <div className="stack-meta">
                        <span>{row.transaction_count} transactions</span>
                        <span>{share.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <ArrowUpCircle size={18} />
            <h2>Income breakdown</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="empty">Loading analytics...</p>
            ) : incomeRows.length === 0 ? (
              <p className="empty">No income data for this period.</p>
            ) : (
              <div className="stack-list">
                {incomeRows.map((row) => {
                  const share = totalIncome === 0 ? 0 : (row.total_amount_minor / totalIncome) * 100;

                  return (
                    <div key={`income-${row.category_key ?? 'uncategorized'}`} className="stack-item">
                      <div className="stack-row">
                        <span>{getCategoryLabel(row.category_key)}</span>
                        <strong>{formatAmount(row.total_amount_minor, row.currency)}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill income-fill" style={{ width: `${share}%` }} />
                      </div>
                      <div className="stack-meta">
                        <span>{row.transaction_count} transactions</span>
                        <span>{share.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <LineChart size={18} />
          <h2>Monthly category trend</h2>
        </div>
        <div className="card-body trend-section">
          <div className="trend-toolbar">
            <label className="control trend-control">
              <span className="control-label">Category</span>
              <select
                value={selectedCategory ?? ''}
                onChange={(event) => setSelectedCategory(event.target.value || null)}
                className="control-input"
                disabled={loading || spendingRows.length === 0}
              >
                {spendingRows.length === 0 ? (
                  <option value="">No spending categories</option>
                ) : (
                  spendingRows.map((row) => (
                    <option key={row.category_key ?? 'uncategorized'} value={row.category_key ?? ''}>
                      {getCategoryLabel(row.category_key)}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          {loading ? (
            <p className="empty">Loading trend...</p>
          ) : trendRows.length === 0 ? (
            <p className="empty">No monthly trend is available for this category in the selected period.</p>
          ) : (
            <>
              <div className="trend-chart">
                {trendRows.map((row) => (
                  <div key={`${row.month_start}-${row.category_key ?? 'uncategorized'}`} className="trend-column">
                    <div
                      className="trend-bar"
                      style={{
                        height: `${trendMax === 0 ? 0 : Math.max((row.absolute_amount_minor / trendMax) * 100, 8)}%`,
                      }}
                    />
                    <strong>{formatAmount(row.absolute_amount_minor, row.currency)}</strong>
                    <span>{row.label}</span>
                  </div>
                ))}
              </div>

              <div className="trend-insights">
                <div className="trend-insight-card">
                  <span className="stat-label">Latest month</span>
                  <strong className="stat-value">
                    {trendLatest ? formatAmount(trendLatest.absolute_amount_minor, trendLatest.currency) : 'N/A'}
                  </strong>
                </div>
                <div className="trend-insight-card">
                  <span className="stat-label">Previous month</span>
                  <strong className="stat-value">
                    {trendPrevious ? formatAmount(trendPrevious.absolute_amount_minor, trendPrevious.currency) : 'N/A'}
                  </strong>
                </div>
                <div className="trend-insight-card">
                  <span className="stat-label">Rolling average</span>
                  <strong className="stat-value">
                    {formatAmount(Math.round(rollingAverage), trendLatest?.currency ?? trendPrevious?.currency ?? 'EUR')}
                  </strong>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card table-card">
        <div className="card-header">
          <TableProperties size={18} />
          <h2>Category table</h2>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Direction</th>
                <th>Transactions</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="empty">Loading analytics...</td>
                </tr>
              ) : analytics.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">No analytics data for this period.</td>
                </tr>
              ) : (
                analytics
                  .slice()
                  .sort((left, right) => Math.abs(right.total_amount_minor) - Math.abs(left.total_amount_minor))
                  .map((row) => (
                    <tr key={`${row.category_key ?? 'uncategorized'}-${row.total_amount_minor}-${row.transaction_count}`}>
                      <td>
                        <div className="table-category">{getCategoryLabel(row.category_key)}</div>
                        {row.category_key && <div className="table-key">{row.category_key}</div>}
                      </td>
                      <td>{row.total_amount_minor < 0 ? 'Spending' : 'Income'}</td>
                      <td>{row.transaction_count}</td>
                      <td className={`text-right ${row.total_amount_minor < 0 ? 'negative' : 'positive'}`}>
                        {formatAmount(Math.abs(row.total_amount_minor), row.currency)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-analytics-list">
          {loading ? (
            <div className="empty">Loading analytics...</div>
          ) : analytics.length === 0 ? (
            <div className="empty">No analytics data for this period.</div>
          ) : (
            analytics
              .slice()
              .sort((left, right) => Math.abs(right.total_amount_minor) - Math.abs(left.total_amount_minor))
              .map((row) => (
                <article
                  key={`mobile-${row.category_key ?? 'uncategorized'}-${row.total_amount_minor}-${row.transaction_count}`}
                  className="mobile-analytics-card"
                >
                  <div className="mobile-analytics-top">
                    <div>
                      <div className="table-category">{getCategoryLabel(row.category_key)}</div>
                      {row.category_key && <div className="table-key">{row.category_key}</div>}
                    </div>
                    <strong className={row.total_amount_minor < 0 ? 'negative' : 'positive'}>
                      {formatAmount(Math.abs(row.total_amount_minor), row.currency)}
                    </strong>
                  </div>
                  <div className="mobile-analytics-meta">
                    <span>{row.total_amount_minor < 0 ? 'Spending' : 'Income'}</span>
                    <span>{row.transaction_count} transactions</span>
                  </div>
                </article>
              ))
          )}
        </div>
      </div>

      <style>{`
        .page {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .toolbar-card,
        .card {
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
        }
        .toolbar-card {
          padding: 1rem;
        }
        .date-controls {
          display: grid;
          grid-template-columns: minmax(0, 180px) minmax(0, 180px) 1fr auto;
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
        .control-input {
          min-height: 2.75rem;
          border: 1px solid var(--border-color);
          border-radius: 0.5rem;
          padding: 0.75rem;
          font-size: 0.875rem;
          background: var(--surface-color);
          color: var(--text-main);
        }
        .preset-group {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 2.75rem;
          padding: 0.55rem 0.95rem;
          border-radius: 0.5rem;
          font-weight: 500;
          font-size: 0.875rem;
          border: 1px solid transparent;
          cursor: pointer;
        }
        .button.primary {
          background: var(--primary-color);
          color: var(--primary-contrast);
        }
        .button.secondary {
          background: var(--surface-color);
          color: var(--text-main);
          border-color: var(--border-color);
        }
        .apply-button {
          min-width: 6rem;
        }
        .table-card {
          overflow: hidden;
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
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1rem;
        }
        .stat-card {
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
          padding: 1.25rem;
          display: flex;
          align-items: center;
          gap: 0.875rem;
        }
        .stat-icon {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 0.75rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .stat-icon.spending { background: var(--danger-bg); color: var(--danger-text); }
        .stat-icon.income { background: var(--success-surface); color: var(--success-text); }
        .stat-icon.total { background: var(--surface-accent); color: var(--primary-color); }
        .stat-label {
          display: block;
          color: var(--text-muted);
          font-size: 0.75rem;
          text-transform: uppercase;
        }
        .stat-value {
          font-size: 1.25rem;
        }
        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
        }
        .trend-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .trend-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .trend-control {
          min-width: min(100%, 280px);
        }
        .trend-chart {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
          gap: 0.85rem;
          align-items: end;
          min-height: 280px;
          padding: 1rem;
          border-radius: 1rem;
          background:
            linear-gradient(180deg, color-mix(in srgb, #f97316 10%, transparent), transparent 45%),
            var(--surface-muted);
        }
        .trend-column {
          min-height: 240px;
          display: flex;
          flex-direction: column;
          justify-content: end;
          gap: 0.4rem;
        }
        .trend-bar {
          border-radius: 0.9rem 0.9rem 0.35rem 0.35rem;
          background: linear-gradient(180deg, #fb923c 0%, #ea580c 55%, #dc2626 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }
        .trend-column span {
          color: var(--text-muted);
          font-size: 0.75rem;
        }
        .trend-column strong {
          font-size: 0.84rem;
        }
        .trend-insights {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.75rem;
        }
        .trend-insight-card {
          background: var(--surface-muted);
          border: 1px solid var(--border-color);
          border-radius: 0.9rem;
          padding: 1rem;
        }
        .card-header {
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .card-body {
          padding: 1.25rem;
        }
        .stack-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .stack-item {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .stack-row,
        .stack-meta {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
        }
        .stack-meta {
          color: var(--text-muted);
          font-size: 0.75rem;
        }
        .bar-track {
          height: 0.5rem;
          border-radius: 999px;
          background: var(--surface-subtle);
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: #ef4444;
          border-radius: 999px;
        }
        .income-fill {
          background: #22c55e;
        }
        .table-scroll {
          overflow-x: auto;
        }
        .mobile-analytics-list {
          display: none;
          padding: 1rem;
          gap: 0.75rem;
        }
        .mobile-analytics-card {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          padding: 0.95rem 1rem;
          border: 1px solid var(--border-color);
          border-radius: 0.9rem;
          background: var(--surface-muted);
        }
        .mobile-analytics-top,
        .mobile-analytics-meta {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
        }
        .mobile-analytics-meta {
          color: var(--text-muted);
          font-size: 0.8rem;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
        }
        .table th,
        .table td {
          padding: 0.9rem 1.25rem;
          border-bottom: 1px solid var(--border-color);
          text-align: left;
          vertical-align: top;
        }
        .table th {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--text-muted);
          background: var(--surface-muted);
        }
        .table-category {
          font-weight: 600;
        }
        .table-key {
          margin-top: 0.25rem;
          color: var(--text-muted);
          font-size: 0.75rem;
        }
        .text-right {
          text-align: right;
        }
        .positive { color: var(--success-text); }
        .negative { color: var(--danger-text); }
        .empty {
          color: var(--text-muted);
          text-align: center;
          padding: 1.5rem;
        }
        .text-muted {
          color: var(--text-muted);
        }
        @media (max-width: 980px) {
          .analytics-grid {
            grid-template-columns: 1fr;
          }
          .date-controls {
            grid-template-columns: 1fr 1fr;
          }
          .trend-chart {
            grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
          }
        }
        @media (max-width: 720px) {
          .date-controls {
            grid-template-columns: 1fr;
          }
          .preset-group {
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 0.2rem;
          }
          .button.secondary {
            white-space: nowrap;
          }
          .table-scroll {
            display: none;
          }
          .mobile-analytics-list {
            display: grid;
          }
          .stats-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default Analytics;
