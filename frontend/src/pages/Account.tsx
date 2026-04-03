import React from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { api } from '../services/api';
import type { AuthEvent } from '../types';

function formatError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return typeof error.response?.data === 'string'
      ? error.response.data
      : 'Unable to update password.';
  }

  return 'Unable to update password.';
}

export default function Account() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [events, setEvents] = React.useState<AuthEvent[]>([]);
  const [eventsError, setEventsError] = React.useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    const loadEvents = async () => {
      try {
        const response = await api.listAuthEvents();
        if (!cancelled) {
          setEvents(response.items);
          setEventsError(null);
        }
      } catch {
        if (!cancelled) {
          setEventsError('Unable to load recent security activity.');
        }
      }
    };

    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <section className="settings-panel">
      <div className="settings-header">
        <div>
          <span className="settings-eyebrow">Account</span>
          <h1>Change password</h1>
          <p>{user?.username}</p>
        </div>
      </div>

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
