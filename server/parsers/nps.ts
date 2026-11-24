import crypto from "node:crypto";
import type {
  ContributionRow,
  HeaderMappingRequest,
  HoldingRow,
  ParseResult,
  SchemeTransactionRow,
} from "../models.ts";
import { NPS_PROFILE, type NpsProfile, type SectionProfile } from "./npsProfile.ts";

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIsoDate(year: number, month: number, day: number): string {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`);
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function loadBuiltinProfile(): NpsProfile {
  return structuredClone(NPS_PROFILE);
}

export function parseNpsText(
  rawText: string,
  filename: string,
  options?: {
    extraAliases?: Record<string, Record<string, string[]>>;
    narrationAliases?: Record<string, string>;
  },
): ParseResult {
  const text = rawText.replace(/^\uFEFF/, "");
  const profile = loadBuiltinProfile();
  const aliases = mergeAliases(profile.sections, options?.extraAliases ?? {});
  const narrations = { ...profile.narrations };
  const narrationAliases = options?.narrationAliases ?? {};

  const lines = text.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));
  const sections = splitSections(lines);
  const tier = tierFromTitle(sections.preamble[0] ?? "");
  const subscriber = parseSubscriber(sections.preamble);
  const [summaryHeaders, summaryValues] = headerAndValues(sections.summary);
  const [schemeHeaders, schemeRows] = parseTable(sections.schemes);
  const [contribHeaders, contribRows] = parseTable(sections.contributions);
  const txnBlocks = transactionBlocks(sections.transactions);
  const txnHeaders = txnBlocks.length > 0 ? txnBlocks[0][1] : [];

  const sectionHeaders: Record<string, string[]> = {
    contributions: contribHeaders.map(norm).filter(Boolean),
    schemes: schemeHeaders.map(norm).filter(Boolean),
    summary: summaryHeaders.map(norm).filter(Boolean),
    transactions: txnHeaders.map(norm).filter(Boolean),
  };

  const sortedHeaders: Record<string, string[]> = {};
  for (const key of Object.keys(sectionHeaders).sort()) {
    sortedHeaders[key] = sectionHeaders[key];
  }
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(sortedHeaders))
    .digest("hex")
    .slice(0, 16);

  const summaryMap = mapHeaders(summaryHeaders, aliases.summary.aliases);
  const schemeMap = mapHeaders(schemeHeaders, aliases.schemes.aliases);
  const contribMap = mapHeaders(contribHeaders, aliases.contributions.aliases);
  const txnMap = mapHeaders(txnHeaders, aliases.transactions.aliases);

  const [legacyHoldings, legacyNavDate] = legacySchemeHoldings(schemeHeaders, schemeRows);
  const legacyTxns = legacyTransactions(sections.transactions, narrations, narrationAliases);

  const missingRaw: Record<string, string[]> = {
    summary: missing(aliases.summary.required, summaryMap),
    schemes: missing(aliases.schemes.required, schemeMap),
    contributions: missing(aliases.contributions.required, contribMap),
    transactions: missing(aliases.transactions.required, txnMap),
  };
  if (legacyHoldings !== null) {
    delete missingRaw.schemes;
  }
  if (legacyTxns !== null) {
    delete missingRaw.transactions;
  }

  const missingFiltered: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(missingRaw)) {
    if (val.length > 0) {
      missingFiltered[key] = val;
    }
  }

  const headerMapping: HeaderMappingRequest | null =
    Object.keys(missingFiltered).length > 0
      ? {
          fingerprint,
          section_headers: sectionHeaders,
          missing_fields: missingFiltered,
        }
      : null;

  const asOf = asOfDate(summaryHeaders, summaryMap);
  const navDate = legacyNavDate ?? findNavDate(schemeHeaders, schemeMap);
  const xirr = parseStatementXirr(summaryHeaders);

  const holdings: HoldingRow[] =
    legacyHoldings !== null
      ? legacyHoldings
      : !missingFiltered.schemes
        ? parseHoldings(schemeRows, schemeMap)
        : [];

  const contributions: ContributionRow[] = !missingFiltered.contributions
    ? parseContributions(contribRows, contribMap)
    : [];

  const [transactions, unknown] =
    legacyTxns !== null
      ? legacyTxns
      : parseTransactions(txnBlocks, txnMap, narrations, narrationAliases);

  const txnDates = transactions.map((row) => row.txn_date).sort();
  const periodStart = txnDates.length > 0 ? txnDates[0] : asOf;
  const periodEnd = txnDates.length > 0 ? txnDates[txnDates.length - 1] : asOf;
  const financialYear = financialYearFor(asOf);
  const filenameYear = filenameFinancialYear(filename);

  const warnings: string[] = [];
  if (headerMapping === null) {
    checkTier(holdings, transactions, tier, warnings);
    checkYear(txnDates, financialYear, warnings);
  }

  return {
    tier,
    financial_year: financialYear,
    filename_year: filenameYear,
    year_mismatch: Boolean(filenameYear && filenameYear !== financialYear),
    pran: subscriber.pran,
    subscriber_name: subscriber.name,
    scheme_choice: subscriber.scheme_choice,
    generation_date: subscriber.generated,
    as_of_date: asOf,
    nav_date: navDate,
    period_start: periodStart,
    period_end: periodEnd,
    holdings_value: parseMoney(cell(summaryValues, summaryMap.holdings_value)) ?? 0.0,
    contribution_count: Math.trunc(parseNumber(cell(summaryValues, summaryMap.contribution_count)) ?? 0),
    total_contribution: parseMoney(cell(summaryValues, summaryMap.total_contribution)) ?? 0.0,
    total_withdrawal: parseMoney(cell(summaryValues, summaryMap.total_withdrawal)) ?? 0.0,
    notional_gain: parseMoney(cell(summaryValues, summaryMap.notional_gain)) ?? 0.0,
    charges: parseMoney(cell(summaryValues, summaryMap.charges)) ?? 0.0,
    xirr,
    holdings,
    contributions,
    transactions,
    fingerprint,
    unknown_narrations: unknown,
    header_mapping: headerMapping,
    warnings,
    needs_header_map: headerMapping !== null,
  };
}

export function financialYearFor(isoDate: string): string {
  const [yStr, mStr] = isoDate.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${pad2((start + 1) % 100)}`;
}

export function filenameFinancialYear(filename: string): string | null {
  const match = filename.match(/(20\d{2})[_-](\d{2})(?:\.[^.]+)?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end !== (start + 1) % 100) return null;
  return `${start}-${pad2(end)}`;
}

export function classifyNarration(
  description: string,
  narrations: Record<string, string[]>,
  extra: Record<string, string>,
): string {
  const text = norm(description);
  if (text in extra) {
    return extra[text];
  }
  const ordered = [
    "switch_out",
    "switch_in",
    "opening",
    "closing",
    "billing",
    "tier2",
    "voluntary",
    "employer",
  ];
  for (const kind of ordered) {
    for (const phrase of narrations[kind] ?? []) {
      if (text.includes(phrase)) {
        return kind;
      }
    }
  }
  return "other";
}

function mergeAliases(
  builtin: Record<string, SectionProfile>,
  extra: Record<string, Record<string, string[]>>,
): Record<string, SectionProfile> {
  const merged: Record<string, SectionProfile> = structuredClone(builtin);
  for (const [section, fields] of Object.entries(extra)) {
    if (!merged[section]) {
      merged[section] = { required: [], aliases: {} };
    }
    const slot = merged[section];
    for (const [fieldName, phrases] of Object.entries(fields)) {
      if (!slot.aliases[fieldName]) {
        slot.aliases[fieldName] = [];
      }
      for (const phrase of phrases) {
        if (!slot.aliases[fieldName].includes(phrase)) {
          slot.aliases[fieldName].push(phrase);
        }
      }
    }
  }
  return merged;
}

function splitSections(lines: string[]): Record<string, string[]> {
  const markers: Array<[string, string]> = [
    ["summary", "investment summary"],
    ["schemes", "investment details"],
    ["contributions", "contribution/redemption"],
    ["transactions", "transaction details"],
  ];
  const found: Array<[string, number]> = [];
  for (let index = 0; index < lines.length; index++) {
    const lowered = compact(lines[index]);
    for (const [key, marker] of markers) {
      if (lowered.startsWith(compact(marker)) && !found.some(([name]) => name === key)) {
        found.push([key, index]);
      }
    }
  }
  const firstIdx = found.length > 0 ? found[0][1] : lines.length;
  const sections: Record<string, string[]> = {
    preamble: lines.slice(0, firstIdx),
  };
  for (let pos = 0; pos < found.length; pos++) {
    const [key, start] = found[pos];
    const end = pos + 1 < found.length ? found[pos + 1][1] : lines.length;
    sections[key] = lines.slice(start + 1, end);
  }
  for (const [key] of markers) {
    if (!sections[key]) {
      sections[key] = [];
    }
  }
  return sections;
}

function tierFromTitle(line: string): string {
  const lowered = norm(line);
  if (lowered.includes("tier ii") || lowered.includes("tier 2")) {
    return "nps_tier2";
  }
  if (lowered.includes("tier i") || lowered.includes("tier 1")) {
    return "nps_tier1";
  }
  throw new Error(`Statement title does not name a tier: ${JSON.stringify(line)}`);
}

function parseSubscriber(lines: string[]): {
  pran: string;
  name: string;
  generated: string | null;
  scheme_choice: string;
} {
  let pran = "";
  let name = "";
  let generated: string | null = null;
  let scheme_choice = "";
  for (const line of lines) {
    const lowered = norm(line);
    if (lowered.startsWith("pran")) {
      const idx = line.indexOf(",");
      if (idx !== -1) {
        pran = line.slice(idx + 1).trim().replace(/^'+/, "");
      }
    } else if (lowered.startsWith("subscriber name")) {
      const idx = line.indexOf(",");
      if (idx !== -1) {
        name = line.slice(idx + 1).trim();
      }
    } else if (lowered.includes("statement generation date")) {
      generated = parseGenerationDate(line);
    } else if (lowered.startsWith("scheme choice")) {
      const idx = line.indexOf("-");
      scheme_choice = idx !== -1 ? line.slice(idx + 1).trim() : line.trim();
    }
  }
  return { pran, name, generated, scheme_choice };
}

function headerAndValues(lines: string[]): [string[], string[]] {
  const rows = lines.filter((line) => line.trim()).map(splitCsv);
  let header: string[] = [];
  let values: string[] = [];
  for (const row of rows) {
    const joined = norm(row.join(" "));
    if (joined.includes("value of your holdings")) {
      header = row;
    } else if (header.length > 0 && parseMoney(row[0] ?? "") !== null) {
      values = row;
      break;
    }
  }
  return [header, values];
}

function parseTable(lines: string[]): [string[], string[][]] {
  const rows = lines.filter((line) => line.trim()).map(splitCsv);
  if (rows.length === 0) return [[], []];
  return [rows[0], rows.slice(1)];
}

function transactionBlocks(
  lines: string[],
): Array<[string, string[], string[][]]> {
  const blocks: Array<[string, string[], string[][]]> = [];
  let scheme = "";
  let headers: string[] = [];
  let body: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isSchemeLine(line) && !line.includes(",")) {
      if (scheme && headers.length > 0) {
        blocks.push([scheme, headers, body]);
      }
      scheme = line.trim();
      headers = [];
      body = [];
      continue;
    }
    const cells = splitCsv(line);
    if (scheme && headers.length === 0 && norm(cells[0] ?? "") === "date") {
      headers = cells;
      continue;
    }
    if (scheme && headers.length > 0) {
      body.push(cells);
    }
  }
  if (scheme && headers.length > 0) {
    blocks.push([scheme, headers, body]);
  }
  return blocks;
}

function isSchemeLine(line: string): boolean {
  const lowered = norm(line);
  return lowered.includes("scheme") && lowered.includes("tier");
}

function parseHoldings(
  rows: string[][],
  mapping: Record<string, number>,
): HoldingRow[] {
  const holdings: HoldingRow[] = [];
  for (const row of rows) {
    const name = cell(row, mapping.particulars).trim();
    if (!name || !isSchemeLine(name)) continue;
    holdings.push({
      scheme_name: name,
      asset_class: assetClass(name),
      units: parseNumber(cell(row, mapping.units)) ?? 0.0,
      statement_nav: parseNumber(cell(row, mapping.nav)) ?? 0.0,
      market_value: parseMoney(cell(row, mapping.scheme_value)) ?? 0.0,
      net_contribution: null,
      scheme_code: null,
    });
  }
  return holdings;
}

function classifyTransaction(
  description: string,
  amount: number | null,
  narrations: Record<string, string[]>,
  extra: Record<string, string>,
): string {
  const kind = classifyNarration(description, narrations, extra);
  if (
    kind === "other" &&
    amount !== null &&
    amount !== 0 &&
    norm(description).includes("rebalancing")
  ) {
    return amount > 0 ? "switch_in" : "switch_out";
  }
  return kind;
}

function legacySchemeHoldings(
  headers: string[],
  rows: string[][],
): [HoldingRow[] | null, string | null] {
  if (
    headers.length < 3 ||
    compact(headers[0]) !== "particulars" ||
    compact(headers[1]) !== "references"
  ) {
    return [null, null];
  }
  const schemeColumns: Array<[number, string]> = [];
  for (let i = 2; i < headers.length; i++) {
    if (isSchemeLine(headers[i])) {
      schemeColumns.push([i, headers[i].trim()]);
    }
  }
  if (schemeColumns.length === 0) return [null, null];

  const metrics: Record<string, string[]> = {};
  let navDate: string | null = null;
  for (const row of rows) {
    const label = compact(cell(row, 0));
    if (label.startsWith("schemewisevalueofyourholdings")) {
      metrics.market_value = row;
    } else if (label.startsWith("schemewisecontributioninyouraccount")) {
      metrics.net_contribution = row;
    } else if (label === "totalunits") {
      metrics.units = row;
    } else if (label.startsWith("navason")) {
      metrics.nav = row;
      navDate = findDate(cell(row, 0));
    }
  }
  if (!metrics.market_value || !metrics.units || !metrics.nav) {
    return [null, null];
  }
  const holdings: HoldingRow[] = [];
  for (const [index, schemeName] of schemeColumns) {
    const marketValue = parseMoney(cell(metrics.market_value, index));
    const units = parseNumber(cell(metrics.units, index));
    const nav = parseNumber(cell(metrics.nav, index));
    if (marketValue === null || units === null || nav === null) {
      throw new Error(
        `Legacy holdings summary is missing a numeric value for ${JSON.stringify(schemeName)}.`,
      );
    }
    holdings.push({
      scheme_name: schemeName,
      asset_class: assetClass(schemeName),
      units,
      statement_nav: nav,
      market_value: marketValue,
      net_contribution: metrics.net_contribution
        ? parseMoney(cell(metrics.net_contribution, index))
        : null,
      scheme_code: null,
    });
  }
  return [holdings, navDate];
}

function legacyTransactions(
  lines: string[],
  narrations: Record<string, string[]>,
  extra: Record<string, string>,
): [SchemeTransactionRow[], string[]] | null {
  const rows = lines.filter((line) => line.trim()).map(splitCsv);
  const headerIndex = rows.findIndex(
    (row) =>
      row.length > 3 &&
      compact(cell(row, 0)) === "date" &&
      ["particulars", "description"].includes(compact(cell(row, 1))) &&
      row.slice(3).some((c) => isSchemeLine(c)),
  );
  if (headerIndex === -1) return null;

  const header = rows[headerIndex];
  const schemeGroups: Record<string, Record<string, number>> = {};
  for (let index = 0; index < header.length; index++) {
    const column = header[index];
    const match = column.match(/^(.+?)\s+(amount|nav|units)(?:\s*\(.*\))?\s*$/i);
    if (!match || !isSchemeLine(match[1])) continue;
    const schemeName = match[1].trim();
    if (!schemeGroups[schemeName]) schemeGroups[schemeName] = {};
    schemeGroups[schemeName][match[2].toLowerCase()] = index;
  }
  const groups = Object.entries(schemeGroups);
  if (
    groups.length === 0 ||
    groups.some(
      ([, g]) => g.amount === undefined || g.nav === undefined || g.units === undefined,
    )
  ) {
    return null;
  }

  const transactions: SchemeTransactionRow[] = [];
  const unknown: string[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const rawDate = cell(row, 0).trim();
    const description = cell(row, 1).trim();
    if (!rawDate || !description || isNote(rawDate)) continue;
    const txnDate = parseDate(rawDate);
    for (const [schemeName, columns] of groups) {
      const amount = parseMoney(cell(row, columns.amount));
      const nav = parseNumber(cell(row, columns.nav));
      const units = parseNumber(cell(row, columns.units));
      if (amount === null && nav === null && units === null) continue;
      const kind = classifyTransaction(description, amount, narrations, extra);
      if (kind === "other" && !unknown.includes(description)) {
        unknown.push(description);
      }
      transactions.push({
        txn_date: txnDate,
        scheme_name: schemeName,
        description,
        narration_kind: kind,
        amount,
        nav,
        units,
      });
    }
  }
  return [transactions, unknown];
}

function parseContributions(
  rows: string[][],
  mapping: Record<string, number>,
): ContributionRow[] {
  const parsed: ContributionRow[] = [];
  for (const row of rows) {
    const rawDate = cell(row, mapping.date).trim();
    if (!rawDate || isNote(rawDate)) continue;
    parsed.push({
      txn_date: parseDate(rawDate),
      particulars: cell(row, mapping.particulars).trim(),
      uploaded_by: cell(row, mapping.uploaded_by).trim(),
      employee_amount: parseMoney(cell(row, mapping.employee)) ?? 0.0,
      employer_amount: parseMoney(cell(row, mapping.employer)) ?? 0.0,
      total: parseMoney(cell(row, mapping.total)) ?? 0.0,
    });
  }
  return parsed;
}

function parseTransactions(
  blocks: Array<[string, string[], string[][]]>,
  mapping: Record<string, number>,
  narrations: Record<string, string[]>,
  extra: Record<string, string>,
): [SchemeTransactionRow[], string[]] {
  const rows: SchemeTransactionRow[] = [];
  const unknown: string[] = [];
  for (const [scheme, _headers, body] of blocks) {
    for (const cells of body) {
      const rawDate = cell(cells, mapping.date).trim();
      const description = cell(cells, mapping.description).trim();
      if (!rawDate || !description) continue;
      const amount = parseMoney(cell(cells, mapping.amount));
      const kind = classifyTransaction(description, amount, narrations, extra);
      if (kind === "other" && !unknown.includes(description)) {
        unknown.push(description);
      }
      rows.push({
        txn_date: parseDate(rawDate),
        scheme_name: scheme,
        description,
        narration_kind: kind,
        amount,
        nav: parseNumber(cell(cells, mapping.nav)),
        units: parseNumber(cell(cells, mapping.units)),
      });
    }
  }
  return [rows, unknown];
}

function mapHeaders(
  cells: string[],
  aliases: Record<string, string[]>,
): Record<string, number> {
  const pairs: Array<[number, string, string]> = [];
  for (const [fieldName, phrases] of Object.entries(aliases)) {
    for (const phrase of phrases) {
      pairs.push([phrase.length, phrase, fieldName]);
    }
  }
  pairs.sort((a, b) => {
    if (b[0] !== a[0]) return b[0] - a[0];
    if (b[1] !== a[1]) return b[1].localeCompare(a[1]);
    return b[2].localeCompare(a[2]);
  });

  const mapping: Record<string, number> = {};
  const usedColumns = new Set<number>();
  for (const [, phrase, fieldName] of pairs) {
    if (fieldName in mapping) continue;
    for (let index = 0; index < cells.length; index++) {
      if (usedColumns.has(index)) continue;
      if (norm(cells[index]).includes(phrase)) {
        mapping[fieldName] = index;
        usedColumns.add(index);
        break;
      }
    }
  }
  return mapping;
}

function missing(required: string[], mapping: Record<string, number>): string[] {
  return required.filter((fieldName) => !(fieldName in mapping));
}

function asOfDate(headers: string[], mapping: Record<string, number>): string {
  const text = cell(headers, mapping.holdings_value) || headers.join(" ");
  const found = findDate(text);
  if (found === null) {
    throw new Error(`Holdings header has no as-of date: ${JSON.stringify(text)}`);
  }
  return found;
}

function findNavDate(headers: string[], mapping: Record<string, number>): string | null {
  const text = cell(headers, mapping.nav) || headers.join(" ");
  return findDate(text);
}

function parseStatementXirr(headers: string[]): number | null {
  for (const cellText of headers) {
    const match = (cellText ?? "").match(/^\s*(\d+(?:\.\d+)?)\s*%\s*$/);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function findDate(text: string): string | null {
  const collapsed = norm(text);
  let match = collapsed.match(/(\d{1,2})-([a-z]{3})-(\d{4})/);
  if (match && MONTHS[match[2]]) {
    return toIsoDate(Number(match[3]), MONTHS[match[2]], Number(match[1]));
  }
  match = collapsed.match(/([a-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (match && MONTHS[match[1]]) {
    return toIsoDate(Number(match[3]), MONTHS[match[1]], Number(match[2]));
  }
  return null;
}

function parseGenerationDate(line: string): string | null {
  const collapsed = line.replace(/\s+/g, " ");
  const match = collapsed.match(/([A-Za-z]+ \d{1,2} \d{4})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?/i);
  if (!match) return null;
  const day = findDate(match[1]);
  if (day === null) return null;
  if (match[2]) {
    const clockMatch = match[2].toUpperCase().replace(/\s+/g, "").match(/^(\d{1,2}):(\d{2})([AP]M)$/);
    if (clockMatch) {
      let hour = Number(clockMatch[1]) % 12;
      if (clockMatch[3] === "PM") hour += 12;
      const minute = Number(clockMatch[2]);
      return `${day}T${pad2(hour)}:${pad2(minute)}`;
    }
  }
  return `${day}T00:00`;
}

function parseDate(value: string): string {
  const found = findDate(value);
  if (found === null) {
    throw new Error(`Unrecognised date: ${JSON.stringify(value)}`);
  }
  return found;
}

function assetClass(name: string): string {
  const match = norm(name).match(/scheme\s+([ecga])\b/);
  return match ? match[1].toUpperCase() : "";
}

function namedTier(name: string): string {
  const lowered = norm(name);
  if (lowered.includes("tier ii") || lowered.includes("tier 2")) {
    return "nps_tier2";
  }
  if (/\btier i\b/.test(lowered) || lowered.includes("tier 1")) {
    return "nps_tier1";
  }
  return "";
}

function checkTier(
  holdings: HoldingRow[],
  transactions: SchemeTransactionRow[],
  tier: string,
  warnings: string[],
): void {
  for (const holding of holdings) {
    const named = namedTier(holding.scheme_name);
    if (named && named !== tier) {
      warnings.push(`Scheme ${holding.scheme_name} does not match ${tier}`);
    }
  }
  for (const row of transactions) {
    const named = namedTier(row.scheme_name);
    if (named && named !== tier) {
      warnings.push(`Transaction scheme ${row.scheme_name} does not match ${tier}`);
    }
  }
}

function checkYear(dates: string[], financialYear: string, warnings: string[]): void {
  for (const day of dates) {
    if (financialYearFor(day) !== financialYear) {
      warnings.push(`${day} falls outside ${financialYear}`);
      return;
    }
  }
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined || index < 0 || index >= row.length) {
    return "";
  }
  return row[index];
}

function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isNote(value: string): boolean {
  return norm(value).startsWith("note");
}

function parseMoney(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  let text = value.trim();
  if (text === "" || text === "--") return null;
  const negative = text.startsWith("(") && text.endsWith(")");
  text = text
    .replace(/^\(+|\)+$/g, "")
    .replace(/rs/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function parseNumber(value: string | null | undefined): number | null {
  return parseMoney(value);
}
