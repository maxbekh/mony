import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status, bootstrapRequired } = useAuth();

  if (status === 'loading') {
    return <div className="auth-shell">Loading session…</div>;
  }

  if (bootstrapRequired || status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
