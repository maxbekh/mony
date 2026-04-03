import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Receipt, Tags, Upload, PieChart } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Transactions', path: '/transactions', icon: Receipt },
    { name: 'Categorize', path: '/categorize', icon: Tags },
    { name: 'Import', path: '/import', icon: Upload },
    { name: 'Analytics', path: '/analytics', icon: PieChart },
  ];
  const currentNavItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];

  return (
    <div className="layout">
      <header className="mobile-header">
        <div className="mobile-brand">
          <span className="mobile-logo">mony</span>
          <div className="mobile-header-copy">
            <strong>{currentNavItem.name}</strong>
            <span>Personal finance, optimized for mobile</span>
          </div>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">mony</h1>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            >
              <item.icon size={20} />
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <main className="main-content">{children}</main>

      <nav className="mobile-tabbar" aria-label="Primary">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`mobile-tab ${location.pathname === item.path ? 'active' : ''}`}
            aria-current={location.pathname === item.path ? 'page' : undefined}
          >
            <item.icon size={18} />
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
};
