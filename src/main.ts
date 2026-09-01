import "./style.css";
import { classifyDay, parseCalendarCsv, toKey } from "./lib/calendar";
import { resolveSlot } from "./lib/slot";
import type { DataIndex, Venue } from "./lib/types";
import { renderBoard } from "./ui/board";
import { loadSaved, renderPicker, saveChoice, type Place } from "./ui/picker";

const DATA = `${import.meta.env.BASE_URL}data`;

const app = document.getElementById("app")!;
const pickerHost = document.createElement("div");
const boardHost = document.createElement("div");
boardHost.className = "mt-6";
app.append(pickerHost, boardHost);

const CACHE_INDEX = "stillopen.cache.index";
const CACHE_SHARD = "stillopen.cache.shard";

interface CachedIndex {
  savedAt: string;
  index: DataIndex;
}

interface CachedShard {
  savedAt: string;
  city: string;
  district: string;
  venues: Venue[];
}

async function json<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Local `YYYY-MM-DD HH:mm`, so a cache banner names a time the user recognises. */
function stamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A courtesy, never a requirement: quota and private browsing both refuse writes. */
function cacheWrite(key: string, value: CachedIndex | CachedShard): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do; the next successful load will try again.
  }
}

function cacheRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Three outcomes, deliberately not collapsed into one. `build-data.ts` only
 * writes `calendar.csv` when the DGPA has published one, so a 404 is the
 * expected shape of "not published for this year yet" and the build already
 * warned about it. Anything else means we could not reach the calendar, and the
 * user has to be told the holiday check did not run rather than left to infer
 * from an unmarked ordinary day that it did.
 */
async function loadCalendar(): Promise<{ csv: string | null; failed: boolean }> {
  try {
    const res = await fetch(`${DATA}/calendar.csv`);
    if (res.status === 404) return { csv: null, failed: false };
    if (!res.ok) return { csv: null, failed: true };
    return { csv: await res.text(), failed: false };
  } catch {
    return { csv: null, failed: true };
  }
}

/**
 * The one place a load failure becomes visible. Written into the board area
 * rather than over the whole app, so a failed shard leaves the picker standing
 * and the user can choose somewhere else instead of reloading the page.
 */
function fail(err: unknown): void {
  boardHost.replaceChildren();
  const p = document.createElement("p");
  p.className = "text-sm text-shut";
  p.textContent = `資料載入失敗：${err instanceof Error ? err.message : String(err)}`;
  boardHost.append(p);
}

async function start(): Promise<void> {
  const calendar = await loadCalendar();
  const now = new Date();
  const day = classifyDay(
    calendar.csv ? parseCalendarCsv(calendar.csv).get(toKey(now)) : undefined,
  );

  // On a phone with bad signal the cache is the whole point of this branch, so a
  // fetch failure falls back to the last good copy rather than a dead end. It
  // only ever rethrows when there is genuinely nothing to show.
  let index: DataIndex;
  let indexCachedAt: string | undefined;
  try {
    index = await json<DataIndex>(`${DATA}/index.json`);
    cacheWrite(CACHE_INDEX, { savedAt: stamp(new Date()), index });
  } catch (err) {
    const cached = cacheRead<CachedIndex>(CACHE_INDEX);
    if (!cached?.index?.cities) throw err;
    index = cached.index;
    indexCachedAt = cached.savedAt;
  }

  // Selections supersede each other. Two quick taps on a slow connection can
  // land their shards out of order, and a board of 大安區 clinics under a picker
  // reading 車城鄉 is exactly the failure this product exists to prevent — so a
  // response only paints if its selection is still the current one.
  let latest = 0;

  const show = async (place: Place): Promise<void> => {
    const entry = index.cities[place.city]?.[place.district];
    if (!entry) return;
    const ticket = ++latest;
    try {
      saveChoice(place.city, place.district);
      renderPicker(pickerHost, index, place, (city, district) => void show({ city, district }));

      let venues: Venue[];
      let cachedAt = indexCachedAt;
      try {
        venues = await json<Venue[]>(`${DATA}/${entry.file}`);
        cacheWrite(CACHE_SHARD, {
          savedAt: stamp(new Date()),
          city: place.city,
          district: place.district,
          venues,
        });
      } catch (err) {
        // Only ever reuse a shard cached for the district actually selected. A
        // cached shard from somewhere else would put one district's clinics under
        // a picker naming another — the very mismatch the ticket guard prevents.
        const cached = cacheRead<CachedShard>(CACHE_SHARD);
        if (
          !Array.isArray(cached?.venues) ||
          cached.city !== place.city ||
          cached.district !== place.district
        ) {
          throw err;
        }
        venues = cached.venues;
        cachedAt = cached.savedAt;
      }

      if (ticket !== latest) return;
      renderBoard(boardHost, {
        venues,
        at: resolveSlot(new Date()),
        day,
        sourceDate: index.sourceDate,
        calendarUnavailable: calendar.failed,
        cachedAt,
      });
    } catch (err) {
      // A superseded selection must not report its failure over a newer board.
      if (ticket === latest) fail(err);
    }
  };

  const saved = loadSaved();
  const initial = saved && index.cities[saved.city]?.[saved.district] ? saved : firstPlace(index);
  await show(initial);
}

function firstPlace(index: DataIndex): Place {
  const city = Object.keys(index.cities)[0]!;
  return { city, district: Object.keys(index.cities[city]!)[0]! };
}

start().catch(fail);
