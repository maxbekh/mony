import React from 'react';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

export interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);
