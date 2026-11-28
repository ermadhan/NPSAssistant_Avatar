import * as XLSX from "xlsx";
import type { PortfolioDisclosure, SecurityPosition } from "./models.ts";
import type { EnrichedHoldingRow, EnrichedSecurityRow } from "./db.ts";

export const ICICI_DISCLOSURE_PAGE =
  "https://www.icicipension.in/public_disclosure/portfolio_details";
export const ICICI_PORTFOLIO_API =
  "https://api.icicipension.in/get_check/portfolio";
export const LIC_DISCLOSURE_PAGE =
  "https://www.licpensionfund.in/portfolio-disclosures";
export const HDFC_DISCLOSURE_PAGE =
  "https://www.hdfcpension.com/public-disclosures/";
export const SBI_DISCLOSURE_PAGE =
  "https://www.sbipensionfunds.co.in/disclosures/portfolio-details/";
export const SBI_PAGE_DATA_URL =
  "https://www.sbipensionfunds.co.in/page-data/disclosures/portfolio-details/page-data.json";

const SUPPORTED_SCHEMES: Array<[string, string]> = [
  ["E", "nps_tier1"],
  ["E", "nps_tier2"],
  ["C", "nps_tier1"],
  ["C", "nps_tier2"],
  ["G", "nps_tier1"],
  ["G", "nps_tier2"],
];

const MONTH_ABBR = [
  "",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const MONTHS_FULL: Record<string, number> = {
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

export async function fetchLatestIciciDisclosure(
  today?: Date,
): Promise<PortfolioDisclosure> {
  const current = today ?? new Date();
  const requestHeaders = { "User-Agent": "NPS-Family-Portfolio/1.0" };
  const failures: string[] = [];

  for (let monthOffset = 0; monthOffset < 7; monthOffset++) {
    const monthIndex = current.getMonth() - monthOffset;
    const year = current.getFullYear() + Math.floor(monthIndex / 12);
    const month = (((monthIndex % 12) + 12) % 12) + 1;
    const monthName = MONTH_ABBR[month];
    const apiUrl = `${ICICI_PORTFOLIO_API}/${monthName}/${year}`;

    let payload: unknown;
    try {
      const resp = await fetch(apiUrl, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.status === 404) continue;
      if (!resp.ok) {
        failures.push(`${monthName} ${year}: HTTP ${resp.status}`);
        continue;
      }
      payload = await resp.json();
    } catch (err) {
      failures.push(`${monthName} ${year}: ${String(err)}`);
      continue;
    }

    const fileUrl = disclosureFileUrl(payload);
    if (!fileUrl) continue;

    try {
      const fileResp = await fetch(fileUrl, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(60_000),
      });
      if (!fileResp.ok) {
        failures.push(`${monthName} ${year} workbook: HTTP ${fileResp.status}`);
        continue;
      }
      const workbook = Buffer.from(await fileResp.arrayBuffer());
      const filename = disclosureFilename(payload);
      return parseManagerWorkbook(workbook, "ICICI", ICICI_DISCLOSURE_PAGE, filename);
    } catch (err) {
      failures.push(`${monthName} ${year} workbook: ${String(err)}`);
      continue;
    }
  }

  const detail = failures.join("; ");
  const suffix = detail ? ` Details: ${detail}` : "";
  throw new Error(
    `No official ICICI portfolio disclosure was available for the latest seven months.${suffix}`,
  );
}

export async function fetchLatestHdfcDisclosure(): Promise<PortfolioDisclosure> {
  const html = await fetchText(HDFC_DISCLOSURE_PAGE);
  const links = parseDisclosureLinks(html, HDFC_DISCLOSURE_PAGE);
  const link = links.find(
    (item) =>
      item.href.toLowerCase().includes("monthly-website-forms") &&
      item.href.toLowerCase().endsWith(".xlsx"),
  );
  if (!link) {
    throw new Error("No monthly HDFC NPS portfolio workbook was found.");
  }
  const workbook = await fetchBuffer(link.href);
  const filename = link.href.split("/").pop() || "portfolio.xlsx";
  return parseManagerWorkbook(workbook, "HDFC", HDFC_DISCLOSURE_PAGE, filename);
}

export async function fetchLatestLicDisclosure(): Promise<PortfolioDisclosure> {
  const html = await fetchText(LIC_DISCLOSURE_PAGE, "NPS-Family-Portfolio/1.0");
  const links = parseDisclosureLinks(html, LIC_DISCLOSURE_PAGE);
  const workbooks = new Map<string, { url: string; buffer: Buffer; scheme: [string, string] }>();

  for (const link of links) {
    if (!link.href.toLowerCase().endsWith(".xlsx")) continue;
    const match = link.label.match(/\b([ECG])\s*TIER\s*([12])\s+SCHEME\b/i);
    if (!match) continue;
    const scheme: [string, string] = [
      match[1].toUpperCase(),
      match[2] === "1" ? "nps_tier1" : "nps_tier2",
    ];
    const key = `${scheme[0]}::${scheme[1]}`;
    if (!workbooks.has(key)) {
      const buffer = await fetchBuffer(link.href, "NPS-Family-Portfolio/1.0");
      workbooks.set(key, { url: link.href, buffer, scheme });
    }
  }

  const missing = SUPPORTED_SCHEMES.filter(
    ([asset, tier]) => !workbooks.has(`${asset}::${tier}`),
  );
  if (missing.length > 0) {
    const names = missing
      .map(([a, t]) => `${a} ${t}`)
      .sort()
      .join(", ");
    throw new Error(
      `The LIC disclosure page did not provide all six supported scheme workbooks; missing: ${names}.`,
    );
  }

  const positions: SecurityPosition[] = [];
  let disclosureDate: string | null = null;
  for (const { url, buffer, scheme } of workbooks.values()) {
    const parsed = parseManagerWorkbook(
      buffer,
      "LIC",
      LIC_DISCLOSURE_PAGE,
      url.split("/").pop() || "portfolio.xlsx",
      scheme,
    );
    if (disclosureDate !== null && parsed.as_of_date !== disclosureDate) {
      throw new Error("LIC scheme workbooks contain inconsistent disclosure dates.");
    }
    disclosureDate = parsed.as_of_date;
    positions.push(...parsed.positions);
  }

  return {
    fund_manager: "LIC",
    as_of_date: disclosureDate!,
    source_url: LIC_DISCLOSURE_PAGE,
    positions,
  };
}

interface SbiReportCandidate {
  url: string;
  name: string;
  score: number;
  index: number;
}

function parseSbiReportScore(text: string): number {
  const normalized = text.replace(/[_-]+/g, " ");
  let month = 0;
  for (const [token, num] of Object.entries(MONTHS_FULL)) {
    const re = new RegExp(`\\b${token}(?:\\s*|\\d{2,4}\\b)`, "i");
    if (re.test(normalized)) {
      month = num;
      break;
    }
  }
  const yearMatch4 = normalized.match(/\b(20\d{2})\b/);
  const yearMatch2 = normalized.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*(\d{2})\b/i);
  let year = 0;
  if (yearMatch4) {
    year = Number(yearMatch4[1]);
  } else if (yearMatch2) {
    year = 2000 + Number(yearMatch2[1]);
  }
  return year > 0 && month > 0 ? year * 100 + month : 0;
}

async function fetchSbiSessionHeaders(): Promise<Record<string, string>> {
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const initResp = await fetch(SBI_DISCLOSURE_PAGE, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
  });
  if (!initResp.ok) {
    throw new Error(`HTTP ${initResp.status} accessing ${SBI_DISCLOSURE_PAGE}`);
  }
  const initHtml = await initResp.text();

  if (!initHtml.includes("Fingerprint=")) {
    return { "User-Agent": userAgent };
  }

  const jar = new Map<string, string>();
  const addCookies = (rawList: string[]) => {
    for (const raw of rawList) {
      const pair = raw.split(";")[0]?.trim() ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const key = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      if (val) jar.set(key, val);
    }
  };
  addCookies(initResp.headers.getSetCookie?.() ?? []);

  const fpPayload = {
    version: 1,
    src: "",
    userAgent,
    checks: {
      "1000": userAgent.replace("Mozilla/", ""),
      "1001": 5,
      "1002": 1,
      "1003": 4,
      "1004": 1,
      "1005": 2,
      "1006": "en-US",
      "1007": { permission: "default", state: {} },
      "1008": null,
      "1009": "Mozilla",
      "1010": "Netscape",
      "1100": { width: 1440, height: 900 },
      "1101": false,
      "1102": {},
      "1103": null,
      "1104": null,
      "1105": null,
      "1106": null,
      "1107": null,
      "1108": null,
      "1109": null,
      "1110": null,
      "1111": false,
      "1900": 50,
      "1200": { width: 0, height: 0 },
    },
  };

  const verifyUrl =
    "https://www.sbipensionfunds.co.in/__verify/fp?url=%2Fdisclosures%2Fportfolio-details%2F";
  const fpResp = await fetch(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      Cookie: Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
    body: JSON.stringify(fpPayload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!fpResp.ok) {
    throw new Error(`SBI session verification returned HTTP ${fpResp.status}`);
  }
  const ttlText = await fpResp.text();
  addCookies(fpResp.headers.getSetCookie?.() ?? []);
  const ttlSeconds = Number(ttlText) || 300;
  jar.set("__hd_fingerprint", String(Date.now() + ttlSeconds * 1000));

  return {
    "User-Agent": userAgent,
    Cookie: Array.from(jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
  };
}

export async function fetchLatestSbiDisclosure(): Promise<PortfolioDisclosure> {
  const headers = await fetchSbiSessionHeaders();
  const pageDataResp = await fetch(SBI_PAGE_DATA_URL, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!pageDataResp.ok) {
    throw new Error(`HTTP ${pageDataResp.status} fetching SBI disclosure index.`);
  }
  const pageData = (await pageDataResp.json()) as {
    result?: {
      pageContext?: {
        englishPageData?: {
          disclosureSubData?: {
            upload_pdf?: {
              data?: {
                attributes?: {
                  Reports?: Array<{
                    Title?: string;
                    pdf?: {
                      data?: {
                        attributes?: { url?: string; name?: string };
                      };
                    };
                  }>;
                };
              };
            };
          };
        };
      };
    };
  };

  const candidates: SbiReportCandidate[] = [];
  const reports =
    pageData.result?.pageContext?.englishPageData?.disclosureSubData?.upload_pdf?.data
      ?.attributes?.Reports ?? [];

  for (let idx = 0; idx < reports.length; idx++) {
    const attrs = reports[idx]?.pdf?.data?.attributes;
    const url = attrs?.url ? String(attrs.url) : "";
    const name = attrs?.name ? String(attrs.name) : url.split("/").pop() || "";
    if (!/\.(?:xlsx|xls)$/i.test(url)) continue;
    const score = parseSbiReportScore(`${reports[idx]?.Title ?? ""} ${name} ${url}`);
    candidates.push({ url, name, score, index: idx });
  }

  if (candidates.length === 0) {
    const raw = JSON.stringify(pageData);
    const fallbackUrls = Array.from(
      new Set([...raw.matchAll(/\/uploads\/[^"\\]+\.(?:xlsx|xls)/gi)].map((m) => m[0])),
    );
    fallbackUrls.forEach((url, idx) => {
      const name = url.split("/").pop() || "portfolio.xlsx";
      candidates.push({
        url,
        name,
        score: parseSbiReportScore(`${name} ${url}`),
        index: idx,
      });
    });
  }

  if (candidates.length === 0) {
    throw new Error("No monthly SBI NPS portfolio workbook was found.");
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.index - a.index;
  });

  const latest = candidates[0];
  const fileUrl = new URL(latest.url, SBI_DISCLOSURE_PAGE).toString();
  const fileResp = await fetch(fileUrl, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!fileResp.ok) {
    throw new Error(`HTTP ${fileResp.status} fetching ${fileUrl}`);
  }
  const workbook = Buffer.from(await fileResp.arrayBuffer());
  return parseManagerWorkbook(workbook, "SBI", SBI_DISCLOSURE_PAGE, latest.name);
}

interface DisclosureLink {
  href: string;
  label: string;
}

function parseDisclosureLinks(html: string, baseUrl: string): DisclosureLink[] {
  const links: DisclosureLink[] = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const attrs = match[1];
    const innerHtml = match[2];
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "") : "";
    if (!rawHref.trim()) continue;
    let resolvedHref: string;
    try {
      resolvedHref = new URL(rawHref.trim(), baseUrl).toString();
    } catch {
      continue;
    }
    const ariaMatch = attrs.match(/\baria-label\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const ariaLabel = ariaMatch ? (ariaMatch[1] ?? ariaMatch[2] ?? "") : "";
    const text = innerHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const label = `${ariaLabel} ${text}`.trim();
    links.push({ href: resolvedHref, label });
  }
  return links;
}

async function fetchText(url: string, userAgent?: string): Promise<string> {
  const buf = await fetchBuffer(url, userAgent);
  return buf.toString("utf-8");
}

async function fetchBuffer(url: string, userAgent?: string): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (userAgent) headers["User-Agent"] = userAgent;
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export function parseManagerWorkbook(
  workbookBuffer: Buffer,
  fundManager: string,
  sourceUrl: string,
  _filename: string = "portfolio.xlsx",
  schemeOverride?: [string, string],
): PortfolioDisclosure {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(workbookBuffer, { type: "buffer", cellDates: true });
  } catch (err) {
    throw new Error(`Could not read the ${fundManager} portfolio workbook: ${String(err)}`);
  }

  const positions: SecurityPosition[] = [];
  let disclosureDate: string | null = null;

  for (const sheetName of workbook.SheetNames) {
    const scheme = schemeOverride ?? parseSchemeSheet(sheetName);
    if (!scheme) continue;
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    const [sheetDate, sheetPositions] = parseSchemeSheetRows(rows, scheme);
    if (sheetPositions.length > 0) {
      if (disclosureDate !== null && sheetDate !== disclosureDate) {
        throw new Error(
          `${fundManager} portfolio sheets contain inconsistent disclosure dates.`,
        );
      }
      disclosureDate = sheetDate;
      positions.push(...sheetPositions);
    }
    if (schemeOverride) break;
  }

  if (positions.length === 0 || disclosureDate === null) {
    throw new Error(
      `The ${fundManager} workbook did not contain supported Tier 1/Tier 2 E, C, or G holdings.`,
    );
  }

  return {
    fund_manager: fundManager,
    as_of_date: disclosureDate,
    source_url: sourceUrl,
    positions,
  };
}

export function buildSecurityExposure(
  holdings: EnrichedHoldingRow[],
  disclosureRows: EnrichedSecurityRow[],
  memberId?: string | null,
): {
  positions: Array<{
    security_name: string;
    isin: string;
    industry: string;
    instrument_type: string;
    exposure: number;
    schemes: string[];
    portfolio_weight: number;
  }>;
  total_value: number;
  covered_value: number;
  coverage: number;
  unsupported: Record<string, number>;
  disclosure_date: string | null;
} {
  const disclosures = new Map<string, EnrichedSecurityRow[]>();
  for (const row of disclosureRows) {
    const key = `${row.fund_manager}::${row.scheme_asset}::${row.tier}`;
    const list = disclosures.get(key) ?? [];
    list.push(row);
    disclosures.set(key, list);
  }

  const positions = new Map<
    string,
    {
      security_name: string;
      isin: string;
      industry: string;
      instrument_type: string;
      exposure: number;
      schemes: Set<string>;
    }
  >();

  let coveredValue = 0.0;
  const unsupported: Record<string, number> = {};
  let totalValue = 0.0;

  const selectedHoldings = holdings.filter(
    (row) => !memberId || row.member_id === memberId,
  );

  for (const holding of selectedHoldings) {
    const name = String(holding.scheme_name);
    const price =
      holding.latest_nav !== null ? Number(holding.latest_nav) : Number(holding.statement_nav);
    const value = Number(holding.units) * price;
    totalValue += value;

    const schemeAsset = assetFromSchemeName(name);
    const fundManager = fundManagerFromSchemeName(name);
    const schemeKey =
      fundManager && schemeAsset ? `${fundManager}::${schemeAsset}::${holding.tier}` : null;
    const data = schemeKey ? (disclosures.get(schemeKey) ?? []) : [];
    if (data.length === 0) {
      unsupported[name] = (unsupported[name] ?? 0) + value;
      continue;
    }

    coveredValue += value;
    for (const security of data) {
      const isin = String(security.isin || "").trim();
      const securityName = String(security.security_name || "").trim();
      const securityKey = isin
        ? `isin::${isin.toUpperCase()}`
        : `name::${securityName.replace(/\W+/g, "").toUpperCase()}`;

      let item = positions.get(securityKey);
      if (!item) {
        item = {
          security_name: securityName,
          isin,
          industry: security.industry || "",
          instrument_type: security.instrument_type,
          exposure: 0.0,
          schemes: new Set<string>(),
        };
        positions.set(securityKey, item);
      }
      item.exposure += value * Number(security.portfolio_weight);
      item.schemes.add(name);
    }
  }

  const resultPositions = Array.from(positions.values())
    .map((item) => ({
      security_name: item.security_name,
      isin: item.isin,
      industry: item.industry,
      instrument_type: item.instrument_type,
      exposure: item.exposure,
      schemes: Array.from(item.schemes).sort(),
      portfolio_weight: totalValue === 0 ? 0.0 : item.exposure / totalValue,
    }))
    .sort((a, b) => b.exposure - a.exposure);

  const dates = Array.from(
    new Set(disclosureRows.map((r) => r.disclosure_date).filter(Boolean)),
  ).sort();

  return {
    positions: resultPositions,
    total_value: totalValue,
    covered_value: coveredValue,
    coverage: totalValue === 0 ? 0.0 : coveredValue / totalValue,
    unsupported,
    disclosure_date: dates.length > 0 ? dates[dates.length - 1] : null,
  };
}

function disclosureFileUrl(payload: unknown): string | null {
  try {
    const p = payload as {
      data?: Array<{ attributes?: { Scheme_Details?: { data?: { attributes?: { url?: string } } } } }>;
    };
    const url = p.data?.[0]?.attributes?.Scheme_Details?.data?.attributes?.url;
    return url ? String(url) : null;
  } catch {
    return null;
  }
}

function disclosureFilename(payload: unknown): string {
  try {
    const p = payload as {
      data?: Array<{ attributes?: { Scheme_Details?: { data?: { attributes?: { name?: string } } } } }>;
    };
    const name = p.data?.[0]?.attributes?.Scheme_Details?.data?.attributes?.name;
    return name ? String(name) : "portfolio.xls";
  } catch {
    return "portfolio.xls";
  }
}

function parseSchemeSheet(sheetName: string): [string, string] | null {
  const normalized = sheetName.trim().toLowerCase().replace(/\s+/g, " ").replace(/l/g, "i");
  const match = normalized.match(/\bscheme\s+([ecg])\b.*\btier[\s-]*(i{1,2}|[12])\b/);
  if (!match) return null;
  const schemeAsset = match[1].toUpperCase();
  const tierToken = match[2];
  const tier = tierToken === "i" || tierToken === "1" ? "nps_tier1" : "nps_tier2";
  return [schemeAsset, tier];
}

function extractColumnsFromHeader(values: string[]): Record<string, number> {
  const marketValueCol = values.findIndex(
    (value) =>
      value.endsWith("market value") ||
      value === "mkt_value" ||
      value === "mkt value",
  );
  const nameCol = values.includes("particulars")
    ? values.indexOf("particulars")
    : values.indexOf("name of instruments");
  return {
    name: nameCol,
    market_value: marketValueCol,
    weight: values.findIndex(
      (value) => value === "% of portfolio" || value === "percentage of portfolio",
    ),
    isin: values.findIndex((value) => value.startsWith("isin")),
    industry: values.findIndex((value) => value === "industry"),
    quantity: values.findIndex(
      (value) => value === "quantity" || value === "no of units",
    ),
    rating: values.findIndex((value) => value.startsWith("rating")),
  };
}

function isHoldingHeaderRow(values: string[]): boolean {
  return (
    (values.includes("particulars") || values.includes("name of instruments")) &&
    values.some(
      (value) =>
        value.endsWith("market value") ||
        value === "mkt_value" ||
        value === "mkt value",
    )
  );
}

function parseSchemeSheetRows(
  rows: unknown[][],
  scheme: [string, string],
): [string, SecurityPosition[]] {
  let headerRow = -1;
  let columns: Record<string, number> = {};

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? [];
    const values = row.map(normalizeCell);
    if (isHoldingHeaderRow(values)) {
      headerRow = index;
      columns = extractColumnsFromHeader(values);
      break;
    }
  }

  if (headerRow === -1) {
    throw new Error("A scheme worksheet is missing its portfolio table header.");
  }

  let disclosureDate: string | null = null;
  for (let i = 0; i < headerRow; i++) {
    const row = rows[i] ?? [];
    const dateLabel = normalizeCell(row[0]);
    if (/^(?:portfolio )?statements? as on\b/.test(dateLabel)) {
      const candidates: unknown[] = [
        row.length > 1 ? row[1] : null,
        String(row[0] ?? "").replace(
          /^(?:portfolio )?statements? as on\s*:?\s*/i,
          "",
        ),
      ];
      for (const candidate of candidates) {
        const parsed = asDate(candidate);
        if (parsed !== null) {
          disclosureDate = parsed;
          break;
        }
      }
      if (disclosureDate !== null) break;
    }
  }

  if (disclosureDate === null) {
    throw new Error("A pension-fund scheme worksheet is missing its portfolio date.");
  }

  let totalValue: number | null = null;
  for (const row of rows.slice(headerRow + 1)) {
    const labels = (row ?? []).map(normalizeCell);
    if (labels.some((label) => label.startsWith("grand total"))) {
      totalValue = toNumber(cellAt(row, columns.market_value));
      break;
    }
    if (labels[0] === "total aum") {
      totalValue = toNumber(cellAt(row, 1));
      break;
    }
  }

  const records: SecurityPosition[] = [];
  let instrumentType = "Other";
  for (let i = 0; i < headerRow; i++) {
    const label = normalizeCell((rows[i] ?? [])[0]);
    const section = sectionInstrumentType(label);
    if (section !== null) {
      instrumentType = section;
    }
  }

  for (const row of rows.slice(headerRow + 1)) {
    const labels = (row ?? []).map(normalizeCell);
    if (
      labels.some((label) => label.startsWith("grand total")) ||
      labels[0] === "total aum"
    ) {
      break;
    }
    if (isHoldingHeaderRow(labels)) {
      columns = extractColumnsFromHeader(labels);
      continue;
    }
    if (labels.some((label) => label.includes("subtotal") || label === "total")) continue;

    const name = toStringVal(cellAt(row, columns.name));
    const normalizedName = normalizeCell(name);
    if (!normalizedName) continue;

    if (normalizedName === "net current assets") {
      const ncaValue =
        toNumber(cellAt(row, columns.market_value)) ?? toNumber(cellAt(row, 1));
      let ncaWeight =
        (columns.weight >= 0 ? toNumber(cellAt(row, columns.weight)) : null) ??
        toNumber(cellAt(row, 2));
      if (ncaWeight === null && ncaValue !== null && totalValue) {
        ncaWeight = ncaValue / totalValue;
      }
      if (ncaValue !== null && ncaWeight !== null) {
        if (totalValue && totalValue > 0 && ncaValue !== 0) {
          const approxRatio = ncaValue / totalValue;
          if (
            Math.abs(ncaWeight / 100 - approxRatio) <
            Math.abs(ncaWeight - approxRatio)
          ) {
            ncaWeight /= 100;
          }
        } else if (Math.abs(ncaWeight) > 1 && Math.abs(ncaWeight) <= 100) {
          ncaWeight /= 100;
        }
        if (ncaWeight >= -1 && ncaWeight <= 1) {
          records.push({
            scheme_asset: scheme[0],
            tier: scheme[1],
            security_name: name,
            isin: "",
            industry: "",
            instrument_type: "Money market",
            quantity: null,
            market_value: ncaValue,
            portfolio_weight: ncaWeight,
            rating: "",
          });
        }
      }
      continue;
    }

    const sectionType = sectionInstrumentType(normalizedName);
    const marketValue = toNumber(cellAt(row, columns.market_value));
    if (sectionType !== null && marketValue === null) {
      instrumentType = sectionType;
      continue;
    }
    if (
      normalizedName === "equity oriented mutual fund schemes" ||
      normalizedName === "government securities and related investments"
    ) {
      continue;
    }
    if (
      marketValue === null ||
      [
        "particulars",
        "name of instruments",
        "equity instruments",
        "debt instruments",
        "government securities",
        "money market instruments",
      ].includes(normalizedName)
    ) {
      continue;
    }

    const rating = toStringVal(cellAt(row, columns.rating));
    const isin = toStringVal(cellAt(row, columns.isin));

    let securityType: string;
    if (
      normalizedName.startsWith("cash/") ||
      ["overnight fund", "liquid fund", "treps", "trep/"].some((term) =>
        normalizedName.includes(term),
      )
    ) {
      securityType = "Money market";
    } else if (rating.toUpperCase() === "SOV" || isGovernmentSecurity(name, isin)) {
      securityType = "Government bond";
    } else if (instrumentType === "Equity") {
      securityType = "Equity";
    } else if (instrumentType === "Corporate bond") {
      securityType = "Corporate bond";
    } else if (instrumentType === "Money market") {
      securityType = "Money market";
    } else {
      securityType = instrumentType;
    }

    let weight =
      columns.weight >= 0 ? toNumber(cellAt(row, columns.weight)) : null;
    if (weight === null && totalValue) {
      weight = marketValue / totalValue;
    }
    if (weight === null) continue;
    if (totalValue && totalValue > 0 && marketValue !== 0) {
      const approxRatio = marketValue / totalValue;
      if (
        Math.abs(weight / 100 - approxRatio) <
        Math.abs(weight - approxRatio)
      ) {
        weight /= 100;
      }
    } else if (weight > 1 && weight <= 100) {
      weight /= 100;
    }
    if (weight < -1 || weight > 1) {
      throw new Error(`Invalid portfolio weight for ${JSON.stringify(name)}: ${weight}`);
    }

    records.push({
      scheme_asset: scheme[0],
      tier: scheme[1],
      security_name: name,
      isin,
      industry: toStringVal(cellAt(row, columns.industry)),
      instrument_type: securityType,
      quantity: toNumber(cellAt(row, columns.quantity)),
      market_value: marketValue,
      portfolio_weight: weight,
      rating,
    });
  }

  if (records.length === 0) {
    throw new Error("A pension-fund scheme worksheet has no readable security rows.");
  }

  const weightTotal = records.reduce((sum, r) => sum + r.portfolio_weight, 0);
  if (Math.abs(weightTotal - 1.0) > 0.02) {
    throw new Error(
      `Scheme portfolio weights sum to ${(weightTotal * 100).toFixed(2)}%, not approximately 100%.`,
    );
  }

  return [disclosureDate, records];
}

function sectionInstrumentType(label: string): string | null {
  if (
    label.includes("equity instruments") ||
    label === "equity" ||
    label.startsWith("equities and related investments")
  ) {
    return "Equity";
  }
  if (
    label.includes("short-term debt") ||
    label.includes("money market instruments") ||
    label.includes("treasury bill") ||
    label.includes("commercial paper") ||
    label.includes("overnight funds")
  ) {
    return "Money market";
  }
  if (
    label.includes("government securit") ||
    label.includes("state government loans") ||
    label.includes("central government security")
  ) {
    return "Government bond";
  }
  if (
    label.includes("debt instruments") ||
    label.includes("bond") ||
    label.includes("ncd") ||
    label === "debt"
  ) {
    return "Corporate bond";
  }
  if (
    label.includes("real estate investment trust units") ||
    label.includes("mutual fund units") ||
    label.includes("asset backed")
  ) {
    return "Other";
  }
  if (label.includes("alternative investment") || label.startsWith("other ")) {
    return "Other";
  }
  return null;
}

function isGovernmentSecurity(name: string, isin: string): boolean {
  const normalized = normalizeCell(name);
  const upperIsin = isin.toUpperCase();
  return (
    normalized.includes("government security") ||
    normalized.includes("state government") ||
    ` ${normalized}`.includes(" gsec") ||
    upperIsin.startsWith("IN002")
  );
}

function assetFromSchemeName(name: string): string | null {
  const match = name.toUpperCase().match(/\bSCHEME\s+([ECG])\b/);
  return match ? match[1] : null;
}

function fundManagerFromSchemeName(name: string): string | null {
  const upper = name.toUpperCase();
  for (const fm of ["ICICI", "HDFC", "LIC", "SBI"]) {
    if (upper.includes(fm)) return fm;
  }
  return null;
}

function cellAt(row: unknown[] | undefined, index: number): unknown {
  if (!row || index < 0 || index >= row.length) return null;
  return row[index];
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().toLowerCase().replace(/\.+$/, "");
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "—") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function toStringVal(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return text;

  match = text.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/);
  if (match && MONTHS_FULL[match[2].toLowerCase()]) {
    const m = String(MONTHS_FULL[match[2].toLowerCase()]).padStart(2, "0");
    const d = match[1].padStart(2, "0");
    return `${match[3]}-${m}-${d}`;
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match && MONTHS_FULL[match[2].toLowerCase()]) {
    const m = String(MONTHS_FULL[match[2].toLowerCase()]).padStart(2, "0");
    const d = match[1].padStart(2, "0");
    return `${match[3]}-${m}-${d}`;
  }

  return null;
}
