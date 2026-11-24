import type { FundNav, SchemeMatch } from "./models.ts";

export const LATEST_URL = "https://npsnav.in/api/latest";

const FAMILIES = [
  "ICICI",
  "HDFC",
  "KOTAK",
  "ADITYA BIRLA",
  "BIRLA",
  "TATA",
  "AXIS",
  "DSP",
  "MAX LIFE",
  "UTI",
  "LIC",
  "SBI",
];

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export async function fetchLatest(url: string = LATEST_URL): Promise<FundNav[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "nps-portfolio" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`npsnav.in returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>;
  };
  const funds: FundNav[] = [];
  for (const row of payload.data ?? []) {
    funds.push({
      scheme_code: String(row["Scheme Code"]),
      scheme_name: String(row["Scheme Name"]),
      nav: Number(row["NAV"]),
      nav_date: parseNavDate(String(row["Last Updated"])),
    });
  }
  return funds;
}

export function matchScheme(statementName: string, funds: FundNav[]): SchemeMatch {
  const wanted = identity(statementName);
  const matches = funds.filter((fund) => {
    const candidate = identity(fund.scheme_name);
    return (
      wanted[1] !== "" &&
      wanted[2] !== "" &&
      candidate[0] === wanted[0] &&
      candidate[1] === wanted[1] &&
      candidate[2] === wanted[2]
    );
  });
  return {
    statement_name: statementName,
    matches,
    unique: matches.length === 1 ? matches[0] : null,
  };
}

function identity(name: string): [string, string, string] {
  const upper = name.replace(/\s+/g, " ").toUpperCase();
  let tier = "";
  if (upper.includes("TIER II") || upper.includes("TIER 2")) {
    tier = "II";
  } else if (/\bTIER I\b/.test(upper) || upper.includes("TIER 1")) {
    tier = "I";
  }

  const letterMatch = upper.match(/SCHEME\s+([ECGA])\b/);
  const letter = letterMatch ? letterMatch[1] : "";

  let family = "";
  for (const candidate of FAMILIES) {
    if (upper.includes(candidate)) {
      family = candidate.includes("BIRLA") ? "BIRLA" : candidate.split(" ")[0];
      break;
    }
  }
  return [family, letter, tier];
}

function parseNavDate(value: string): string {
  const text = value.trim();
  let match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  match = text.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (match && MONTHS[match[2].toLowerCase()]) {
    const m = String(MONTHS[match[2].toLowerCase()]).padStart(2, "0");
    return `${match[3]}-${m}-${match[1]}`;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return text;
  }
  throw new Error(`Unrecognised NAV date: ${JSON.stringify(value)}`);
}
