import React from 'react';
import type { AuthContextValue } from './AuthProvider';

export const AuthContext = React.createContext<AuthContextValue | null>(null);
