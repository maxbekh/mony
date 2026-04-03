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
  const [username, setUsername] = React.useState('');
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
        await bootstrap(username, password);
      } else {
        await login(username, password);
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
          <span className="auth-mark">mony</span>
          <h1>Sign in</h1>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Username</span>
            <input
              autoComplete="username"
              name="username"
              spellCheck={false}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={bootstrapRequired ? 'owner' : 'Enter your username'}
              required
            />
          </label>

          <label className="auth-field">
            <div className="auth-field-heading">
              <span>Password</span>
              {bootstrapRequired ? <span className="auth-pill">12+ chars</span> : null}
            </div>
            <input
              autoComplete={bootstrapRequired ? 'new-password' : 'current-password'}
              name="password"
              type="password"
              minLength={bootstrapRequired ? 12 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                bootstrapRequired ? 'Choose a long passphrase' : 'Enter your password'
              }
              required
            />
            {bootstrapRequired ? (
              <p className="auth-hint">
                Use a long passphrase. Length matters more than complexity rules.
              </p>
            ) : null}
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
