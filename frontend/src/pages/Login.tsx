import React from 'react';
import axios from 'axios';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { passkeysSupported } from '../auth/passkeys';

function formatError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (typeof error.response?.data === 'string') {
      const message = error.response.data.trim();
      if (!message) {
        return 'Unable to sign in.';
      }

      const normalized = message.charAt(0).toUpperCase() + message.slice(1);
      return normalized.endsWith('.') ? normalized : `${normalized}.`;
    }

    return 'Unable to sign in.';
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to sign in.';
}

export default function Login() {
  const { status, bootstrapRequired, login, loginWithPasskey, bootstrap } = useAuth();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isPasskeySubmitting, setIsPasskeySubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const canUsePasskeys = !bootstrapRequired && passkeysSupported();

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

  const handlePasskeySignIn = async () => {
    setIsPasskeySubmitting(true);
    setErrorMessage(null);

    try {
      await loginWithPasskey(username);
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setIsPasskeySubmitting(false);
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

          {errorMessage ? (
            <div aria-live="polite" className="auth-error-card" role="alert">
              <strong>Unable to sign in</strong>
              <p className="auth-error">{errorMessage}</p>
            </div>
          ) : null}

          <button className="auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Please wait…' : bootstrapRequired ? 'Create administrator' : 'Sign in'}
          </button>

          {canUsePasskeys ? (
            <>
              <div className="auth-divider" aria-hidden="true">
                <span>or</span>
              </div>
              <button
                className="auth-secondary-submit"
                disabled={isPasskeySubmitting || !username.trim()}
                onClick={() => void handlePasskeySignIn()}
                type="button"
              >
                {isPasskeySubmitting ? 'Waiting for passkey…' : 'Use passkey'}
              </button>
            </>
          ) : null}
        </form>
      </div>
    </div>
  );
}
