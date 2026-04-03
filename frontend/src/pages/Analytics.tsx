import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarSearch,
  LineChart,
  PieChart,
  TableProperties,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
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

function parseIsoDateAtUtc(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`);
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
    label: parseIsoDateAtUtc(row.month_start).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  }));
  const trendMax = trendRows.reduce((max, row) => Math.max(max, row.absolute_amount_minor), 0);
  const chartWidth = 760;
  const chartHeight = 260;
  const chartPadding = 28;
  const chartInnerWidth = chartWidth - chartPadding * 2;
  const chartInnerHeight = chartHeight - chartPadding * 2;
  const svgTrendPoints = trendRows.map((row, index) => {
    const x =
      trendRows.length <= 1
        ? chartWidth / 2
        : chartPadding + (index / (trendRows.length - 1)) * chartInnerWidth;
    const y =
      trendMax === 0
        ? chartHeight - chartPadding
        : chartHeight - chartPadding - (row.absolute_amount_minor / trendMax) * chartInnerHeight;

    return {
      ...row,
      x,
      y,
    };
  });
  const linePath = svgTrendPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath = svgTrendPoints.length === 0
    ? ''
    : `${linePath} L ${svgTrendPoints[svgTrendPoints.length - 1].x} ${chartHeight - chartPadding} L ${svgTrendPoints[0].x} ${chartHeight - chartPadding} Z`;
  const trendLatest = trendRows[trendRows.length - 1];
  const trendPrevious = trendRows[trendRows.length - 2];
  const rollingAverage =
    trendRows.length === 0
      ? 0
      : trendRows.reduce((sum, row) => sum + row.absolute_amount_minor, 0) / trendRows.length;
  const trendDelta =
    trendLatest && trendPrevious
      ? trendLatest.absolute_amount_minor - trendPrevious.absolute_amount_minor
      : null;
  const trendDeltaPercent =
    trendDelta !== null && trendPrevious && trendPrevious.absolute_amount_minor > 0
      ? (trendDelta / trendPrevious.absolute_amount_minor) * 100
      : null;
  const spotlightSpending = spendingRows.slice(0, 3);
  const spendingLeader = spotlightSpending[0];

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
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setDateFrom(daysAgoIsoDate(29));
                setDateTo(todayIsoDate());
              }}
            >
              30 days
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setDateFrom(daysAgoIsoDate(89));
                setDateTo(todayIsoDate());
              }}
            >
              90 days
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                const date = new Date();
                date.setFullYear(date.getFullYear() - 1);
                setDateFrom(date.toISOString().slice(0, 10));
                setDateTo(todayIsoDate());
              }}
            >
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

      <div className="spotlight-grid">
        <div className="card spotlight-card spend-lead">
          <div className="card-header compact">
            <TrendingDown size={18} />
            <h2>Top spending pressure</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="empty">Loading top category...</p>
            ) : spendingLeader ? (
              <div className="spotlight-body">
                <strong className="spotlight-title">{getCategoryLabel(spendingLeader.category_key)}</strong>
                <div className="spotlight-amount">
                  {formatAmount(Math.abs(spendingLeader.total_amount_minor), spendingLeader.currency)}
                </div>
                <p className="spotlight-copy">
                  {totalSpending === 0
                    ? 'No category share yet.'
                    : `${((Math.abs(spendingLeader.total_amount_minor) / totalSpending) * 100).toFixed(1)}% of all spending in the selected period.`}
                </p>
              </div>
            ) : (
              <p className="empty">No spending data for this period.</p>
            )}
          </div>
        </div>

        <div className="card spotlight-card trend-lead">
          <div className="card-header compact">
            <TrendingUp size={18} />
            <h2>Trend signal</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="empty">Calculating trend signal...</p>
            ) : trendRows.length < 2 ? (
              <p className="empty">Need at least two months to calculate a trend signal.</p>
            ) : (
              <div className="spotlight-body">
                <strong className="spotlight-title">{getCategoryLabel(selectedCategory)}</strong>
                <div className={`spotlight-amount ${trendDelta !== null && trendDelta > 0 ? 'negative' : 'positive'}`}>
                  {trendDelta === null
                    ? 'N/A'
                    : `${trendDelta > 0 ? '+' : ''}${formatAmount(trendDelta, trendLatest?.currency ?? 'EUR')}`}
                </div>
                <p className="spotlight-copy">
                  {trendDeltaPercent !== null
                    ? `${(trendDelta ?? 0) > 0 ? 'Up' : 'Down'} ${Math.abs(trendDeltaPercent).toFixed(1)}% versus previous month.`
                    : 'No reliable percentage yet for this category.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="card spotlight-card mix-lead">
          <div className="card-header compact">
            <PieChart size={18} />
            <h2>Category mix</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="empty">Loading mix...</p>
            ) : spotlightSpending.length === 0 ? (
              <p className="empty">No category mix available.</p>
            ) : (
              <div className="mix-list">
                {spotlightSpending.map((row, index) => {
                  const share = totalSpending === 0 ? 0 : (Math.abs(row.total_amount_minor) / totalSpending) * 100;

                  return (
                    <div key={`${row.category_key ?? 'uncategorized'}-${index}`} className="mix-item">
                      <div className="mix-rank">{index + 1}</div>
                      <div className="mix-copy">
                        <strong>{getCategoryLabel(row.category_key)}</strong>
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
                {spendingRows.map((row, index) => {
                  const share = totalSpending === 0 ? 0 : (Math.abs(row.total_amount_minor) / totalSpending) * 100;

                  return (
                    <div key={`spend-${row.category_key ?? 'uncategorized'}`} className="stack-item">
                      <div className="stack-row">
                        <span className="stack-label">
                          <span className="stack-rank">{index + 1}</span>
                          <span>{getCategoryLabel(row.category_key)}</span>
                        </span>
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
                {incomeRows.map((row, index) => {
                  const share = totalIncome === 0 ? 0 : (row.total_amount_minor / totalIncome) * 100;

                  return (
                    <div key={`income-${row.category_key ?? 'uncategorized'}`} className="stack-item">
                      <div className="stack-row">
                        <span className="stack-label">
                          <span className="stack-rank income-rank">{index + 1}</span>
                          <span>{getCategoryLabel(row.category_key)}</span>
                        </span>
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
          ) : trendRows.length < 2 ? (
            <p className="empty">Not enough monthly data to render a curve for this category.</p>
          ) : (
            <>
              <div className="trend-chart trend-line-chart">
                <svg
                  className="trend-svg"
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  role="img"
                  aria-label={`Monthly spending trend for ${getCategoryLabel(selectedCategory)}`}
                >
                  <defs>
                    <linearGradient id="analyticsTrendAreaGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#0f766e" stopOpacity="0.24" />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity="0.03" />
                    </linearGradient>
                    <linearGradient id="analyticsTrendLineGradient" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#14b8a6" />
                      <stop offset="100%" stopColor="#0f766e" />
                    </linearGradient>
                  </defs>
                  {[0, 1, 2, 3].map((index) => {
                    const y = chartPadding + (index / 3) * chartInnerHeight;
                    return (
                      <line
                        key={index}
                        x1={chartPadding}
                        x2={chartWidth - chartPadding}
                        y1={y}
                        y2={y}
                        className="trend-grid-line"
                      />
                    );
                  })}
                  <path d={areaPath} className="trend-area" />
                  <path d={linePath} className="trend-line" />
                  {svgTrendPoints.map((point) => (
                    <g key={`${point.month_start}-${point.category_key ?? 'uncategorized'}`}>
                      <circle cx={point.x} cy={point.y} r="5" className="trend-dot" />
                    </g>
                  ))}
                </svg>
                <div className="trend-axis">
                  {trendRows.map((row) => (
                    <div key={`${row.month_start}-${row.category_key ?? 'uncategorized'}`} className="trend-axis-item">
                      <span>{row.label}</span>
                      <strong>{formatAmount(row.absolute_amount_minor, row.currency)}</strong>
                    </div>
                  ))}
                </div>
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
        .spotlight-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
        .compact {
          padding-bottom: 0.85rem;
        }
        .spotlight-card .card-body {
          min-height: 168px;
        }
        .spend-lead {
          background:
            radial-gradient(circle at top left, rgba(239, 68, 68, 0.12), transparent 34%),
            var(--surface-color);
        }
        .trend-lead {
          background:
            radial-gradient(circle at top left, rgba(20, 184, 166, 0.14), transparent 34%),
            var(--surface-color);
        }
        .mix-lead {
          background:
            radial-gradient(circle at top left, rgba(59, 130, 246, 0.13), transparent 34%),
            var(--surface-color);
        }
        .spotlight-body {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .spotlight-title {
          font-size: 1rem;
        }
        .spotlight-amount {
          font-size: 1.7rem;
          line-height: 1;
          font-weight: 800;
        }
        .spotlight-copy {
          color: var(--text-muted);
          font-size: 0.9rem;
          line-height: 1.45;
        }
        .mix-list {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
        }
        .mix-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.85rem 0.9rem;
          border: 1px solid var(--border-color);
          border-radius: 0.9rem;
          background: var(--surface-muted);
        }
        .mix-rank {
          width: 2rem;
          height: 2rem;
          border-radius: 999px;
          background: var(--surface-accent);
          color: var(--primary-color);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
          font-weight: 700;
          flex: 0 0 auto;
        }
        .mix-copy {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          width: 100%;
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
          padding: 1rem;
          border-radius: 1rem;
          background:
            linear-gradient(180deg, color-mix(in srgb, #14b8a6 12%, transparent), transparent 45%),
            var(--surface-muted);
        }
        .trend-line-chart {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .trend-svg {
          width: 100%;
          height: auto;
        }
        .trend-grid-line {
          stroke: color-mix(in srgb, var(--text-muted) 18%, transparent);
          stroke-width: 1;
        }
        .trend-area {
          fill: url(#analyticsTrendAreaGradient);
        }
        .trend-line {
          fill: none;
          stroke: url(#analyticsTrendLineGradient);
          stroke-width: 4;
          stroke-linecap: round;
          stroke-linejoin: round;
          filter: drop-shadow(0 7px 18px rgba(15, 118, 110, 0.18));
        }
        .trend-dot {
          fill: var(--surface-color);
          stroke: #0f766e;
          stroke-width: 3;
        }
        .trend-axis {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
          gap: 0.75rem;
        }
        .trend-axis-item {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.8rem 0.9rem;
          border: 1px solid var(--border-color);
          border-radius: 0.9rem;
          background: var(--surface-color);
        }
        .trend-axis-item span {
          color: var(--text-muted);
          font-size: 0.75rem;
        }
        .trend-axis-item strong {
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
          padding: 0.85rem 0.95rem;
          border-radius: 0.95rem;
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
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
        .stack-label {
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          min-width: 0;
        }
        .stack-rank {
          width: 1.55rem;
          height: 1.55rem;
          border-radius: 999px;
          background: rgba(239, 68, 68, 0.12);
          color: var(--danger-text);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 700;
          flex: 0 0 auto;
        }
        .income-rank {
          background: rgba(34, 197, 94, 0.14);
          color: var(--success-text);
        }
        .bar-track {
          height: 0.65rem;
          border-radius: 999px;
          background: var(--surface-subtle);
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #f97316 0%, #dc2626 100%);
          border-radius: 999px;
        }
        .income-fill {
          background: linear-gradient(90deg, #4ade80 0%, #16a34a 100%);
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
          .spotlight-grid,
          .analytics-grid {
            grid-template-columns: 1fr;
          }
          .date-controls {
            grid-template-columns: 1fr 1fr;
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
          .stats-grid,
          .spotlight-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default Analytics;
