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

async function json<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
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
  const index = await json<DataIndex>(`${DATA}/index.json`);

  const calendar = await fetch(`${DATA}/calendar.csv`)
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
  const now = new Date();
  const day = classifyDay(calendar ? parseCalendarCsv(calendar).get(toKey(now)) : undefined);

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
      const venues = await json<Venue[]>(`${DATA}/${entry.file}`);
      if (ticket !== latest) return;
      renderBoard(boardHost, {
        venues,
        at: resolveSlot(new Date()),
        day,
        sourceDate: index.sourceDate,
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
