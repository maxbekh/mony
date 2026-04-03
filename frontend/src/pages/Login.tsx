import React from 'react';
import axios from 'axios';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

function formatError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return typeof error.response?.data === 'string'
      ? error.response.data
      : 'Authentication failed.';
  }

  return 'Authentication failed.';
}

export default function Login() {
  const { status, bootstrapRequired, login, bootstrap } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (bootstrapRequired) {
        await bootstrap(email, password);
      } else {
        await login(email, password);
      }
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card-header">
          <span className="auth-eyebrow">Security-first access</span>
          <h1>{bootstrapRequired ? 'Initialize mony' : 'Sign in to mony'}</h1>
          <p>
            {bootstrapRequired
              ? 'Create the first administrator account. This bootstrap flow is disabled after the first account exists.'
              : 'Use your local mony account. Access tokens stay in memory and refresh uses secure cookies.'}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              autoComplete="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              autoComplete={bootstrapRequired ? 'new-password' : 'current-password'}
              name="password"
              type="password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

          <button className="auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Please wait…' : bootstrapRequired ? 'Create administrator' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
