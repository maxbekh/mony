import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CalendarRange, PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { api } from '../services/api';
import type { AnalyticsQueryParams, SpendingByCategory } from '../types';

type PeriodKey = '30d' | '90d' | '12m' | 'all';

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string; description: string }> = [
  { key: '30d', label: '30 days', description: 'Recent monthly view' },
  { key: '90d', label: '90 days', description: 'Quarterly view' },
  { key: '12m', label: '12 months', description: 'Rolling year' },
  { key: 'all', label: 'All time', description: 'Full imported history' },
];

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

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildAnalyticsParams(period: PeriodKey): AnalyticsQueryParams {
  if (period === 'all') {
    return {};
  }

  const today = new Date();
  const start = new Date(today);

  if (period === '30d') {
    start.setDate(today.getDate() - 29);
  } else if (period === '90d') {
    start.setDate(today.getDate() - 89);
  } else {
    start.setFullYear(today.getFullYear() - 1);
    start.setDate(today.getDate() + 1);
  }

  return {
    date_from: formatDateInput(start),
    date_to: formatDateInput(today),
  };
}

const Dashboard: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [analytics, setAnalytics] = useState<SpendingByCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await api.getAnalyticsSpending(buildAnalyticsParams(period));
        setAnalytics(data.spending_by_category);
      } catch (fetchError) {
        setError(getErrorMessage(fetchError, 'Failed to fetch dashboard data.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  const totalSpending = analytics.reduce((accumulator, item) => {
    return item.total_amount_minor < 0
      ? accumulator + Math.abs(item.total_amount_minor)
      : accumulator;
  }, 0);

  const totalIncome = analytics.reduce((accumulator, item) => {
    return item.total_amount_minor > 0
      ? accumulator + item.total_amount_minor
      : accumulator;
  }, 0);

  const spendingCategories = analytics
    .filter((item) => item.total_amount_minor < 0)
    .sort((left, right) => left.total_amount_minor - right.total_amount_minor);

  const topCategories = spendingCategories.slice(0, 5);
  const uncategorizedSpending = spendingCategories
    .filter((item) => item.category_key === null)
    .reduce((accumulator, item) => accumulator + Math.abs(item.total_amount_minor), 0);

  const formatAmount = (amountMinor: number, currency = 'EUR') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="text-muted">Short-range overview of your financial activity.</p>
        </div>

        <div className="period-selector" aria-label="Select dashboard period">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`period-chip ${period === option.key ? 'active' : ''}`}
              onClick={() => setPeriod(option.key)}
              title={option.description}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="stats-grid">
        <div className="card stat-card income">
          <div className="stat-icon">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Income</span>
            <span className="stat-value">{formatAmount(totalIncome)}</span>
          </div>
        </div>
        <div className="card stat-card spending">
          <div className="stat-icon">
            <TrendingDown size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Spending</span>
            <span className="stat-value">{formatAmount(totalSpending)}</span>
          </div>
        </div>
        <div className="card stat-card balance">
          <div className="stat-icon">
            <Wallet size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Net</span>
            <span className="stat-value">{formatAmount(totalIncome - totalSpending)}</span>
          </div>
        </div>
        <div className="card stat-card context">
          <div className="stat-icon">
            <CalendarRange size={24} />
          </div>
          <div className="stat-content">
            <span className="stat-label">Window</span>
            <span className="stat-value stat-value-small">
              {PERIOD_OPTIONS.find((option) => option.key === period)?.label}
            </span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <PieChart size={20} />
            <h2>Top spending categories</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="text-center py-8">Loading dashboard...</p>
            ) : spendingCategories.length === 0 ? (
              <p className="text-center py-8">No spending data for this period.</p>
            ) : (
              <div className="category-list">
                {topCategories.map((item) => {
                  const percentage =
                    totalSpending === 0 ? 0 : (Math.abs(item.total_amount_minor) / totalSpending) * 100;

                  return (
                    <div key={item.category_key || 'other'} className="category-item">
                      <div className="category-info">
                        <span className="category-name">{item.category_key || 'Uncategorized'}</span>
                        <span className="category-amount">
                          {formatAmount(Math.abs(item.total_amount_minor), item.currency)}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${percentage}%` }} />
                      </div>
                      <div className="category-meta">
                        <span>{item.transaction_count} transactions</span>
                        <span>{percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card insight-card">
          <div className="card-header">
            <Wallet size={20} />
            <h2>Snapshot</h2>
          </div>
          <div className="card-body insight-body">
            {loading ? (
              <p className="text-center py-8">Calculating summary...</p>
            ) : (
              <>
                <div className="insight-row">
                  <span>Tracked categories</span>
                  <strong>{spendingCategories.length}</strong>
                </div>
                <div className="insight-row">
                  <span>Uncategorized spending</span>
                  <strong>{formatAmount(uncategorizedSpending)}</strong>
                </div>
                <div className="insight-row">
                  <span>Largest category share</span>
                  <strong>
                    {topCategories.length === 0 || totalSpending === 0
                      ? '0.0%'
                      : `${(
                          (Math.abs(topCategories[0].total_amount_minor) / totalSpending) *
                          100
                        ).toFixed(1)}%`}
                  </strong>
                </div>
                <div className="insight-row">
                  <span>Largest category</span>
                  <strong>{topCategories[0]?.category_key || 'None'}</strong>
                </div>
              </>
            )}
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
          align-items: flex-start;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .period-selector {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .period-chip {
          border: 1px solid var(--border-color);
          background: white;
          border-radius: 999px;
          padding: 0.55rem 0.9rem;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .period-chip.active {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: white;
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
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1.5rem;
        }
        .stat-card {
          padding: 1.5rem;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
        }
        .stat-icon {
          width: 3rem;
          height: 3rem;
          border-radius: 0.75rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .income .stat-icon { background: #f0fdf4; color: #166534; }
        .spending .stat-icon { background: #fef2f2; color: #991b1b; }
        .balance .stat-icon { background: #eff6ff; color: #1e40af; }
        .context .stat-icon { background: #f8fafc; color: #334155; }
        .stat-content {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .stat-label {
          font-size: 0.875rem;
          color: var(--text-muted);
          font-weight: 500;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-main);
        }
        .stat-value-small {
          font-size: 1.1rem;
        }
        .dashboard-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.9fr);
          gap: 1.5rem;
        }
        .card {
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
          overflow: hidden;
        }
        .card-header {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .card-header h2 {
          font-size: 1.125rem;
          font-weight: 600;
        }
        .card-body {
          padding: 1.5rem;
        }
        .category-list {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .category-item {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .category-info {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-weight: 600;
          font-size: 0.875rem;
        }
        .category-name,
        .category-amount {
          min-width: 0;
        }
        .progress-bar {
          height: 0.5rem;
          background: #f1f5f9;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: var(--primary-color);
          border-radius: 999px;
        }
        .category-meta {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--text-muted);
        }
        .insight-body {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .insight-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          padding-bottom: 0.875rem;
          border-bottom: 1px solid #eef2f7;
        }
        .insight-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .text-center { text-align: center; }
        .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
        .text-muted { color: var(--text-muted); }
        @media (max-width: 960px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
