import { notify } from "../../ui/Toast";
import { useRef, useState, type DragEvent } from 'react';
import { api, download } from '../../api/auth-api';
import {
  ArrowLeft,
  CheckCheck,
  LoaderCircle,
  CloudUpload,
  DownloadSimple,
  FileSpreadsheet,
  Info,
  X,
} from '../../ui/icons';

type ImportRow = {
  line: number;
  fullName: string;
  email: string;
  role: string;
  status: 'READY' | 'IGNORED' | 'REJECTED' | 'CREATED';
  reason: string;
};

type Preview = {
  batchId: string;
  expiresAt: string;
  rows: ImportRow[];
  ready: number;
  created: number;
  ignored: number;
  rejected: number;
};

const labels: Record<string, string> = {
  READY: 'Valide',
  IGNORED: 'Ignoré',
  REJECTED: 'Rejeté',
  CREATED: 'Créé',
};

export function UserImport({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filename, setFilename] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  async function inspect(file?: File) {
    if (!file) return;
    setError('');
    setPreview(null);
    setDone(false);
    setFilename(file.name);

    if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      setError('Choisissez un fichier CSV ou XLSX de 2 Mo maximum.');
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api<Preview>('/users/imports/preview', form);
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<Preview>(`/users/imports/${preview.batchId}/confirm`, {});
      setPreview({ ...preview, ...result });
      setDone(true);
      notify("Import terminé. Consultez le bilan.");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    setDownloading(true);
    setError('');
    try {
      await download('/users/imports/template', 'modele-utilisateurs-uswap.xlsx');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléchargement impossible.');
    } finally {
      setDownloading(false);
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void inspect(e.dataTransfer.files[0]);
    }
  };

  const clearSelection = () => {
    setPreview(null);
    setFilename('');
    setError('');
    setDone(false);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="user-import-wrapper">
      <div className="user-import-header">
        <button type="button" className="text-button back-link" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Utilisateurs</span>
        </button>
        <h2>{done ? 'Bilan de l’importation' : 'Importer des utilisateurs'}</h2>
      </div>

      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}

      {!preview && (
        <div className="user-import-grid">
          {/* Zone principale : Sélection / Dropzone */}
          <section className="admin-card user-import-main">
            <input
              ref={fileInput}
              disabled={busy}
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => inspect(e.target.files?.[0])}
              style={{ display: 'none' }}
            />

            <div
              className={`file-dropzone ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInput.current?.click()}
            >
              <div className="dropzone-icon-wrap">
                <CloudUpload size={36} />
              </div>
              <div className="dropzone-text">
                <strong>Glissez-déposez votre fichier ici</strong>
                <span>CSV (UTF-8) ou Excel (.xlsx) • 2 Mo maximum</span>
              </div>
              <button
                type="button"
                className="admin-button secondary small"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInput.current?.click();
                }}
              >
                Choisir un fichier
              </button>
            </div>

            {busy && (
              <div className="import-loading-state">
                <LoaderCircle className="spin" size={20} />
                <span>Analyse et vérification du fichier en cours…</span>
              </div>
            )}
          </section>

          {/* Panneau latéral : Téléchargement du modèle & Instructions */}
          <aside className="admin-card user-import-sidebar">
            <div className="template-download-box">
              <div className="template-box-content">
                <strong>Modèle de fichier</strong>
                <p>Téléchargez le modèle Excel préformaté pour garantir la conformité des colonnes.</p>
              </div>
              <button
                type="button"
                className="admin-button secondary small full-width"
                disabled={downloading}
                onClick={template}
              >
                <DownloadSimple size={16} />
                {downloading ? 'Préparation…' : 'Télécharger le modèle Excel'}
              </button>
            </div>

            <hr className="form-divider" />

            <div className="instructions-box">
              <h3>
                <Info size={16} />
                Exigences de structure
              </h3>
              <ul className="instructions-list">
                <li>
                  <strong>Colonnes obligatoires :</strong>
                  <div className="code-chips">
                    <code>fullName</code>
                    <code>email</code>
                    <code>role</code>
                  </div>
                </li>
                <li>
                  <strong>Rôles autorisés :</strong>
                  <div className="code-chips">
                    <code>ADMIN</code>
                    <code>SUPERVISOR</code>
                    <code>STATION_CHIEF</code>
                    <code>SWAPPER</code>
                  </div>
                </li>
                <li className="note-item">
                  Les comptes importés seront créés en attente d'activation, sans envoi automatique d'invitation.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {preview && (
        <div className="user-import-preview-layout">
          <div className="selected-file-banner admin-card">
            <div className="file-banner-info">
              <FileSpreadsheet size={24} className="file-icon" />
              <div>
                <strong>{filename}</strong>
                <span>{preview.rows.length} ligne(s) analysée(s)</span>
              </div>
            </div>
            {!done && !busy && (
              <button
                type="button"
                className="toast-close"
                onClick={clearSelection}
                aria-label="Changer de fichier"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="import-summary-grid">
            <div className="summary-card success">
              <span className="summary-val">{done ? preview.created : preview.ready}</span>
              <span className="summary-label">{done ? 'Comptes créés' : 'Lignes valides'}</span>
            </div>
            <div className="summary-card warning">
              <span className="summary-val">{preview.ignored}</span>
              <span className="summary-label">Lignes ignorées</span>
            </div>
            <div className="summary-card danger">
              <span className="summary-val">{preview.rejected}</span>
              <span className="summary-label">Lignes rejetées</span>
            </div>
          </div>

          <div className="admin-card import-table-card">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th>Collaborateur</th>
                    <th>E-mail</th>
                    <th>Rôle</th>
                    <th>Résultat</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line}>
                      <td><strong>#{row.line}</strong></td>
                      <td>{row.fullName || '—'}</td>
                      <td>{row.email || '—'}</td>
                      <td>
                        {row.role ? <code>{row.role}</code> : '—'}
                      </td>
                      <td>
                        <span
                          className={`admin-badge ${
                            ['READY', 'CREATED'].includes(row.status)
                              ? 'active'
                              : row.status === 'IGNORED'
                              ? 'pending'
                              : 'inactive'
                          }`}
                        >
                          {labels[row.status] || row.status}
                        </span>
                      </td>
                      <td className="import-reason">{row.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="form-actions-bar">
              {done ? (
                <button type="button" className="admin-button" onClick={onBack}>
                  <CheckCheck size={18} />
                  Voir les utilisateurs
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="admin-button secondary"
                    disabled={busy}
                    onClick={clearSelection}
                  >
                    Changer de fichier
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    disabled={busy || !preview.ready}
                    onClick={confirm}
                  >
                    {busy && <LoaderCircle className="spin" size={16} />}
                    Importer {preview.ready} utilisateur{preview.ready > 1 ? 's' : ''}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}