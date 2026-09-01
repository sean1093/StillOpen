/**
 * 21-character schedule. `N` = 看診 (open), `Y` = 休診 (closed) — the NHI's own
 * encoding, deliberately not inverted.
 * Index 0-6 = Mon-Sun morning, 7-13 = afternoon, 14-20 = evening.
 */
export type HoursBitmap = string;

export type VenueKind = "clinic" | "pharmacy";

export interface Venue {
  /** NHI HOSP_ID — stable primary key. */
  id: string;
  name: string;
  kind: VenueKind;
  /** HOSP_CODE_CNAME, e.g. 一般診所（醫務室）. */
  cat: string;
  tel: string;
  addr: string;
  /** FUNCTYPE_CNAME split on commas; empty when the venue declares none. */
  spec: string[];
  open: HoursBitmap;
  /** HOLIDAY_REMARK_CNAME, empty string when the source holds "-" or blank. */
  note: string;
}

export interface DistrictEntry {
  /** Path relative to the data root, e.g. "臺北市/大安區.json". */
  file: string;
  counts: { clinic: number; pharmacy: number };
}

export interface DataIndex {
  /** ISO 8601 instant the build ran. */
  generatedAt: string;
  /** NHI dataset date as YYYY-MM-DD — this is what the UI shows the user. */
  sourceDate: string;
  /** city → district → entry */
  cities: Record<string, Record<string, DistrictEntry>>;
}
