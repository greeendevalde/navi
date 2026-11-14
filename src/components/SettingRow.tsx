/**
 * One setting's row, in two layouts that share the field, so a setting looks and changes the same everywhere:
 * - wide (the QMK settings and NAVI additions tabs): title — hint, the “?” and docs link, a kicker, the field;
 * - compact (“Settings for this key” in the narrow inspector and at the top of the feature tabs): title with the hint
 *   behind its “?” (with the link to the setting's own place, `open`), a bar on the left when changed, the field
 *   on the same line, then the per-key values. Only the wide row carries the find id, so a jump lands on the canonical one.
 */
import type { ReactNode } from "react";
import { t } from "../i18n";
import { findAttr } from "../lib/find";
import { openDocs } from "../lib/qmkDocs";
import { InfoTip } from "./InfoTip";

export interface SettingRowProps {
  title: string;
  /** Short text: after “ — ” in the wide row, the tip's first paragraph in the compact one. */
  hint?: ReactNode;
  /** Longer text behind the “?”. */
  tip?: ReactNode;
  tipLabel?: string;
  docs?: string;
  /** The wide row's middle column (the define, or what the number means); the compact tip's last line. */
  kicker: ReactNode;
  field: ReactNode;
  /** The wide row's grid columns. */
  cols?: string;
  findId?: string;
  compact?: boolean;
  /** Compact: set away from its default. */
  changed?: boolean;
  /** Compact: lines under the row (per-key values). */
  below?: ReactNode;
  /** Compact: where the setting lives. */
  open?: { label: string; go: () => void };
}

export function SettingRow(p: SettingRowProps) {
  if (p.compact) {
    const cut = p.title.lastIndexOf(" ") + 1;
    return (
      <div className={p.changed ? "setting-compact is-changed" : "setting-compact"}>
        <div className="setting-compact-line">
          <span className="setting-compact-title">
            {p.title.slice(0, cut)}
            {/* The last word and the “?” never part (like Hint). */}
            <span className="with-tip-tail">
              {p.title.slice(cut)}
              {p.changed && (
                <span className="setting-compact-sr">
                  {t(" (changed)", " (изменено)")}
                </span>
              )}
              <InfoTip docs={p.docs} label={p.title}>
                {p.hint && <p>{p.hint}</p>}
                {p.tip && <p>{p.tip}</p>}
                <p>
                  <code>{p.kicker}</code>
                </p>
                {p.open && (
                  <p>
                    <button type="button" className="text-btn" onClick={p.open.go}>
                      {t(`Open on “${p.open.label}”`, `Открыть на «${p.open.label}»`)} ↗
                    </button>
                  </p>
                )}
              </InfoTip>
            </span>
          </span>
          <span className="setting-compact-field">{p.field}</span>
        </div>
        {p.below}
      </div>
    );
  }
  return (
    <div
      className="row"
      {...(p.findId ? findAttr(p.findId) : {})}
      style={{
        ["--row-cols" as string]:
          p.cols ?? "minmax(0,1.3fr) minmax(0,1fr) auto",
      }}
    >
      <span>
        {p.title}
        {(p.hint || p.tip) && (
          <span className="field-hint">
            {p.hint && (
              <>
                {" — "}
                {p.hint}
              </>
            )}
            {p.tip && (
              <>
                {" "}
                <InfoTip label={p.tipLabel ?? p.title}>{p.tip}</InfoTip>
              </>
            )}
          </span>
        )}
        {p.docs && (
          <span className="row-docs">
            <button
              type="button"
              className="text-btn"
              onClick={() => openDocs(p.docs!)}
            >
              {t("QMK docs", "Документация QMK")} ↗
            </button>
          </span>
        )}
      </span>
      <code className="kicker">{p.kicker}</code>
      {p.field}
    </div>
  );
}
