import crypto from "node:crypto";
import { familyPortfolio } from "./analytics.ts";
import { db } from "./db.ts";
import {
  buildExportBuffer,
  holdingRecords,
  transactionRecords,
} from "./export.ts";
import type { FundNav, ParseResult, PortfolioDisclosure } from "./models.ts";
import { fetchLatest, matchScheme } from "./nav.ts";
import { parseNpsText } from "./parsers/nps.ts";

export class ImportRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRejected";
  }
}

function norm(value: string): string {
  return value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function parseStatement(filename: string, content: string): ParseResult {
  const aliases = db.narrationAliasMap();
  let result = parseNpsText(content, filename, { narrationAliases: aliases });
  const saved = db.profileMapping(result.fingerprint);
  if (saved && result.needs_header_map) {
    result = parseNpsText(content, filename, {
      extraAliases: JSON.parse(saved),
      narrationAliases: aliases,
    });
  }
  return result;
}

export function saveStatement(
  filename: string,
  content: string,
  options: {
    confirmYear: boolean;
    narrationMap: Record<string, string>;
  },
): number {
  const result = parseStatement(filename, content);
  if (result.needs_header_map) {
    throw new ImportRejected("Map the unrecognised headers before saving.");
  }
  const missingNarrations = result.unknown_narrations.filter(
    (item) => !(norm(item) in options.narrationMap),
  );
  if (missingNarrations.length > 0) {
    throw new ImportRejected("Name each new narration before saving.");
  }
  if (result.year_mismatch && !options.confirmYear) {
    throw new ImportRejected("Confirm the financial year before saving.");
  }
  if (result.warnings.length > 0) {
    throw new ImportRejected(result.warnings.join(" "));
  }

  const fileHash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  if (db.fileHashExists(fileHash)) {
    throw new ImportRejected("This file has already been imported.");
  }

  for (const [phrase, kind] of Object.entries(options.narrationMap)) {
    db.saveNarrationAlias(phrase, kind);
    for (const row of result.transactions) {
      if (norm(row.description) === phrase && row.narration_kind === "other") {
        row.narration_kind = kind;
      }
    }
  }

  return db.saveImport(result, filename, fileHash);
}

export function saveHeaderProfile(
  fingerprint: string,
  extraAliases: Record<string, Record<string, string[]>>,
): void {
  db.saveProfile(fingerprint, JSON.stringify(extraAliases));
}

export async function refreshNavs(funds?: FundNav[]): Promise<{
  linked: string[];
  ambiguous: Array<{ statement_name: string; codes: string[] }>;
  unmatched: string[];
  catalog: FundNav[];
}> {
  const catalog = funds ?? (await fetchLatest());
  db.saveNavQuotes(catalog);
  db.applySavedLinks();

  const names = db.distinctHoldingSchemeNames();
  const ambiguous: Array<{ statement_name: string; codes: string[] }> = [];
  const unmatched: string[] = [];
  const linked: string[] = [];

  for (const name of names) {
    const match = matchScheme(name, catalog);
    if (match.unique !== null) {
      db.setSchemeCode(name, match.unique.scheme_code);
      linked.push(name);
    } else if (match.matches.length > 0) {
      ambiguous.push({
        statement_name: name,
        codes: match.matches.map((item) => item.scheme_code),
      });
    } else {
      unmatched.push(name);
    }
  }

  return { linked, ambiguous, unmatched, catalog };
}

export function saveSecurityDisclosure(disclosure: PortfolioDisclosure): void {
  db.saveSecurityDisclosure(disclosure);
}

export function exportHoldingsBuffer(
  format: "xlsx" | "csv",
  importId?: number | null,
  memberId?: string | null,
): Buffer {
  let rows;
  if (importId) {
    rows = db.holdingsForImport(importId);
  } else {
    const baseRows = db.currentHoldingRows();
    const analytics = familyPortfolio();
    const metrics = new Map(
      analytics.positions.map((pos) => [
        `${pos.member_id}::${pos.tier}::${pos.scheme_name}`,
        pos,
      ]),
    );
    rows = baseRows.map((row) => {
      const metric = metrics.get(`${row.member_id}::${row.tier}::${row.scheme_name}`);
      if (!metric) return row;
      return {
        ...row,
        net_invested: metric.net_invested,
        invested_complete: metric.invested_complete,
        calculated_xirr: metric.calculated_xirr,
        reported_xirr: metric.reported_xirr,
      };
    });
  }
  if (memberId) {
    rows = rows.filter((row) => row.member_id === memberId);
  }
  return buildExportBuffer(
    holdingRecords(rows) as unknown as Array<Record<string, unknown>>,
    format,
  );
}

export function exportTransactionsBuffer(
  format: "xlsx" | "csv",
  importId?: number | null,
  memberId?: string | null,
): Buffer {
  if (importId) {
    const rows = db.transactionsForImport(importId);
    const fy = db.getImportFinancialYear(importId);
    const records = transactionRecords(rows).map((r) => ({
      ...r,
      financial_year: fy,
    }));
    return buildExportBuffer(
      records as unknown as Array<Record<string, unknown>>,
      format,
    );
  }
  let rows = db.allCurrentTransactions();
  if (memberId) {
    rows = rows.filter((row) => row.member_id === memberId);
  }
  return buildExportBuffer(
    transactionRecords(rows) as unknown as Array<Record<string, unknown>>,
    format,
  );
}
