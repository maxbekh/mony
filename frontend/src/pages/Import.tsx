import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Trash2, Upload } from 'lucide-react';
import axios from 'axios';
import { api } from '../services/api';
import type { ImportBatch } from '../types';

type ImportResult =
  | {
      success: true;
      message: string;
      details: {
        inserted_transactions: number;
        skipped_duplicates: number;
        row_count: number;
      };
    }
  | {
      success: false;
      message: string;
    };

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data;
    if (typeof payload === 'string' && payload.trim() !== '') {
      return payload;
    }
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

const Import: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceAccountRef, setSourceAccountRef] = useState('');
  const [importing, setImporting] = useState(false);
  const [importsLoading, setImportsLoading] = useState(true);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  const loadImports = async () => {
    setImportsLoading(true);
    try {
      const response = await api.listImports();
      setImports(response.items);
    } catch (error) {
      console.error('Failed to fetch imports:', error);
    } finally {
      setImportsLoading(false);
    }
  };

  useEffect(() => {
    void loadImports();
  }, []);

  const resetForm = () => {
    setFile(null);
    setSourceName('');
    setSourceAccountRef('');

    const fileInput = document.getElementById('csv-file') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !sourceName || !sourceAccountRef) {
      return;
    }

    setImporting(true);
    setResult(null);

    try {
      const response = await api.importCsv(file, sourceName, sourceAccountRef);
      setResult({
        success: true,
        message: 'Import successful.',
        details: {
          inserted_transactions: response.inserted_transactions,
          skipped_duplicates: response.skipped_duplicates,
          row_count: response.row_count,
        },
      });
      resetForm();
      await loadImports();
    } catch (error: unknown) {
      setResult({
        success: false,
        message: getErrorMessage(error, 'Import failed. Please try again.'),
      });
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteImport = async (batch: ImportBatch) => {
    const confirmed = window.confirm(
      `Delete import "${batch.original_filename}" from ${batch.source_name} / ${batch.source_account_ref}? This removes the batch and its imported transactions.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingBatchId(batch.id);
    setResult(null);

    try {
      const response = await api.deleteImport(batch.id);
      setResult({
        success: true,
        message: `${response.message}. Removed ${response.deleted_transactions} transactions.`,
        details: {
          inserted_transactions: 0,
          skipped_duplicates: 0,
          row_count: Number(response.deleted_rows),
        },
      });
      await loadImports();
    } catch (error: unknown) {
      setResult({
        success: false,
        message: getErrorMessage(error, 'Delete failed. Please try again.'),
      });
    } finally {
      setDeletingBatchId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Import CSV</h1>
          <p className="text-muted">
            Upload bank statement files, then review or delete the resulting import batches.
          </p>
        </div>
      </div>

      <div className="import-grid">
        <div className="card import-card">
          <form onSubmit={handleImport} className="import-form">
            <div className="form-group">
              <label htmlFor="source_name">Source Name</label>
              <input
                id="source_name"
                type="text"
                placeholder="e.g. Revolut, Boursorama"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="source_account_ref">Account Reference</label>
              <input
                id="source_account_ref"
                type="text"
                placeholder="e.g. main-checking, savings"
                value={sourceAccountRef}
                onChange={(e) => setSourceAccountRef(e.target.value)}
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="csv-file">CSV File</label>
              <div className="file-dropzone">
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  required
                  className="file-input"
                />
                <div className="file-dropzone-content">
                  <Upload size={32} className="upload-icon" />
                  <div className="file-info">
                    {file ? (
                      <span className="file-name">{file.name}</span>
                    ) : (
                      <span className="file-placeholder">Click or drag CSV file here</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={importing || !file || !sourceName || !sourceAccountRef}
              className="button primary full-width"
            >
              {importing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Importing...
                </>
              ) : (
                'Start Import'
              )}
            </button>
          </form>
        </div>

        <div className="card history-card">
          <div className="section-header">
            <h2>Recent imports</h2>
            <button
              type="button"
              onClick={() => void loadImports()}
              className="button secondary"
              disabled={importsLoading}
            >
              Refresh
            </button>
          </div>

          {importsLoading ? (
            <div className="empty-state">
              <Loader2 size={18} className="animate-spin" />
              <span>Loading imports...</span>
            </div>
          ) : imports.length === 0 ? (
            <div className="empty-state">
              <span>No imports yet.</span>
            </div>
          ) : (
            <div className="import-list">
              {imports.map((batch) => (
                <div key={batch.id} className="import-item">
                  <div className="import-item-main">
                    <div className="import-item-topline">
                      <strong>{batch.original_filename}</strong>
                      <span className={`status-badge status-${batch.status}`}>{batch.status}</span>
                    </div>
                    <div className="import-meta">
                      <span>{batch.source_name}</span>
                      <span>{batch.source_account_ref}</span>
                      <span>{batch.transaction_count} transactions</span>
                      <span>{batch.row_count} rows</span>
                    </div>
                    <div className="import-date">
                      Imported {dateTimeFormatter.format(new Date(batch.imported_at))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-button danger-button"
                    onClick={() => void handleDeleteImport(batch)}
                    disabled={deletingBatchId === batch.id}
                    aria-label={`Delete import ${batch.original_filename}`}
                  >
                    {deletingBatchId === batch.id ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Trash2 size={18} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className={`result-card ${result.success ? 'success' : 'error'}`}>
          <div className="result-header">
            {result.success ? (
              <CheckCircle2 size={24} className="result-icon" />
            ) : (
              <AlertCircle size={24} className="result-icon" />
            )}
            <h3>{result.message}</h3>
          </div>
          {result.success && 'details' in result && (
            <div className="result-details">
              <div className="detail-item">
                <span className="label">Rows:</span>
                <span className="value">{result.details.row_count}</span>
              </div>
              <div className="detail-item">
                <span className="label">Transactions inserted:</span>
                <span className="value">{result.details.inserted_transactions}</span>
              </div>
              <div className="detail-item">
                <span className="label">Skipped duplicates:</span>
                <span className="value">{result.details.skipped_duplicates}</span>
              </div>
            </div>
          )}
          {!result.success && <p className="error-message">{result.message}</p>}
        </div>
      )}

      <style>{`
        .page {
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
        }
        .import-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 1.5rem;
          align-items: start;
        }
        .card {
          background: white;
          border-radius: 0.75rem;
          border: 1px solid var(--border-color);
        }
        .import-card,
        .history-card {
          padding: 1.5rem;
        }
        .import-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .form-group label {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-main);
        }
        .form-input {
          padding: 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border-color);
          outline: none;
          font-size: 0.875rem;
          transition: border-color 0.2s;
        }
        .form-input:focus {
          border-color: var(--primary-color);
        }
        .file-dropzone {
          position: relative;
          border: 2px dashed var(--border-color);
          border-radius: 0.75rem;
          padding: 2rem;
          text-align: center;
          transition: border-color 0.2s;
          cursor: pointer;
        }
        .file-dropzone:hover {
          border-color: var(--primary-color);
          background: #f8fafc;
        }
        .file-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }
        .file-dropzone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }
        .upload-icon {
          color: var(--text-muted);
        }
        .file-placeholder {
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .file-name {
          color: var(--primary-color);
          font-weight: 600;
          font-size: 0.875rem;
        }
        .button {
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          font-weight: 500;
          font-size: 0.875rem;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .button.primary {
          background: var(--primary-color);
          color: white;
        }
        .button.primary:hover {
          background: var(--primary-hover);
        }
        .button.secondary {
          background: #f8fafc;
          border-color: var(--border-color);
          color: var(--text-main);
        }
        .button:disabled,
        .icon-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .button.full-width {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.5rem;
          height: 3rem;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
        }
        .import-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .import-item {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem;
          border: 1px solid var(--border-color);
          border-radius: 0.75rem;
          background: #fcfcfd;
        }
        .import-item-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .import-item-topline {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .import-meta,
        .import-date {
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .import-meta {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.2rem 0.5rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
        }
        .status-completed {
          background: #dcfce7;
          color: #166534;
        }
        .status-pending {
          background: #fef3c7;
          color: #92400e;
        }
        .icon-button {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border-color);
          background: white;
          cursor: pointer;
        }
        .danger-button {
          color: #b91c1c;
          border-color: #fecaca;
          background: #fff1f2;
          flex-shrink: 0;
        }
        .empty-state {
          min-height: 12rem;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.75rem;
          color: var(--text-muted);
          border: 1px dashed var(--border-color);
          border-radius: 0.75rem;
        }
        .result-card {
          padding: 1.5rem;
          border-radius: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .result-card.success {
          background: #ecfdf5;
          border: 1px solid #86efac;
        }
        .result-card.error {
          background: #fef2f2;
          border: 1px solid #fca5a5;
        }
        .result-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .result-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 0.75rem;
        }
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .label {
          color: var(--text-muted);
          font-size: 0.75rem;
          text-transform: uppercase;
        }
        .value {
          font-weight: 600;
        }
        .error-message {
          margin: 0;
          color: #991b1b;
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 960px) {
          .import-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default Import;
