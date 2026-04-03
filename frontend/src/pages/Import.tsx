import React, { useState } from 'react';
import { api } from '../services/api';
import { Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const Import: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceAccountRef, setSourceAccountRef] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !sourceName || !sourceAccountRef) return;

    setImporting(true);
    setResult(null);

    try {
      const response = await api.importCsv(file, sourceName, sourceAccountRef);
      setResult({
        success: true,
        message: 'Import successful!',
        details: response,
      });
      // Clear form
      setFile(null);
      setSourceName('');
      setSourceAccountRef('');
      // Reset file input
      const fileInput = document.getElementById('csv-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error: any) {
      setResult({
        success: false,
        message: error.response?.data || 'Import failed. Please try again.',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Import CSV</h1>
        <p className="text-muted">Upload your bank statement CSV file to import transactions.</p>
      </div>

      <div className="import-container">
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
            {result.success && result.details && (
              <div className="result-details">
                <div className="detail-item">
                  <span className="label">Transactions inserted:</span>
                  <span className="value">{result.details.inserted_transactions}</span>
                </div>
                <div className="detail-item">
                  <span className="label">Skipped duplicates:</span>
                  <span className="value">{result.details.skipped_duplicates}</span>
                </div>
                <div className="detail-item">
                  <span className="label">Total rows:</span>
                  <span className="value">{result.details.row_count}</span>
                </div>
              </div>
            )}
            {!result.success && (
              <p className="error-message">{result.message}</p>
            )}
          </div>
        )}
      </div>

      <style>{`
        .page {
          max-width: 800px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }
        .import-container {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .import-card {
          padding: 2rem;
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
        .button.full-width {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.5rem;
          height: 3rem;
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .result-card {
          padding: 1.5rem;
          border-radius: 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .result-card.success {
          background-color: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
        }
        .result-card.error {
          background-color: #fef2f2;
          border: 1px solid #fecaca;
          color: #991b1b;
        }
        .result-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .result-icon {
          flex-shrink: 0;
        }
        .result-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(0, 0, 0, 0.05);
        }
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .detail-item .label {
          font-size: 0.75rem;
          text-transform: uppercase;
          opacity: 0.7;
          font-weight: 600;
        }
        .detail-item .value {
          font-size: 1.25rem;
          font-weight: 700;
        }
        .error-message {
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
};

export default Import;
