import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseHours } from "../src/lib/hours";
import { UNKNOWN_DISTRICT, parseLocation } from "../src/lib/location";
import type { DataIndex, DistrictEntry, Venue, VenueKind } from "../src/lib/types";
import {
  DATASETS,
  RESOURCES,
  fetchAll,
  fetchDatasetModified,
  fetchOfficeCalendar,
  type NhiRecord,
} from "./nhi";

/**
 * Sanity floors, all measured against the **kept** count — the rows that
 * actually ship — not the raw response. Sizing them against raw is the easy
 * mistake: raw is ~12% larger than kept once expired contracts are dropped, so
 * a raw-derived floor can land above the value it is compared to.
 *
 * Observed 2026-09-01: 22,081 clinics and 7,610 pharmacies kept, from 24,736
 * and 10,128 raw; schedule parse failure 0.095% and 0.575%; location failure
 * 0.000% for both. The floors sit ~9% and ~8% below those kept counts: loose
 * enough to ride out normal churn, tight enough to catch an upstream format
 * change or a truncated response before it overwrites good data.
 *
 * `maxUnknown` is the odd one out: it counts venues that ended up in
 * `UNKNOWN_DISTRICT`, which is the only way a district the frozen `DISTRICTS`
 * table has never heard of can show itself. Measured 2026-09-01: 13 venues in
 * 3 buckets (新竹市 11, 新竹縣 1, 臺中市 1), every one an address that names a 里
 * instead of a 區 or misspells it. 50 is ~4x that, and the figure only moves
 * when an address stops naming its district, so it rides out years of churn
 * while still aborting on the systemic case. It cannot catch a new district of
 * two or three venues — those land visibly in 其他 until the table is
 * regenerated — but it does catch one big enough to matter.
 */
export const GATES: Readonly<{
  minClinics: number;
  minPharmacies: number;
  maxHoursFailRate: number;
  maxLocationFailRate: number;
  maxUnknown: number;
}> = {
  minClinics: 20_000,
  minPharmacies: 7_000,
  maxHoursFailRate: 0.01,
  maxLocationFailRate: 0.02,
  maxUnknown: 50,
};

export class GateFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateFailure";
  }
}

export interface BuildStats {
  raw: number;
  live: number;
  kept: number;
  hoursFailed: number;
  locationFailed: number;
}

export interface BuildResult {
  index: DataIndex;
  /** shard path (relative to the data root) → venues */
  shards: Map<string, Venue[]>;
  stats: Record<VenueKind, BuildStats>;
  warnings: string[];
}

export interface BuildInput {
  clinics: NhiRecord[];
  pharmacies: NhiRecord[];
  /** D21006 rows, used only to cross-check the parsed bitmap. */
  fixedHours: NhiRecord[];
  /** YYYYMMDD — contracts ending on or before this are dropped. */
  today: string;
  /** YYYY-MM-DD shown to the user as the data date. */
  sourceDate: string;
  /** ISO 8601 build instant. */
  generatedAt: string;
  /** Overridable only so tests can exercise gate behaviour without 20k fixtures. */
  gates?: typeof GATES;
}

const clean = (v: string | undefined): string => {
  const t = (v ?? "").trim();
  return t === "-" ? "" : t;
};

/** Pure transform — no IO, so the gates and mapping are fully testable. */
export function buildFromRecords(input: BuildInput): BuildResult {
  const gates = input.gates ?? GATES;
  const shards = new Map<string, Venue[]>();
  const stats = {} as Record<VenueKind, BuildStats>;
  const bitmapById = new Map<string, string>();
  let unknownDistricts = 0;

  for (const [kind, rows] of [
    ["clinic", input.clinics],
    ["pharmacy", input.pharmacies],
  ] as const) {
    const stat: BuildStats = {
      raw: rows.length,
      live: 0,
      kept: 0,
      hoursFailed: 0,
      locationFailed: 0,
    };

    for (const row of rows) {
      // CLOSESHOP is 終止合約或歇業日期. Blank means no termination has been
      // recorded, which reads as active — so only a date that has actually
      // arrived expires a venue. Comparing the raw field would make "" expire
      // everything by string order, hiding a venue the user could have used.
      const contractEnd = clean(row.CLOSESHOP);
      if (contractEnd && contractEnd <= input.today) continue;
      stat.live++;

      const open = parseHours(row.HOLIDAYDUTY_CNAME ?? "");
      if (!open) {
        stat.hoursFailed++;
        continue;
      }

      const where = parseLocation(row.ADDRESS ?? "", row.GOVAREANO ?? "");
      if (!where) {
        stat.locationFailed++;
        continue;
      }
      if (where.district === UNKNOWN_DISTRICT) unknownDistricts++;

      const venue: Venue = {
        id: clean(row.HOSP_ID),
        name: clean(row.HOSP_NAME),
        kind,
        cat: clean(row.HOSP_CODE_CNAME),
        tel: clean(row.TEL),
        addr: clean(row.ADDRESS),
        spec: clean(row.FUNCTYPE_CNAME)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        open,
        note: clean(row.HOLIDAY_REMARK_CNAME),
      };

      const path = `${where.city}/${where.district}.json`;
      const bucket = shards.get(path);
      if (bucket) bucket.push(venue);
      else shards.set(path, [venue]);

      bitmapById.set(venue.id, open);
      stat.kept++;
    }

    stats[kind] = stat;
    assertGates(kind, stat, gates);
  }

  assertUnknownDistricts(unknownDistricts, gates);

  // Index keys and shard contents are both walked in sorted order, so the
  // daily commit diff shows genuinely changed rows and nothing else. Counts are
  // derived from the shard itself, so the index can never drift from the data.
  const cities: DataIndex["cities"] = {};
  for (const path of [...shards.keys()].sort()) {
    const venues = shards.get(path)!;
    venues.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    let clinics = 0;
    for (const venue of venues) if (venue.kind === "clinic") clinics++;

    const slash = path.indexOf("/");
    const city = path.slice(0, slash);
    const district = path.slice(slash + 1).replace(/\.json$/, "");
    const entry: DistrictEntry = {
      file: path,
      counts: { clinic: clinics, pharmacy: venues.length - clinics },
    };
    (cities[city] ??= {})[district] = entry;
  }

  return {
    index: { generatedAt: input.generatedAt, sourceDate: input.sourceDate, cities },
    shards,
    stats,
    warnings: crossCheck(bitmapById, input.fixedHours),
  };
}

function assertGates(kind: VenueKind, stat: BuildStats, gates: typeof GATES): void {
  const floor = kind === "clinic" ? gates.minClinics : gates.minPharmacies;
  if (stat.kept < floor) {
    throw new GateFailure(
      `${kind}: kept ${stat.kept} rows, floor is ${floor} — refusing to overwrite good data`,
    );
  }
  if (stat.live > 0) {
    const hoursRate = stat.hoursFailed / stat.live;
    if (hoursRate > gates.maxHoursFailRate) {
      throw new GateFailure(
        `${kind}: schedule parse failure ${(hoursRate * 100).toFixed(2)}% exceeds ` +
          `${(gates.maxHoursFailRate * 100).toFixed(0)}% — upstream format probably changed`,
      );
    }
    const locationRate = stat.locationFailed / stat.live;
    if (locationRate > gates.maxLocationFailRate) {
      throw new GateFailure(
        `${kind}: location failure ${(locationRate * 100).toFixed(2)}% exceeds ` +
          `${(gates.maxLocationFailRate * 100).toFixed(0)}%`,
      );
    }
  }
}

/**
 * The one gate that is not about upstream collapse: it is how a district the
 * frozen `DISTRICTS` table has never heard of announces itself. Corpus-wide
 * rather than per kind — a new district takes its clinics and its pharmacies
 * with it — and checked before any file is written, so a build that trips it
 * leaves the previous `data/` in place.
 */
function assertUnknownDistricts(unknown: number, gates: typeof GATES): void {
  if (unknown > gates.maxUnknown) {
    throw new GateFailure(
      `${unknown} venues have no district in src/lib/districts.ts, ceiling is ` +
        `${gates.maxUnknown} — a district was probably created, split or renamed ` +
        `upstream; regenerate the table from a checked build`,
    );
  }
}

/**
 * Compare our parsed bitmap against D21006's published 看診星期 for the same
 * venue. A free oracle for the parser. Warning only — the two datasets refresh
 * on slightly different cycles, so a handful of disagreements is normal and
 * must not block a build.
 */
function crossCheck(ours: Map<string, string>, fixedHours: NhiRecord[]): string[] {
  const warnings: string[] = [];
  for (const row of fixedHours) {
    const id = clean(row["醫事機構代碼"]);
    const theirs = clean(row["看診星期"]);
    const mine = ours.get(id);
    if (!mine || theirs.length !== mine.length) continue;
    if (theirs !== mine) {
      warnings.push(`schedule mismatch for ${id}: parsed ${mine}, D21006 says ${theirs}`);
    }
  }
  return warnings;
}

const DATA_ROOT = "data";

async function main(): Promise<void> {
  const now = new Date();

  // INVARIANT: every network fetch completes, and every gate passes, before the
  // first destructive filesystem operation below. Any failure therefore leaves
  // the previous data/ intact rather than half-rebuilt (spec §5.4). Never move a
  // fetch below the rm() — including the calendar, which is a different host and
  // fails independently of the NHI API.
  const [clinics, pharmacies, fixedHours, sourceDate, calendar] = await Promise.all([
    fetchAll(RESOURCES.clinics),
    fetchAll(RESOURCES.pharmacies),
    fetchAll(RESOURCES.fixedHours),
    fetchDatasetModified(DATASETS.clinics),
    fetchOfficeCalendar(now.getFullYear()),
  ]);

  const result = buildFromRecords({
    clinics,
    pharmacies,
    fixedHours,
    today: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate(),
    ).padStart(2, "0")}`,
    sourceDate,
    generatedAt: now.toISOString(),
  });

  await rm(DATA_ROOT, { recursive: true, force: true });
  await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(join(DATA_ROOT, "index.json"), JSON.stringify(result.index) + "\n", "utf8");
  for (const [path, venues] of result.shards) {
    const full = join(DATA_ROOT, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(venues) + "\n", "utf8");
  }

  if (calendar) {
    await writeFile(join(DATA_ROOT, "calendar.csv"), calendar, "utf8");
  } else {
    console.warn(`no office calendar published for ${now.getFullYear()} yet`);
  }

  for (const [kind, s] of Object.entries(result.stats)) {
    console.log(
      `${kind}: raw ${s.raw} → live ${s.live} → kept ${s.kept} ` +
        `(hours failed ${s.hoursFailed}, location failed ${s.locationFailed})`,
    );
  }
  console.log(`shards: ${result.shards.size}, source date: ${result.index.sourceDate}`);
  if (result.warnings.length > 0) {
    console.warn(`${result.warnings.length} schedule mismatches vs D21006`);
    for (const w of result.warnings.slice(0, 10)) console.warn(`  ${w}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
