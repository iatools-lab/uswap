import * as XLSX from "xlsx";

export interface ColumnConfig<T> {
  header: string;
  key: keyof T | ((item: T) => unknown);
  width?: number;
  /**
   * Format d'affichage. `number` : garde une valeur numérique (tri, somme dans
   * Excel) ; `text` : tronque/échappe proprement une chaîne libre.
   */
  format?: "text" | "number";
}

export interface ExportToExcelOptions<T> {
  data: T[];
  filename: string;
  sheetName?: string;
  columns: ColumnConfig<T>[];
  /**
   * Métadonnées imprimées au-dessus du tableau (période, station, date de
   * génération). Sans elles, un fichier transmis par e-mail n'est plus
   * rattachable à la période qu'il décrit.
   */
  meta?: Array<[string, string]>;
  /** Date de génération affichée dans l'en-tête (par défaut : maintenant). */
  generatedAt?: Date;
}

/** Échappement CSV (RFC 4180), séparateur point-virgule (Excel FR). */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Construit le classeur en mémoire.
 *
 * Le tableau de données commence à la ligne des en-têtes, et non à la ligne 1 :
 * les métadonnées sont donc écrites AVANT. Le filtre automatique et la ligne
 * figée portent sur la vraie ligne d'en-tête, sinon Excel filtrerait sur
 * « Période » et perdrait la première ligne de données.
 */
function buildWorkbook<T>({
  data,
  sheetName = "Feuille1",
  columns,
  meta,
  generatedAt = new Date(),
}: Omit<ExportToExcelOptions<T>, "filename">): XLSX.WorkBook {
  const metaRows: Array<Array<string>> = [
    ...(meta ?? []).map(([label, value]) => [label, value]),
    ["Généré le", generatedAt.toLocaleString("fr-FR")],
    [],
  ];

  const header = columns.map((col) => col.header);
  const rows = data.map((item) =>
    columns.map((col) => {
      const raw =
        typeof col.key === "function" ? col.key(item) : item[col.key];
      if (raw === null || raw === undefined || raw === "") return "—";
      if (col.format === "number" && typeof raw === "number") return raw;
      return raw as string | number | boolean;
    }),
  );

  const worksheet = XLSX.utils.aoa_to_sheet([...metaRows, header, ...rows]);

  worksheet["!cols"] = columns.map((col) => ({ wch: col.width || 20 }));

  const headerRow = metaRows.length;
  // Ligne d'en-tête figée + filtre automatique sur le seul tableau.
  worksheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRow, c: 0 },
      e: { r: headerRow + rows.length, c: columns.length - 1 },
    }),
  };
  worksheet["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return workbook;
}

/**
 * Télécharge un tableau au format Excel.
 *
 * Signature inchangée pour les appelants existants (liste des stations,
 * planning, utilisateurs, historique des changements).
 */
export function exportToExcel<T>(options: ExportToExcelOptions<T>) {
  const workbook = buildWorkbook(options);
  XLSX.writeFile(workbook, `${options.filename}.xlsx`);
}

/** Même tableau, au format CSV (UTF-8, point-virgule, BOM pour Excel FR). */
export function exportToCsv<T>(options: ExportToExcelOptions<T>) {
  const generatedAt = options.generatedAt ?? new Date();
  const lines: string[] = [];
  for (const [label, value] of options.meta ?? []) {
    lines.push(`${csvCell(label)};${csvCell(value)}`);
  }
  lines.push(`${csvCell("Généré le")};${csvCell(generatedAt.toLocaleString("fr-FR"))}`);
  lines.push("");
  lines.push(options.columns.map((col) => csvCell(col.header)).join(";"));
  for (const item of options.data) {
    lines.push(
      options.columns
        .map((col) => {
          const raw =
            typeof col.key === "function" ? col.key(item) : item[col.key];
          return csvCell(raw === null || raw === undefined ? "—" : raw);
        })
        .join(";"),
    );
  }

  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${options.filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
