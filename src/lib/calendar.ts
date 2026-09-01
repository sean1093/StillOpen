export interface DayInfo {
  /** YYYYMMDD */
  date: string;
  /** Single CJK character: 一 … 日 */
  weekday: string;
  /** 是否放假 === "2" */
  isDayOff: boolean;
  /** 備註, empty when the source column is blank. */
  note: string;
}

export interface DayClass {
  /** A named day off — the UI warns that declared hours may not hold. */
  holiday: boolean;
  /** A weekend the government works — the UI says so explicitly. */
  makeUpWorkday: boolean;
  /** 備註 verbatim, or empty. */
  label: string;
}

/** 星期 column values that fall on the weekend. */
const WEEKEND: Readonly<Record<string, true>> = { "六": true, "日": true };

export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Parse the DGPA 辦公日曆表 CSV.
 * Columns: 西元日期,星期,是否放假,備註 — verified against the 115年 file.
 * Rows that do not start with an 8-digit date are skipped rather than fatal;
 * the file has a trailing newline and has carried revision notes before.
 */
export function parseCalendarCsv(csv: string): Map<string, DayInfo> {
  const out = new Map<string, DayInfo>();
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const line of lines) {
    const cols = line.split(",");
    const date = (cols[0] ?? "").trim();
    if (!/^\d{8}$/.test(date)) continue;
    out.set(date, {
      date,
      weekday: (cols[1] ?? "").trim(),
      isDayOff: (cols[2] ?? "").trim() === "2",
      note: (cols[3] ?? "").trim(),
    });
  }

  return out;
}

/**
 * Classify a calendar day.
 *
 * A weekend day off with no remark is just a weekend — not a holiday — so the
 * UI does not cry wolf every Saturday. A *named* day off is a holiday whatever
 * the weekday. A weekend that is a working day is a make-up workday.
 *
 * Deliberately does NOT map a holiday onto Sunday's schedule column: a public
 * holiday is not a Sunday, and the NHI's per-holiday dataset has no
 * machine-readable path (spec §5.3).
 */
export function classifyDay(info: DayInfo | undefined): DayClass {
  if (!info) return { holiday: false, makeUpWorkday: false, label: "" };

  if (!info.isDayOff && WEEKEND[info.weekday]) {
    return { holiday: false, makeUpWorkday: true, label: info.note };
  }
  if (info.isDayOff && info.note) {
    return { holiday: true, makeUpWorkday: false, label: info.note };
  }
  return { holiday: false, makeUpWorkday: false, label: "" };
}
