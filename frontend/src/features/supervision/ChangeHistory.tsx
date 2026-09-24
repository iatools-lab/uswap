import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { FileCsv, LoaderCircle } from "../../ui/icons";
import { toDateInput, formatDateTime } from "./format";
import type { ShiftChange, SupervisionProps } from "./types";

const TYPE_LABEL: Record<ShiftChange["type"], string> = {
  REPLACEMENT: "Remplacement",
  PERMUTATION: "Permutation",
  REASSIGNMENT: "Réaffectation",
};

export function ChangeHistory({ user }: SupervisionProps) {
  const [rows, setRows] = useState<ShiftChange[] | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(() =>
    toDateInput(new Date(Date.now() - 30 * 86400000)),
  );
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [swapperId, setSwapperId] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59`).toISOString());
    if (type) params.set("type", type);
    return params.toString();
  }, [from, to, type]);

  const load = useCallback(() => {
    setError("");
    api<ShiftChange[]>(`/operations/changes?${query}`)
      .then(setRows)
      .catch((err) => setError((err as Error).message));
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!rows?.length) return;
    const header = [
      "Type",
      "Initiateur",
      "Station",
      "Sortant",
      "Entrant",
      "Motif",
      "Date",
    ];
    const lines = rows.map((row) =>
      [
        TYPE_LABEL[row.type],
        row.initiator,
        row.station,
        row.outSwapper ?? "",
        row.inSwapper ?? "",
        row.reason ?? "",
        row.createdAt,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(
      [`\uFEFF${[header.join(";"), ...lines].join("\r\n")}`],
      {
        type: "text/csv;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `uswap-changements-${toDateInput(new Date())}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>Historique des changements d’affectation</h2>
          <p className="operations-hint">
            Remplacements et permutations en lecture seule, filtrables par
            période, station et swappeur.
          </p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          disabled={!rows?.length}
          onClick={exportCsv}
        >
          <FileCsv size={16} />
          Exporter
        </button>
      </div>
      <div className="supervision-toolbar">
        <label>
          Du
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Au
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">Tous</option>
            <option value="REPLACEMENT">Remplacement</option>
            <option value="PERMUTATION">Permutation</option>
            <option value="REASSIGNMENT">Réaffectation</option>
          </select>
        </label>
        <label>
          Swappeur
          <input
            value={swapperId}
            onChange={(event) => setSwapperId(event.target.value)}
            placeholder="Identifiant (optionnel)"
          />
        </label>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {!rows ? (
        <div className="admin-loading" role="status">
          <LoaderCircle className="spin" />
          Chargement de l’historique…
        </div>
      ) : !rows.length ? (
        <div className="admin-empty">
          <h3>Aucun changement sur la période</h3>
        </div>
      ) : (
        <div className="admin-table-wrap ops-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Initiateur</th>
                <th>Station</th>
                <th>Sortant</th>
                <th>Entrant</th>
                <th>Motif</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="admin-badge">{TYPE_LABEL[row.type]}</span>
                  </td>
                  <td>{row.initiator}</td>
                  <td>{row.station}</td>
                  <td>{row.outSwapper ?? "—"}</td>
                  <td>{row.inSwapper ?? "—"}</td>
                  <td>{row.reason ?? "—"}</td>
                  <td>{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="operations-hint">
        Historique en lecture seule.{" "}
        {user.role === "STATION_CHIEF" ? "Limité à votre station." : ""}
      </p>
    </section>
  );
}
