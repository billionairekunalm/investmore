// CSV / XLSX / print-to-PDF exports. Callers pass already permission-filtered rows.
type Row = Record<string, string | number>;

const download = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// ponytail: guard against CSV formula injection when opened in Excel
const safe = (v: unknown) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v);

export function downloadCSV(rows: Row[], name: string) {
  const headers = Object.keys(rows[0] ?? {});
  const csv = [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(safe(r[h]))).join(','))].join('\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
}

export async function downloadXLSX(rows: Row[], name: string) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safe(v)]))));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  XLSX.writeFile(wb, `${name}.xlsx`);
}

/** Opens a print-friendly window; the browser's "Save as PDF" produces the PDF. */
export function printTable(title: string, sub: string, rows: Row[]) {
  const headers = Object.keys(rows[0] ?? {});
  const h = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><title>${h(title)}</title><style>
    body{font:12px Inter,system-ui,sans-serif;color:#181818;margin:32px} h1{font-size:18px;margin:0;color:#028a02} p{color:#71717a;margin:4px 0 16px}
    table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e7e7ea} th{font-size:10.5px;text-transform:uppercase;color:#71717a}
    @page{margin:14mm}</style><h1>${h(title)}</h1><p>${h(sub)}</p><table><thead><tr>${headers.map((x) => `<th>${h(x)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${headers.map((x) => `<td>${h(r[x])}</td>`).join('')}</tr>`).join('')}</tbody></table><script>onload=()=>print()</script>`);
  w.document.close();
}

export async function readSheet(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  const headers = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map(String);
  return { headers, rows };
}
