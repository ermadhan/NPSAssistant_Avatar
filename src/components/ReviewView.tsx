import React, { useState } from "react";
import {
  formatInr,
  formatUnits,
  norm,
  tierLabel,
} from "../lib/format";
import type { ParseResult } from "../types";

const NARRATION_KINDS = [
  "opening",
  "closing",
  "billing",
  "voluntary",
  "employer",
  "tier2",
  "switch_out",
  "switch_in",
  "other",
] as const;

interface ReviewViewProps {
  filename: string;
  result: ParseResult;
  onSaveHeaderProfile: (
    fingerprint: string,
    extraAliases: Record<string, Record<string, string[]>>,
  ) => Promise<void>;
  onSaveStatement: (
    confirmYear: boolean,
    narrationMap: Record<string, string>,
  ) => Promise<void>;
  onCancel: () => void;
  onMessage: (text: string) => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  filename,
  result,
  onSaveHeaderProfile,
  onSaveStatement,
  onCancel,
  onMessage,
}) => {
  const [confirmYear, setConfirmYear] = useState(false);
  const [headerInputs, setHeaderInputs] = useState<Record<string, string>>({});
  const [narrationInputs, setNarrationInputs] = useState<Record<string, string>>(
    {},
  );

  let account = result.subscriber_name || "NPS subscriber";
  account += result.pran
    ? ` (PRAN ending ${result.pran.slice(-4)})`
    : " (PRAN not detected; matched by subscriber name)";

  const handleSaveClick = async () => {
    if (result.header_mapping !== null) {
      const extra: Record<string, Record<string, string[]>> = {};
      for (const [section, fields] of Object.entries(
        result.header_mapping.missing_fields,
      )) {
        for (const fieldName of fields) {
          const val = headerInputs[`${section}::${fieldName}`];
          if (!val) {
            onMessage(`Map ${section}.${fieldName} before saving.`);
            return;
          }
          if (!extra[section]) extra[section] = {};
          extra[section][fieldName] = [val];
        }
      }
      await onSaveHeaderProfile(result.header_mapping.fingerprint, extra);
      return;
    }

    const narrationMap: Record<string, string> = {};
    for (const phrase of result.unknown_narrations) {
      const key = norm(phrase);
      const val = narrationInputs[key];
      if (!val) {
        onMessage("Choose a kind for each new narration.");
        return;
      }
      narrationMap[key] = val;
    }

    await onSaveStatement(confirmYear, narrationMap);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1
        className="text-[22px] font-semibold text-[#17243A] max-w-[760px] truncate"
        title={`Review ${filename}`}
      >
        Review {filename}
      </h1>

      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-[#52627A]">Account:</span>
        <span className="text-[#17243A] max-w-[640px] truncate" title={account}>
          {account}
        </span>
      </div>

      <p className="text-sm text-[#17243A]">
        {tierLabel(result.tier)} &nbsp; {result.financial_year} &nbsp; as on{" "}
        {result.as_of_date} &nbsp; holdings {formatInr(result.holdings_value)}
      </p>

      <p className="text-sm text-[#52627A]">
        {result.holdings.length} schemes, {result.contributions.length}{" "}
        contributions, {result.transactions.length} scheme rows. Contribution
        totals are kept separate from scheme movements.
      </p>

      {result.holdings.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-lg border border-[#E4E8EF]">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#E1E5ED] h-[42px] text-[#17243A] font-semibold">
                <th className="text-left px-3">Scheme</th>
                <th className="text-right px-3">Units</th>
                <th className="text-right px-3">Statement NAV</th>
                <th className="text-right px-3">Value</th>
              </tr>
            </thead>
            <tbody>
              {result.holdings.map((row) => (
                <tr
                  key={row.scheme_name}
                  className="border-b border-[#F0F2F7] last:border-b-0 h-[40px]"
                >
                  <td
                    className="px-3 max-w-[360px] truncate"
                    title={row.scheme_name}
                  >
                    {row.scheme_name}
                  </td>
                  <td className="px-3 text-right">{formatUnits(row.units)}</td>
                  <td className="px-3 text-right">
                    {formatUnits(row.statement_nav)}
                  </td>
                  <td className="px-3 text-right">
                    {formatInr(row.market_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.year_mismatch && (
        <div className="bg-white border border-[#E4E8EF] rounded-lg p-3 flex flex-col gap-2">
          <p className="text-xs text-[#8A5A00]">
            Filename says {result.filename_year}. Dates say{" "}
            {result.financial_year}.
          </p>
          <label className="inline-flex items-center gap-2 text-xs text-[#17243A] cursor-pointer">
            <input
              type="checkbox"
              checked={confirmYear}
              onChange={(e) => setConfirmYear(e.target.checked)}
              className="rounded border-[#D4DCE8]"
            />
            The filename year and the dates disagree. Save using the dates.
          </label>
        </div>
      )}

      {result.header_mapping !== null && (
        <div className="bg-white border border-[#E4E8EF] rounded-lg p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-[#17243A]">
            These headers are not in the known CRA layout. Map each missing
            field.
          </p>
          {Object.entries(result.header_mapping.missing_fields).map(
            ([section, fields]) => {
              const headers =
                result.header_mapping?.section_headers[section] ?? [];
              return fields.map((fieldName) => {
                const key = `${section}::${fieldName}`;
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-xs text-[#52627A]">
                      {section}.{fieldName}
                    </label>
                    <select
                      value={headerInputs[key] ?? ""}
                      onChange={(e) =>
                        setHeaderInputs((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A]"
                    >
                      <option value="">Select header...</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              });
            },
          )}
        </div>
      )}

      {result.unknown_narrations.length > 0 && (
        <div className="bg-white border border-[#E4E8EF] rounded-lg p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-[#17243A]">
            New narration text. Choose a kind. It will be reused next time.
          </p>
          {result.unknown_narrations.map((phrase) => {
            const key = norm(phrase);
            return (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs text-[#52627A]">{phrase}</label>
                <select
                  value={narrationInputs[key] ?? ""}
                  onChange={(e) =>
                    setNarrationInputs((prev) => ({
                      ...prev,
                      [key]: e.target.value,
                    }))
                  }
                  className="h-9 px-2.5 text-xs bg-white border border-[#D4DCE8] rounded-md text-[#17243A]"
                >
                  <option value="">Choose narration kind...</option>
                  {NARRATION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {result.warnings.map((warning) => (
        <p key={warning} className="text-xs text-[#8A5A00]">
          {warning}
        </p>
      ))}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-full border border-[#D4DCE8] bg-white text-[#17243A] text-xs font-medium hover:bg-[#F3F5F9] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSaveClick}
          className="px-5 py-2 rounded-full bg-[#3B6FD8] text-white text-xs font-medium hover:bg-[#315EC0] cursor-pointer"
        >
          Save statement
        </button>
      </div>
    </div>
  );
};
