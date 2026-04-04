import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Ellipsis,
  KeyRound,
  LayoutDashboard,
  PieChart,
  Receipt,
  Tags,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/useAuth';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileChromeHidden, setIsMobileChromeHidden] = React.useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const lastScrollYRef = React.useRef(0);
  const appVersionLabel = `${__APP_VERSION__} (${__APP_BUILD__})`;

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, mobilePriority: true },
    { name: 'Transactions', path: '/transactions', icon: Receipt, mobilePriority: true },
    { name: 'Categorize', path: '/categorize', icon: Tags, mobilePriority: true },
    { name: 'Import', path: '/import', icon: Upload, mobilePriority: false },
    { name: 'Analytics', path: '/analytics', icon: PieChart, mobilePriority: true },
    { name: 'Settings', path: '/settings', icon: KeyRound, mobilePriority: false },
  ];
  const mobilePrimaryNavItems = navItems.filter((item) => item.mobilePriority);
  const mobileSecondaryNavItems = navItems.filter((item) => !item.mobilePriority);
  const currentNavItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];
  const isCurrentItemInMoreMenu = mobileSecondaryNavItems.some((item) => item.path === location.pathname);

  React.useEffect(() => {
    document.title = `mony - ${currentNavItem.name}`;
  }, [currentNavItem.name]);

  React.useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  React.useEffect(() => {
    const handleScroll = () => {
      if (window.innerWidth > 768) {
        setIsMobileChromeHidden(false);
        return;
      }

      const currentScrollY = window.scrollY;
      const previousScrollY = lastScrollYRef.current;
      const isScrollingDown = currentScrollY > previousScrollY;
      const passedThreshold = currentScrollY > 24;
      const scrollDelta = Math.abs(currentScrollY - previousScrollY);

      if (scrollDelta < 8) {
        return;
      }

      setIsMobileChromeHidden(isScrollingDown && passedThreshold);
      lastScrollYRef.current = currentScrollY;
    };

    const handleResize = () => {
      if (window.innerWidth > 768) {
        setIsMobileChromeHidden(false);
      }
    };

    lastScrollYRef.current = window.scrollY;
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    let frameId = 0;

    const writePointer = (clientX: number, clientY: number) => {
      root.style.setProperty('--pointer-x', `${clientX}px`);
      root.style.setProperty('--pointer-y', `${clientY}px`);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        writePointer(event.clientX, event.clientY);
      });
    };

    const handlePointerLeave = () => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      writePointer(centerX, centerY);
    };

    handlePointerLeave();
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  return (
    <div className="layout">
      <header className={`mobile-header ${isMobileChromeHidden ? 'hidden' : ''}`}>
        <div className="mobile-brand">
          <span className="mobile-logo">mony</span>
          <div className="mobile-header-copy">
            <strong>{currentNavItem.name}</strong>
            <span>{appVersionLabel}</span>
          </div>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <h1 className="logo">mony</h1>
            <p className="sidebar-user">{user?.username}</p>
            <p className="sidebar-version">{appVersionLabel}</p>
          </div>
          <button className="sidebar-logout" onClick={() => void logout()} type="button">
            Sign out
          </button>
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

      {isMobileMenuOpen ? (
        <button
          type="button"
          className="mobile-menu-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      ) : null}

      <div
        id="mobile-navigation-more"
        className={`mobile-menu-sheet ${isMobileMenuOpen ? 'open' : ''}`}
        aria-hidden={!isMobileMenuOpen}
      >
        <div className="mobile-menu-sheet-header">
          <div>
            <strong>More</strong>
            <span>Secondary navigation and account actions</span>
          </div>
          <button
            type="button"
            className="mobile-menu-close"
            aria-label="Close navigation menu"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="mobile-menu-list" aria-label="More">
          {mobileSecondaryNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`mobile-menu-item ${location.pathname === item.path ? 'active' : ''}`}
              aria-current={location.pathname === item.path ? 'page' : undefined}
            >
              <item.icon size={18} />
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        <button className="mobile-menu-signout" onClick={() => void logout()} type="button">
          Sign out
        </button>
      </div>

      <nav
        className={`mobile-tabbar ${isMobileChromeHidden ? 'hidden' : ''}`}
        aria-label="Primary"
      >
        {mobilePrimaryNavItems.map((item) => (
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

        <button
          type="button"
          className={`mobile-tab mobile-tab-button ${isMobileMenuOpen || isCurrentItemInMoreMenu ? 'active' : ''}`}
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-navigation-more"
          onClick={() => setIsMobileMenuOpen((current) => !current)}
        >
          <Ellipsis size={18} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
};
