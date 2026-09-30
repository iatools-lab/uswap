import * as XLSX from 'xlsx';

export interface ColumnConfig<T> {
  header: string;
  key: keyof T | ((item: T) => unknown);
  width?: number;
}

export interface ExportToExcelOptions<T> {
  data: T[];
  filename: string;
  sheetName?: string;
  columns: ColumnConfig<T>[];
}

export function exportToExcel<T>({
  data,
  filename,
  sheetName = 'Feuille1',
  columns,
}: ExportToExcelOptions<T>) {
  const formattedData = data.map((item) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col) => {
      const value = typeof col.key === 'function' ? col.key(item) : item[col.key];
      row[col.header] = value ?? '—';
    });
    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(formattedData);

  const colWidths = columns.map((col) => ({
    wch: col.width || 20,
  }));
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}