import React from 'react';
import { ThemeContext, type Theme, type ThemePreference } from './context';

const STORAGE_KEY = 'mony-theme';

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialPreference(): ThemePreference {
  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
    return storedTheme;
  }

  return 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = React.useState<ThemePreference>(getInitialPreference());
  const initialPreference = getInitialPreference();
  const initialTheme: Theme =
    initialPreference === 'system' ? getSystemTheme() : initialPreference;
  const [theme, setTheme] = React.useState<Theme>(initialTheme);

  React.useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, preference);

    if (preference !== 'system') {
      setTheme(preference);
    }
  }, [preference]);

  React.useEffect(() => {
    if (preference !== 'system') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setTheme(mediaQuery.matches ? 'dark' : 'light');
    };

    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [preference]);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const updatePreference = React.useCallback((nextPreference: ThemePreference) => {
    setPreference(nextPreference);
  }, []);

  const value = React.useMemo(
    () => ({
      theme,
      preference,
      setPreference: updatePreference,
    }),
    [preference, theme, updatePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
