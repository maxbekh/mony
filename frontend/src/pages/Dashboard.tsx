import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  LineChart,
  PieChart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import type {
  AnalyticsQueryParams,
  Category,
  MonthlySpendingByCategory,
  SpendingByCategory,
} from '../types';

type PeriodKey = '30d' | '90d' | '12m' | 'all';

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string; description: string }> = [
  { key: '30d', label: '30 days', description: 'Recent monthly view' },
  { key: '90d', label: '90 days', description: 'Quarterly view' },
  { key: '12m', label: '12 months', description: 'Rolling year' },
  { key: 'all', label: 'All time', description: 'Full imported history' },
];

const FALLBACK_TREND_RANGE: AnalyticsQueryParams = {
  date_from: (() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 5);
    date.setDate(1);
    return formatDateInput(date);
  })(),
  date_to: formatDateInput(new Date()),
};

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

function parseIsoDateAtUtc(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`);
}

function shiftDateByDays(isoDate: string, days: number) {
  const date = parseIsoDateAtUtc(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateInput(date);
}

function calculateDaySpan(dateFrom: string, dateTo: string) {
  const from = parseIsoDateAtUtc(dateFrom);
  const to = parseIsoDateAtUtc(dateTo);
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / 86_400_000) + 1;
}

function buildPreviousAnalyticsParams(period: PeriodKey): AnalyticsQueryParams | null {
  const current = buildAnalyticsParams(period);
  if (!current.date_from || !current.date_to) {
    return null;
  }

  const daySpan = calculateDaySpan(current.date_from, current.date_to);
  return {
    date_from: shiftDateByDays(current.date_from, -daySpan),
    date_to: shiftDateByDays(current.date_to, -daySpan),
  };
}

function formatComparisonWindow(params: AnalyticsQueryParams | null) {
  if (!params?.date_from || !params?.date_to) {
    return 'No equivalent baseline';
  }

  const start = parseIsoDateAtUtc(params.date_from).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const end = parseIsoDateAtUtc(params.date_to).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return `${start} to ${end}`;
}

function sumSpending(items: SpendingByCategory[]) {
  return items.reduce((accumulator, item) => {
    return item.total_amount_minor < 0
      ? accumulator + Math.abs(item.total_amount_minor)
      : accumulator;
  }, 0);
}

function sumIncome(items: SpendingByCategory[]) {
  return items.reduce((accumulator, item) => {
    return item.total_amount_minor > 0
      ? accumulator + item.total_amount_minor
      : accumulator;
  }, 0);
}

function formatDeltaPercent(delta: number, baseline: number) {
  if (baseline <= 0) {
    return null;
  }

  return (delta / baseline) * 100;
}

const Dashboard: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [analytics, setAnalytics] = useState<SpendingByCategory[]>([]);
  const [previousAnalytics, setPreviousAnalytics] = useState<SpendingByCategory[]>([]);
  const [monthlyAnalytics, setMonthlyAnalytics] = useState<MonthlySpendingByCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedTrendCategory, setSelectedTrendCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const periodParams = buildAnalyticsParams(period);
        const previousPeriodParams = buildPreviousAnalyticsParams(period);
        const [data, previousData, monthlyData, categoryData] = await Promise.all([
          api.getAnalyticsSpending(periodParams),
          previousPeriodParams
            ? api.getAnalyticsSpending(previousPeriodParams)
            : Promise.resolve({ spending_by_category: [] }),
          api.getMonthlyAnalyticsSpending(periodParams.date_from ? periodParams : FALLBACK_TREND_RANGE),
          api.getCategories(),
        ]);
        setAnalytics(data.spending_by_category);
        setPreviousAnalytics(previousData.spending_by_category);
        setMonthlyAnalytics(monthlyData.monthly_spending_by_category);
        setCategories(categoryData);
      } catch (fetchError) {
        setError(getErrorMessage(fetchError, 'Failed to fetch dashboard data.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  const totalSpending = sumSpending(analytics);
  const totalIncome = sumIncome(analytics);
  const previousTotalSpending = sumSpending(previousAnalytics);
  const previousTotalIncome = sumIncome(previousAnalytics);
  const totalNet = totalIncome - totalSpending;
  const previousTotalNet = previousTotalIncome - previousTotalSpending;

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

  const categoryLabels = new Map(categories.map((category) => [category.key, category.label]));
  const getCategoryLabel = (categoryKey: string | null) =>
    categoryKey ? categoryLabels.get(categoryKey) ?? categoryKey : 'Uncategorized';

  useEffect(() => {
    if (spendingCategories.length === 0) {
      if (selectedTrendCategory !== null) {
        setSelectedTrendCategory(null);
      }
      return;
    }

    const hasSelection = spendingCategories.some((item) => item.category_key === selectedTrendCategory);
    if (!hasSelection) {
      setSelectedTrendCategory(spendingCategories[0].category_key);
    }
  }, [selectedTrendCategory, spendingCategories]);

  const selectedTrendSeries = monthlyAnalytics
    .filter((item) => item.total_amount_minor < 0 && item.category_key === selectedTrendCategory)
    .sort((left, right) => left.month_start.localeCompare(right.month_start));

  const trendPoints = selectedTrendSeries.map((item) => ({
    monthLabel: new Date(`${item.month_start}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    }),
    amountMinor: Math.abs(item.total_amount_minor),
    currency: item.currency,
  }));

  const trendMax = trendPoints.reduce((max, item) => Math.max(max, item.amountMinor), 0);
  const latestTrendPoint = trendPoints[trendPoints.length - 1];
  const previousTrendPoint = trendPoints[trendPoints.length - 2];
  const trendDeltaMinor =
    latestTrendPoint && previousTrendPoint
      ? latestTrendPoint.amountMinor - previousTrendPoint.amountMinor
      : null;
  const trendDeltaPercent =
    trendDeltaMinor !== null && previousTrendPoint && previousTrendPoint.amountMinor > 0
      ? (trendDeltaMinor / previousTrendPoint.amountMinor) * 100
      : null;
  const comparisonWindow = formatComparisonWindow(buildPreviousAnalyticsParams(period));

  const totalSpendingDelta = totalSpending - previousTotalSpending;
  const totalIncomeDelta = totalIncome - previousTotalIncome;
  const totalNetDelta = totalNet - previousTotalNet;
  const totalSpendingDeltaPercent = formatDeltaPercent(totalSpendingDelta, previousTotalSpending);
  const totalIncomeDeltaPercent = formatDeltaPercent(totalIncomeDelta, previousTotalIncome);
  const totalNetDeltaPercent = formatDeltaPercent(totalNetDelta, Math.abs(previousTotalNet));

  const previousSpendingByCategory = new Map(
    previousAnalytics
      .filter((item) => item.total_amount_minor < 0)
      .map((item) => [item.category_key ?? '__uncategorized__', Math.abs(item.total_amount_minor)]),
  );

  const spendingMovers = spendingCategories
    .map((item) => {
      const key = item.category_key ?? '__uncategorized__';
      const currentAmount = Math.abs(item.total_amount_minor);
      const previousAmount = previousSpendingByCategory.get(key) ?? 0;
      const deltaAmount = currentAmount - previousAmount;
      return {
        categoryKey: item.category_key,
        currentAmount,
        previousAmount,
        deltaAmount,
        deltaPercent: formatDeltaPercent(deltaAmount, previousAmount),
        currency: item.currency,
      };
    })
    .sort((left, right) => right.deltaAmount - left.deltaAmount);

  const topRisers = spendingMovers.filter((item) => item.deltaAmount > 0).slice(0, 3);
  const topImprovers = spendingMovers.filter((item) => item.deltaAmount < 0).slice(0, 3);

  const renderDelta = (deltaMinor: number, currency = 'EUR', percentage: number | null = null) => {
    const isPositive = deltaMinor > 0;
    const isNeutral = deltaMinor === 0;

    return (
      <span className={`delta-pill ${isNeutral ? 'flat' : isPositive ? 'up' : 'down'}`}>
        {isPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        <span>
          {`${isPositive ? '+' : ''}${formatAmount(deltaMinor, currency)}`}
          {percentage !== null ? ` (${isPositive ? '+' : ''}${percentage.toFixed(1)}%)` : ''}
        </span>
      </span>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="text-muted">Short-range overview of your financial activity.</p>
        </div>

        <div className="header-actions">
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
          <Link to="/analytics" className="analytics-link">
            Open analytics
          </Link>
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
            <span className="stat-value">{formatAmount(totalNet)}</span>
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
                        <span className="category-name">{getCategoryLabel(item.category_key)}</span>
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
                  <strong>{topCategories[0] ? getCategoryLabel(topCategories[0].category_key) : 'None'}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="comparison-grid">
        <div className="card comparison-card">
          <div className="card-header">
            <CalendarRange size={20} />
            <div className="trend-header-copy">
              <h2>Period comparison</h2>
              <p>Compare the current window with the previous equivalent period.</p>
            </div>
          </div>
          <div className="card-body comparison-body">
            <div className="comparison-window">
              <span>Baseline window</span>
              <strong>{comparisonWindow}</strong>
            </div>

            {loading ? (
              <p className="text-center py-8">Comparing periods...</p>
            ) : period === 'all' ? (
              <p className="text-center py-8">Comparison is disabled for all-time view.</p>
            ) : (
              <div className="comparison-metrics">
                <div className="comparison-metric">
                  <span className="metric-label">Spending</span>
                  <strong>{formatAmount(totalSpending)}</strong>
                  {renderDelta(totalSpendingDelta, 'EUR', totalSpendingDeltaPercent)}
                </div>
                <div className="comparison-metric">
                  <span className="metric-label">Income</span>
                  <strong>{formatAmount(totalIncome)}</strong>
                  {renderDelta(totalIncomeDelta, 'EUR', totalIncomeDeltaPercent)}
                </div>
                <div className="comparison-metric">
                  <span className="metric-label">Net</span>
                  <strong>{formatAmount(totalNet)}</strong>
                  {renderDelta(totalNetDelta, 'EUR', totalNetDeltaPercent)}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card movers-card">
          <div className="card-header">
            <TrendingUp size={20} />
            <div className="trend-header-copy">
              <h2>Smart movers</h2>
              <p>See which categories are accelerating or easing off versus the prior period.</p>
            </div>
          </div>
          <div className="card-body movers-body">
            {loading ? (
              <p className="text-center py-8">Analyzing category shifts...</p>
            ) : period === 'all' ? (
              <p className="text-center py-8">Switch to a finite period to see category deltas.</p>
            ) : spendingMovers.length === 0 ? (
              <p className="text-center py-8">No spending categories to compare.</p>
            ) : (
              <>
                <div className="movers-section">
                  <div className="movers-title-row">
                    <h3>Upward pressure</h3>
                    <span>Categories costing more now</span>
                  </div>
                  {topRisers.length === 0 ? (
                    <p className="text-muted">No category increases detected.</p>
                  ) : (
                    <div className="mover-list">
                      {topRisers.map((item) => (
                        <div key={`rise-${item.categoryKey ?? 'uncategorized'}`} className="mover-item rise">
                          <div>
                            <strong>{getCategoryLabel(item.categoryKey)}</strong>
                            <div className="mover-meta">
                              Now {formatAmount(item.currentAmount, item.currency)}
                              {' · '}
                              Before {formatAmount(item.previousAmount, item.currency)}
                            </div>
                          </div>
                          {renderDelta(item.deltaAmount, item.currency, item.deltaPercent)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="movers-section">
                  <div className="movers-title-row">
                    <h3>Improving categories</h3>
                    <span>Categories where spending is down</span>
                  </div>
                  {topImprovers.length === 0 ? (
                    <p className="text-muted">No spending reductions detected.</p>
                  ) : (
                    <div className="mover-list">
                      {topImprovers.map((item) => (
                        <div key={`down-${item.categoryKey ?? 'uncategorized'}`} className="mover-item calm">
                          <div>
                            <strong>{getCategoryLabel(item.categoryKey)}</strong>
                            <div className="mover-meta">
                              Now {formatAmount(item.currentAmount, item.currency)}
                              {' · '}
                              Before {formatAmount(item.previousAmount, item.currency)}
                            </div>
                          </div>
                          {renderDelta(item.deltaAmount, item.currency, item.deltaPercent)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card trend-card">
        <div className="card-header">
          <LineChart size={20} />
          <div className="trend-header-copy">
            <h2>Monthly category trend</h2>
            <p>Track a category over time to spot drift instead of only looking at one period total.</p>
          </div>
        </div>
        <div className="card-body trend-body">
          <div className="trend-toolbar">
            <label className="trend-label" htmlFor="dashboard-trend-category">
              Category
            </label>
            <select
              id="dashboard-trend-category"
              className="trend-select"
              value={selectedTrendCategory ?? ''}
              onChange={(event) => setSelectedTrendCategory(event.target.value || null)}
              disabled={loading || spendingCategories.length === 0}
            >
              {spendingCategories.length === 0 ? (
                <option value="">No spending categories</option>
              ) : (
                spendingCategories.slice(0, 8).map((item) => (
                  <option key={item.category_key ?? 'uncategorized'} value={item.category_key ?? ''}>
                    {getCategoryLabel(item.category_key)}
                  </option>
                ))
              )}
            </select>
          </div>

          {loading ? (
            <p className="text-center py-8">Loading trend...</p>
          ) : trendPoints.length === 0 ? (
            <p className="text-center py-8">Not enough monthly data for this category yet.</p>
          ) : (
            <>
              <div className="trend-chart" aria-label="Monthly spending chart">
                {trendPoints.map((point) => (
                  <div key={point.monthLabel} className="trend-column">
                    <div
                      className="trend-bar"
                      style={{
                        height: `${trendMax === 0 ? 0 : Math.max((point.amountMinor / trendMax) * 100, 8)}%`,
                      }}
                    />
                    <span className="trend-month">{point.monthLabel}</span>
                    <strong className="trend-amount">
                      {formatAmount(point.amountMinor, point.currency)}
                    </strong>
                  </div>
                ))}
              </div>

              <div className="trend-summary">
                <div className="trend-summary-item">
                  <span>Latest month</span>
                  <strong>
                    {latestTrendPoint
                      ? formatAmount(latestTrendPoint.amountMinor, latestTrendPoint.currency)
                      : 'N/A'}
                  </strong>
                </div>
                <div className="trend-summary-item">
                  <span>Previous month</span>
                  <strong>
                    {previousTrendPoint
                      ? formatAmount(previousTrendPoint.amountMinor, previousTrendPoint.currency)
                      : 'N/A'}
                  </strong>
                </div>
                <div className="trend-summary-item">
                  <span>Trend</span>
                  <strong className={trendDeltaMinor !== null && trendDeltaMinor > 0 ? 'trend-up' : 'trend-down'}>
                    {trendDeltaMinor === null
                      ? 'Need 2 months'
                      : `${trendDeltaMinor > 0 ? '+' : ''}${formatAmount(
                          trendDeltaMinor,
                          latestTrendPoint?.currency ?? 'EUR',
                        )}${trendDeltaPercent !== null ? ` (${trendDeltaPercent.toFixed(1)}%)` : ''}`}
                  </strong>
                </div>
              </div>
            </>
          )}
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
        .header-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .period-selector {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .period-chip {
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          border-radius: 999px;
          padding: 0.55rem 0.9rem;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .period-chip.active {
          background: var(--primary-color);
          border-color: var(--primary-color);
          color: var(--primary-contrast);
        }
        .analytics-link {
          display: inline-flex;
          align-items: center;
          min-height: 2.5rem;
          padding: 0 0.95rem;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          color: var(--text-main);
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 500;
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
          gap: 1.5rem;
        }
        .stat-card {
          padding: 1.5rem;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          background: var(--surface-color);
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
        .income .stat-icon { background: var(--success-surface); color: var(--success-text); }
        .spending .stat-icon { background: var(--danger-bg); color: var(--danger-text); }
        .balance .stat-icon { background: var(--surface-accent); color: var(--primary-color); }
        .context .stat-icon { background: var(--surface-muted); color: var(--text-main); }
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
        .comparison-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.2fr);
          gap: 1.5rem;
        }
        .trend-card {
          margin-top: 0;
        }
        .card {
          background: var(--surface-color);
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
        .trend-header-copy {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .trend-header-copy p {
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .comparison-body,
        .movers-body {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .comparison-window {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: baseline;
          padding: 1rem 1.1rem;
          border-radius: 1rem;
          background:
            radial-gradient(circle at top left, color-mix(in srgb, var(--primary-color) 16%, transparent), transparent 36%),
            var(--surface-muted);
          border: 1px solid var(--border-color);
        }
        .comparison-window span {
          color: var(--text-muted);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .comparison-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.9rem;
        }
        .comparison-metric {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          padding: 1rem;
          border-radius: 1rem;
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          box-shadow: inset 0 1px 0 color-mix(in srgb, white 12%, transparent);
        }
        .metric-label {
          color: var(--text-muted);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .delta-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          width: fit-content;
          padding: 0.45rem 0.7rem;
          border-radius: 999px;
          font-size: 0.78rem;
          font-weight: 600;
          border: 1px solid transparent;
        }
        .delta-pill.up {
          background: color-mix(in srgb, var(--danger-bg) 82%, white 18%);
          color: var(--danger-text);
          border-color: color-mix(in srgb, var(--danger-border) 72%, transparent);
        }
        .delta-pill.down {
          background: color-mix(in srgb, var(--success-surface) 84%, white 16%);
          color: var(--success-text);
          border-color: color-mix(in srgb, var(--success-text) 24%, transparent);
        }
        .delta-pill.flat {
          background: var(--surface-muted);
          color: var(--text-muted);
          border-color: var(--border-color);
        }
        .movers-section {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .movers-title-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: baseline;
          flex-wrap: wrap;
        }
        .movers-title-row h3 {
          font-size: 0.95rem;
        }
        .movers-title-row span,
        .mover-meta {
          color: var(--text-muted);
          font-size: 0.78rem;
        }
        .mover-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .mover-item {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: center;
          padding: 1rem;
          border-radius: 1rem;
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
        }
        .mover-item.rise {
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--danger-bg) 42%, transparent), transparent 50%),
            var(--surface-muted);
        }
        .mover-item.calm {
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--success-surface) 42%, transparent), transparent 50%),
            var(--surface-muted);
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
          background: var(--surface-hover);
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
          border-bottom: 1px solid var(--surface-subtle);
        }
        .insight-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .trend-body {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .trend-toolbar {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .trend-label {
          font-size: 0.875rem;
          color: var(--text-muted);
          font-weight: 600;
        }
        .trend-select {
          min-width: 220px;
          min-height: 2.75rem;
          padding: 0.7rem 0.85rem;
          border-radius: 0.75rem;
          border: 1px solid var(--border-color);
          background: var(--surface-color);
          color: var(--text-main);
        }
        .trend-chart {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
          gap: 0.85rem;
          align-items: end;
          min-height: 260px;
          padding: 1rem;
          border-radius: 1rem;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--primary-color) 8%, transparent), transparent 40%),
            var(--surface-muted);
        }
        .trend-column {
          display: flex;
          flex-direction: column;
          justify-content: end;
          align-items: stretch;
          gap: 0.5rem;
          min-height: 228px;
        }
        .trend-bar {
          min-height: 0;
          border-radius: 0.9rem 0.9rem 0.35rem 0.35rem;
          background: linear-gradient(180deg, #f97316 0%, #dc2626 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }
        .trend-month {
          color: var(--text-muted);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .trend-amount {
          font-size: 0.82rem;
          line-height: 1.2;
        }
        .trend-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.9rem;
        }
        .trend-summary-item {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 1rem;
          border-radius: 0.9rem;
          border: 1px solid var(--border-color);
          background: var(--surface-muted);
        }
        .trend-summary-item span {
          color: var(--text-muted);
          font-size: 0.8rem;
        }
        .trend-up {
          color: var(--danger-text);
        }
        .trend-down {
          color: var(--success-text);
        }
        .text-center { text-align: center; }
        .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
        .text-muted { color: var(--text-muted); }
        @media (max-width: 960px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
          .comparison-grid {
            grid-template-columns: 1fr;
          }
          .trend-chart {
            grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
          }
          .mover-item {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
