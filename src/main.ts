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

async function start(): Promise<void> {
  const index = await json<DataIndex>(`${DATA}/index.json`);

  const calendar = await fetch(`${DATA}/calendar.csv`)
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null);
  const now = new Date();
  const day = classifyDay(calendar ? parseCalendarCsv(calendar).get(toKey(now)) : undefined);

  const show = async (place: Place): Promise<void> => {
    const entry = index.cities[place.city]?.[place.district];
    if (!entry) return;
    saveChoice(place.city, place.district);
    renderPicker(pickerHost, index, place, (city, district) => void show({ city, district }));
    const venues = await json<Venue[]>(`${DATA}/${entry.file}`);
    renderBoard(boardHost, {
      venues,
      at: resolveSlot(new Date()),
      day,
      sourceDate: index.sourceDate,
    });
  };

  const saved = loadSaved();
  const initial = saved && index.cities[saved.city]?.[saved.district] ? saved : firstPlace(index);
  await show(initial);
}

function firstPlace(index: DataIndex): Place {
  const city = Object.keys(index.cities)[0]!;
  return { city, district: Object.keys(index.cities[city]!)[0]! };
}

start().catch((err) => {
  app.textContent = `資料載入失敗：${err instanceof Error ? err.message : String(err)}`;
});
