import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { KeyRound, LayoutDashboard, PieChart, Receipt, Tags, Upload } from 'lucide-react';
import { useAuth } from '../auth/useAuth';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileChromeHidden, setIsMobileChromeHidden] = React.useState(false);
  const lastScrollYRef = React.useRef(0);
  const appVersionLabel = `${__APP_VERSION__} (${__APP_BUILD__})`;

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Transactions', path: '/transactions', icon: Receipt },
    { name: 'Categorize', path: '/categorize', icon: Tags },
    { name: 'Import', path: '/import', icon: Upload },
    { name: 'Analytics', path: '/analytics', icon: PieChart },
    { name: 'Settings', path: '/settings', icon: KeyRound },
  ];
  const currentNavItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];

  React.useEffect(() => {
    document.title = `mony - ${currentNavItem.name}`;
  }, [currentNavItem.name]);

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

      <nav
        className={`mobile-tabbar ${isMobileChromeHidden ? 'hidden' : ''}`}
        aria-label="Primary"
      >
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
