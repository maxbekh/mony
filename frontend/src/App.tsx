import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Account from './pages/Account';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Categorize from './pages/Categorize';
import Import from './pages/Import';
import Analytics from './pages/Analytics';
import './styles/index.css';

function App() {
  return (
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
                    <Route path="/account" element={<Account />} />
                  </Routes>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
