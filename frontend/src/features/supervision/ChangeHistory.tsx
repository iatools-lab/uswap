import { translate } from "../../app/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/auth-api";
import { FileSpreadsheet, LoaderCircle } from "../../ui/icons";
import {
  ResponsiveDataTable,
  type ResponsiveColumn,
} from "../../ui/ResponsiveDataTable";
import { exportToExcel } from "../../utils/excelExport";
import { Select } from "../../ui/Select";
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
  const [stationSearch, setStationSearch] = useState("");
  const [swapperSearch, setSwapperSearch] = useState("");

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

  function exportExcel() {
    if (!visibleRows.length) return;
    exportToExcel<ShiftChange>({
      data: visibleRows,
      filename: `uswap-changements-${toDateInput(new Date())}`,
      sheetName: "Changements",
      columns: [
        { header: "Type", key: (row) => TYPE_LABEL[row.type], width: 18 },
        { header: "Initiateur", key: (row) => row.initiator, width: 24 },
        { header: "Station", key: (row) => row.station, width: 24 },
        { header: "Sortant", key: (row) => row.outSwapper ?? "", width: 24 },
        { header: "Entrant", key: (row) => row.inSwapper ?? "", width: 24 },
        { header: "Motif", key: (row) => row.reason ?? "", width: 38 },
        {
          header: "Date",
          key: (row) => formatDateTime(row.createdAt),
          width: 22,
        },
      ],
    });
  }

  const visibleRows = useMemo(() => {
    const stationNeedle = stationSearch.trim().toLocaleLowerCase("fr");
    const swapperNeedle = swapperSearch.trim().toLocaleLowerCase("fr");
    return (rows ?? [])
      .filter((row) =>
        stationNeedle
          ? row.station.toLocaleLowerCase("fr").includes(stationNeedle)
          : true,
      )
      .filter((row) =>
        swapperNeedle
          ? `${row.outSwapper ?? ""} ${row.inSwapper ?? ""}`
              .toLocaleLowerCase("fr")
              .includes(swapperNeedle)
          : true,
      );
  }, [rows, stationSearch, swapperSearch]);
  const columns: ResponsiveColumn<ShiftChange>[] = [
    {
      key: "type",
      header: "Type",
      primary: true,
      render: (row) => (
        <span className="admin-badge">{TYPE_LABEL[row.type]}</span>
      ),
    },
    { key: "initiator", header: "Initiateur", render: (row) => row.initiator },
    { key: "station", header: "Station", render: (row) => row.station },
    { key: "out", header: "Sortant", render: (row) => row.outSwapper ?? "—" },
    { key: "in", header: "Entrant", render: (row) => row.inSwapper ?? "—" },
    { key: "reason", header: "Motif", render: (row) => row.reason ?? "—" },
    {
      key: "date",
      header: "Date",
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <h2>{translate("Historique des changements d’affectation")}</h2>
          <p className="operations-hint">
            {translate("Remplacements et permutations en lecture seule, filtrables par période, station et swappeur.")}</p>
        </div>
        <button
          type="button"
          className="admin-button secondary small"
          disabled={!visibleRows.length}
          onClick={exportExcel}
        >
          <FileSpreadsheet size={16} />
          {translate("Exporter Excel")}</button>
      </div>
      <div className="supervision-toolbar">
        <label>
          {translate("Du")}<input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          {translate("Au")}<input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          {translate("Type")}<Select
            value={type}
            size="sm"
            ariaLabel={translate("Type de changement")}
            onChange={(value) => setType(String(value))}
            options={[
              { value: "", label: "Tous" },
              { value: "REPLACEMENT", label: "Remplacement" },
              { value: "PERMUTATION", label: "Permutation" },
              { value: "REASSIGNMENT", label: "Réaffectation" },
            ]}
          />
        </label>
        <label>
          {translate("Station")}<input
            type="search"
            value={stationSearch}
            onChange={(event) => setStationSearch(event.target.value)}
            placeholder={translate("Filtrer une station…")}
          />
        </label>
        <label>
          {translate("Swappeur")}<input
            type="search"
            value={swapperSearch}
            onChange={(event) => setSwapperSearch(event.target.value)}
            placeholder={translate("Nom du swappeur…")}
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
          {translate("Chargement de l’historique…")}</div>
      ) : !visibleRows.length ? (
        <div className="admin-empty">
          <h3>
            {rows.length
              ? "Aucun changement ne correspond"
              : "Aucun changement sur la période"}
          </h3>
        </div>
      ) : (
        <ResponsiveDataTable
          rows={visibleRows}
          columns={columns}
          rowKey={(row) => row.id}
          ariaLabel={translate("Historique des changements d’affectation")}
          className="ops-table"
        />
      )}
      <p className="operations-hint">{translate("Historique en lecture seule.")}</p>
    </section>
  );
}
