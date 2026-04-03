import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { SpendingByCategory } from '../types';
import { PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react';

const Dashboard: React.FC = () => {
  const [analytics, setAnalytics] = useState<SpendingByCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const data = await api.getAnalyticsSpending();
        setAnalytics(data.spending_by_category);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  const totalSpending = analytics.reduce((acc, curr) => {
    return curr.total_amount_minor < 0 ? acc + Math.abs(curr.total_amount_minor) : acc;
  }, 0);

  const totalIncome = analytics.reduce((acc, curr) => {
    return curr.total_amount_minor > 0 ? acc + curr.total_amount_minor : acc;
  }, 0);

  const formatAmount = (amount_minor: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount_minor / 100);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="text-muted">Overview of your financial activity.</p>
      </div>

      <div className="stats-grid">
        <div className="card stat-card income">
          <div className="stat-icon"><TrendingUp size={24} /></div>
          <div className="stat-content">
            <span className="stat-label">Total Income</span>
            <span className="stat-value">{formatAmount(totalIncome)}</span>
          </div>
        </div>
        <div className="card stat-card spending">
          <div className="stat-icon"><TrendingDown size={24} /></div>
          <div className="stat-content">
            <span className="stat-label">Total Spending</span>
            <span className="stat-value">{formatAmount(totalSpending)}</span>
          </div>
        </div>
        <div className="card stat-card balance">
          <div className="stat-icon"><Wallet size={24} /></div>
          <div className="stat-content">
            <span className="stat-label">Net Balance</span>
            <span className="stat-value">{formatAmount(totalIncome - totalSpending)}</span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <PieChart size={20} />
            <h2>Spending by Category</h2>
          </div>
          <div className="card-body">
            {loading ? (
              <p className="text-center py-8">Loading analytics...</p>
            ) : analytics.length === 0 ? (
              <p className="text-center py-8">No data available. Try importing some transactions.</p>
            ) : (
              <div className="category-list">
                {analytics
                  .filter(a => a.total_amount_minor < 0)
                  .sort((a, b) => a.total_amount_minor - b.total_amount_minor)
                  .map((item) => {
                    const percentage = (Math.abs(item.total_amount_minor) / totalSpending) * 100;
                    return (
                      <div key={item.category_key || 'other'} className="category-item">
                        <div className="category-info">
                          <span className="category-name">{item.category_key || 'Uncategorized'}</span>
                          <span className="category-amount">{formatAmount(Math.abs(item.total_amount_minor))}</span>
                        </div>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${percentage}%` }}
                          ></div>
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
      </div>

      <style>{`
        .page {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1.5rem;
        }
        .stat-card {
          padding: 1.5rem;
          display: flex;
          align-items: center;
          gap: 1.25rem;
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
        .stat-content {
          display: flex;
          flex-direction: column;
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
        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
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
          font-weight: 600;
          font-size: 0.875rem;
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
      `}</style>
    </div>
  );
};

export default Dashboard;
