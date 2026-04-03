import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Settings from './pages/Settings';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Categorize from './pages/Categorize';
import Import from './pages/Import';
import Analytics from './pages/Analytics';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles/index.css';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="*"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/transactions" element={<Transactions />} />
                      <Route path="/categorize" element={<Categorize />} />
                      <Route path="/import" element={<Import />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/account" element={<Navigate to="/settings" replace />} />
                    </Routes>
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
