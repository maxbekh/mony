import React from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { api } from '../services/api';

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
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

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
    </section>
  );
}
