/**
 * RFC 4180 CSV, hand-written in both directions.
 *
 * JSON → CSV flattens nested objects into dot keys and JSON-encodes arrays
 * (a cell has one line). CSV → JSON expands dot keys back into objects and
 * keeps every cell as a string — CSV has no types, and guessing turns
 * `0012` into `12`.
 */

import { isPlainObject } from "./json";

export interface CsvExportFailure {
  ok: false;
  message: string;
  hint: string;
}

export interface CsvExportSuccess {
  ok: true;
  csv: string;
  rows: number;
  columns: number;
  columnNames: string[];
  encodedCells: number;
}

export type CsvExportResult = CsvExportSuccess | CsvExportFailure;

export interface CsvImportFailure {
  ok: false;
  message: string;
  hint: string;
  line: number | null;
}

export interface CsvImportSuccess {
  ok: true;
  json: string;
  value: Record<string, unknown>[];
  rows: number;
  columns: number;
  columnNames: string[];
}

export type CsvImportResult = CsvImportSuccess | CsvImportFailure;

const FIELD_NEEDS_QUOTES = /[",\r\n]/;

function quoteField(value: string): string {
  const padded = value !== value.trim();
  if (!FIELD_NEEDS_QUOTES.test(value) && !padded) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

type Pair = [string, string];

function flattenInto(prefix: string, value: unknown, out: Pair[]): void {
  if (value === null || value === undefined) {
    out.push([prefix, ""]);
    return;
  }
  if (Array.isArray(value)) {
    out.push([prefix, value.length === 0 ? "" : JSON.stringify(value)]);
    return;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      out.push([prefix, "{}"]);
      return;
    }
    for (const [key, entry] of entries) {
      flattenInto(prefix.length === 0 ? key : `${prefix}.${key}`, entry, out);
    }
    return;
  }
  out.push([prefix, String(value)]);
}

/**
 * Root must be an object (one row) or an array of objects (one row each).
 * Columns are the first-seen union of every flattened key.
 */
export function jsonToCsv(value: unknown): CsvExportResult {
  let sourceRows: unknown[];
  if (Array.isArray(value)) {
    sourceRows = value;
  } else if (isPlainObject(value)) {
    sourceRows = [value];
  } else {
    return {
      ok: false,
      message: "CSV export needs an object or an array of objects at the root",
      hint: "The buffer holds a single primitive. Wrap it in an array of objects, e.g. [{ \"id\": 1 }].",
    };
  }

  if (sourceRows.length === 0) {
    return {
      ok: false,
      message: "The array is empty — there is nothing to tabulate",
      hint: "Add at least one object, or convert a document that contains rows.",
    };
  }

  const columnNames: string[] = [];
  const known = new Set<string>();
  const rows: Map<string, string>[] = [];
  let encodedCells = 0;

  for (let index = 0; index < sourceRows.length; index += 1) {
    const row = sourceRows[index];
    if (!isPlainObject(row)) {
      return {
        ok: false,
        message: `Row ${index + 1} is not an object`,
        hint: `CSV rows need named columns. Replace the ${Array.isArray(row) ? "array" : typeof row} at index ${index} with an object.`,
      };
    }
    const pairs: Pair[] = [];
    flattenInto("", row, pairs);
    const cells = new Map<string, string>();
    for (const [key, cell] of pairs) {
      if (key.length === 0) {
        return {
          ok: false,
          message: "A column name came out empty",
          hint: "Every property needs a non-empty key so it can become a header.",
        };
      }
      if (cells.has(key)) {
        return {
          ok: false,
          message: `Two values map to the same column "${key}"`,
          hint: `Row ${index + 1} has a literal "${key}" key and a nested object that flattens to it. Rename one of them.`,
        };
      }
      cells.set(key, cell);
      if (cell.startsWith("[") || cell.startsWith("{")) encodedCells += 1;
      if (!known.has(key)) {
        known.add(key);
        columnNames.push(key);
      }
    }
    rows.push(cells);
  }

  const lines = [columnNames.map(quoteField).join(",")];
  for (const cells of rows) {
    lines.push(columnNames.map((name) => quoteField(cells.get(name) ?? "")).join(","));
  }

  return {
    ok: true,
    csv: lines.join("\n"),
    rows: rows.length,
    columns: columnNames.length,
    columnNames,
    encodedCells,
  };
}

interface CsvRecord {
  cells: string[];
  line: number;
}

interface CsvScanFailure {
  ok: false;
  message: string;
  hint: string;
  line: number;
}

type CsvScanResult = { ok: true; records: CsvRecord[] } | CsvScanFailure;

function scanCsv(text: string): CsvScanResult {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let quotedField = false;
  let inQuotes = false;
  let quoteOpenedLine = 1;
  let line = 1;
  let recordLine = 1;
  let index = 0;

  const endField = () => {
    cells.push(field);
    field = "";
    quotedField = false;
  };
  const endRecord = () => {
    cells.push(field);
    field = "";
    quotedField = false;
    records.push({ cells, line: recordLine });
    cells = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        quotedField = true;
        index += 1;
        continue;
      }
      if (char === "\n") line += 1;
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      if (field.length > 0 || quotedField) {
        return {
          ok: false,
          message: `Unexpected quote inside an unquoted field on line ${line}`,
          hint: 'Wrap the whole field in double quotes and double any quotes inside it, e.g. "He said ""hi""".',
          line,
        };
      }
      inQuotes = true;
      quoteOpenedLine = line;
      index += 1;
      continue;
    }

    if (char === ",") {
      endField();
      index += 1;
      continue;
    }

    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      index += 1;
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }

    if (quotedField) {
      return {
        ok: false,
        message: `Unexpected "${char}" after a closing quote on line ${line}`,
        hint: "Only a comma, a line break or the end of the file may follow a quoted field.",
        line,
      };
    }

    field += char;
    index += 1;
  }

  if (inQuotes) {
    return {
      ok: false,
      message: `Unterminated quoted field starting on line ${quoteOpenedLine}`,
      hint: "A quoted field must be closed before the file ends.",
      line: quoteOpenedLine,
    };
  }

  if (field.length > 0 || cells.length > 0) endRecord();

  const meaningful = records.filter((record) => !(record.cells.length === 1 && record.cells[0] === ""));
  if (meaningful.length === 0) {
    return { ok: false, message: "No CSV rows found", hint: "The first line must be a header row.", line: 1 };
  }

  return { ok: true, records: meaningful };
}

function assignPath(target: Record<string, unknown>, path: string[], value: string): string | null {
  let node = target;
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const key = path[depth] ?? "";
    const existing = node[key];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      node[key] = created;
      node = created;
      continue;
    }
    if (isPlainObject(existing)) {
      node = existing;
      continue;
    }
    return `Column "${path.join(".")}" conflicts with scalar column "${path.slice(0, depth + 1).join(".")}"`;
  }
  const leaf = path[path.length - 1] ?? "";
  node[leaf] = value;
  return null;
}

export function csvToJson(text: string): CsvImportResult {
  if (text.trim().length === 0) {
    return { ok: false, message: "The buffer is empty", hint: "Paste a CSV table with a header row.", line: 1 };
  }

  const scanned = scanCsv(text);
  if (!scanned.ok) {
    return { ok: false, message: scanned.message, hint: scanned.hint, line: scanned.line };
  }

  const headerRecord = scanned.records[0];
  if (!headerRecord) {
    return { ok: false, message: "No CSV rows found", hint: "The first line must be a header row.", line: 1 };
  }

  const columnNames = headerRecord.cells.map((cell) => cell.trim());
  const seen = new Set<string>();
  for (let column = 0; column < columnNames.length; column += 1) {
    const name = columnNames[column] ?? "";
    if (name.length === 0) {
      return {
        ok: false,
        message: `Header column ${column + 1} is empty`,
        hint: "Every column needs a name so it can become an object key.",
        line: headerRecord.line,
      };
    }
    if (name.split(".").some((part) => part.length === 0)) {
      return {
        ok: false,
        message: `Header "${name}" has an empty path segment`,
        hint: 'Dot keys expand into nested objects, so "user..id" is ambiguous. Remove the double dot or quote the key.',
        line: headerRecord.line,
      };
    }
    if (seen.has(name)) {
      return {
        ok: false,
        message: `Duplicate header "${name}"`,
        hint: "Two columns would write the same key and one would silently win.",
        line: headerRecord.line,
      };
    }
    seen.add(name);
  }

  const rows: Record<string, unknown>[] = [];
  for (let offset = 1; offset < scanned.records.length; offset += 1) {
    const record = scanned.records[offset];
    if (!record) continue;
    if (record.cells.length !== columnNames.length) {
      return {
        ok: false,
        message: `Row ${offset} has ${record.cells.length} field${record.cells.length === 1 ? "" : "s"}, the header has ${columnNames.length}`,
        hint: "Every row must be rectangular — same field count as the header. Quote fields that contain commas.",
        line: record.line,
      };
    }
    const row: Record<string, unknown> = {};
    for (let column = 0; column < columnNames.length; column += 1) {
      const path = (columnNames[column] ?? "").split(".");
      const conflict = assignPath(row, path, record.cells[column] ?? "");
      if (conflict) {
        return { ok: false, message: conflict, hint: "Rename one of the columns so the nesting stays unambiguous.", line: record.line };
      }
    }
    rows.push(row);
  }

  return {
    ok: true,
    json: JSON.stringify(rows, null, 2),
    value: rows,
    rows: rows.length,
    columns: columnNames.length,
    columnNames,
  };
}
