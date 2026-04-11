import React from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { createPasskey, fallbackPasskeyLabel, passkeysSupported } from '../auth/passkeys';
import { api } from '../services/api';
import { useTheme } from '../theme/useTheme';
import type { ThemePreference } from '../theme/context';
import type { AuthEvent, Passkey } from '../types';

function formatError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return typeof error.response?.data === 'string'
      ? error.response.data
      : 'Unable to complete security action.';
  }

  if (error instanceof DOMException) {
    if (error.name === 'SecurityError' || error.name === 'NotAllowedError') {
      return `Security error: ${error.message}. This usually happens if the domain doesn't match the passkey configuration (RP ID).`;
    }
    return `Browser error: ${error.message}`;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to complete security action.';
}

export default function Settings() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { theme, preference, setPreference } = useTheme();
  const [events, setEvents] = React.useState<AuthEvent[]>([]);
  const [passkeys, setPasskeys] = React.useState<Passkey[]>([]);
  const [eventsError, setEventsError] = React.useState<string | null>(null);
  const [passkeysError, setPasskeysError] = React.useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isRegisteringPasskey, setIsRegisteringPasskey] = React.useState(false);
  const [passkeyLabel, setPasskeyLabel] = React.useState(fallbackPasskeyLabel());
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const passkeySupport = passkeysSupported();

  React.useEffect(() => {
    let cancelled = false;

    const loadSecurityData = async () => {
      try {
        const [eventsResponse, passkeysResponse] = await Promise.all([
          api.listAuthEvents(),
          api.listPasskeys(),
        ]);
        if (!cancelled) {
          setEvents(eventsResponse.items);
          setPasskeys(passkeysResponse.items);
          setEventsError(null);
          setPasskeysError(null);
        }
      } catch {
        if (!cancelled) {
          setEventsError('Unable to load recent security activity.');
          setPasskeysError('Unable to load saved passkeys.');
        }
      }
    };

    void loadSecurityData();

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePasskeyRegistration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasskeysError(null);
    setIsRegisteringPasskey(true);

    try {
      const start = await api.startPasskeyRegistration(passkeyLabel);
      const credential = await createPasskey(start.options);
      await api.finishPasskeyRegistration(start.ceremony_id, credential);
      const refreshed = await api.listPasskeys();
      setPasskeys(refreshed.items);
      setPasskeyLabel(fallbackPasskeyLabel());
    } catch (error) {
      setPasskeysError(formatError(error));
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const handleDeletePasskey = async (passkeyId: string) => {
    setPasskeysError(null);

    try {
      await api.deletePasskey(passkeyId);
      setPasskeys((current) => current.filter((passkey) => passkey.id !== passkeyId));
    } catch (error) {
      setPasskeysError(formatError(error));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage('New password and confirmation must match.');
      return;
    }

    setIsSubmitting(true);

    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <section className="settings-panel">
      <div className="settings-header">
        <div>
          <span className="settings-eyebrow">Settings</span>
          <h1>Change password</h1>
          <p>{user?.username}</p>
        </div>
      </div>

      <section className="settings-form">
        <div className="settings-block-header">
          <div>
            <span className="settings-eyebrow">Appearance</span>
            <h2>Theme</h2>
            <p className="settings-empty">Currently using {theme} mode.</p>
          </div>
        </div>

        <div className="segmented-control" aria-label="Theme preference">
          {(['system', 'light', 'dark'] as ThemePreference[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented-option ${preference === option ? 'active' : ''}`}
              onClick={() => setPreference(option)}
            >
              {labelForThemeOption(option)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-form">
        <div className="settings-block-header">
          <div>
            <span className="settings-eyebrow">Security</span>
            <h2>Passkeys</h2>
            <p className="settings-empty">
              Add device-bound sign-in without changing the existing JWT or refresh-token model.
            </p>
          </div>
        </div>

        {passkeySupport ? (
          <form className="auth-form" onSubmit={handlePasskeyRegistration}>
            <label className="auth-field">
              <span>Label</span>
              <input
                name="passkeyLabel"
                type="text"
                value={passkeyLabel}
                onChange={(event) => setPasskeyLabel(event.target.value)}
                placeholder="MacBook Air"
                required
              />
            </label>

            <button className="auth-secondary-submit" disabled={isRegisteringPasskey} type="submit">
              {isRegisteringPasskey ? 'Waiting for passkey…' : 'Add passkey'}
            </button>
          </form>
        ) : (
          <p className="settings-empty">
            This browser does not expose the WebAuthn APIs needed for passkeys.
          </p>
        )}

        {passkeysError ? <p className="auth-error">{passkeysError}</p> : null}

        {passkeys.length === 0 ? (
          <p className="settings-empty">No passkeys saved yet.</p>
        ) : (
          <div className="passkey-list">
            {passkeys.map((passkey) => (
              <article className="passkey-item" key={passkey.id}>
                <div className="passkey-copy">
                  <strong>{passkey.label}</strong>
                  <p>
                    Added {new Date(passkey.created_at).toLocaleString()}
                    {passkey.last_used_at
                      ? ` · Used ${new Date(passkey.last_used_at).toLocaleString()}`
                      : ' · Never used yet'}
                  </p>
                </div>
                <button
                  className="button-secondary-inline"
                  type="button"
                  onClick={() => void handleDeletePasskey(passkey.id)}
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <form className="settings-form" onSubmit={handleSubmit}>
        <label className="auth-field">
          <span>Current password</span>
          <input
            autoComplete="current-password"
            name="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>New password</span>
          <input
            autoComplete="new-password"
            name="newPassword"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>Confirm new password</span>
          <input
            autoComplete="new-password"
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>

        {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

        <button className="auth-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <section className="settings-form">
        <div className="settings-block-header">
          <div>
            <span className="settings-eyebrow">Session</span>
            <h2>Sign out</h2>
            <p className="settings-empty">End the current web session on this device.</p>
          </div>
        </div>

        <button className="button-secondary-inline" type="button" onClick={() => void handleSignOut()}>
          Sign out
        </button>
      </section>

      <section className="settings-form">
        <div className="settings-block-header">
          <div>
            <span className="settings-eyebrow">Security</span>
            <h2>Recent activity</h2>
          </div>
        </div>

        {eventsError ? <p className="auth-error">{eventsError}</p> : null}

        {!eventsError && events.length === 0 ? (
          <p className="settings-empty">No recent security activity.</p>
        ) : null}

        <div className="activity-list">
          {events.map((event) => (
            <article className="activity-item" key={event.id}>
              <div className="activity-copy">
                <strong>{labelForEvent(event.event_type)}</strong>
                <p>{formatEventMeta(event)}</p>
              </div>
              <time className="activity-time" dateTime={event.created_at}>
                {new Date(event.created_at).toLocaleString()}
              </time>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function labelForThemeOption(option: ThemePreference) {
  switch (option) {
    case 'system':
      return 'System';
    case 'light':
      return 'Light';
    case 'dark':
      return 'Dark';
    default:
      return option;
  }
}

function labelForEvent(eventType: string) {
  switch (eventType) {
    case 'login':
      return 'Signed in';
    case 'login_failed':
      return 'Failed sign-in attempt';
    case 'logout':
      return 'Signed out';
    case 'logout_all':
      return 'Signed out everywhere';
    case 'password_changed':
      return 'Password changed';
    case 'password_reset_admin':
      return 'Password reset from backend';
    case 'token_theft_detected':
      return 'Refresh token reuse detected';
    case 'token_refresh':
      return 'Session refreshed';
    case 'bootstrap':
      return 'Initial administrator created';
    case 'passkey_registered':
      return 'Passkey added';
    case 'passkey_login':
      return 'Signed in with passkey';
    case 'passkey_deleted':
      return 'Passkey removed';
    case 'passkey_login_failed':
      return 'Failed passkey sign-in attempt';
    default:
      return eventType.replaceAll('_', ' ');
  }
}

function formatEventMeta(event: AuthEvent) {
  const meta = typeof event.metadata === 'object' && event.metadata !== null ? event.metadata : {};
  const username =
    'username' in meta && typeof meta.username === 'string' ? `Username: ${meta.username}` : null;
  const ip = event.ip_address ? `IP: ${event.ip_address}` : null;

  return [username, ip].filter(Boolean).join(' · ') || 'No extra context';
}
