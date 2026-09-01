import type { DataIndex } from "../lib/types";

const KEY = "stillopen.place";

export interface Place {
  city: string;
  district: string;
}

export function loadSaved(): Place | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Place>;
    if (typeof parsed.city !== "string" || typeof parsed.district !== "string") return null;
    return { city: parsed.city, district: parsed.district };
  } catch {
    return null;
  }
}

export function saveChoice(city: string, district: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ city, district }));
  } catch {
    // Private browsing can refuse writes; the app still works for this session.
  }
}

/**
 * Two dependent selects. Counts are shown next to each district so the user
 * knows whether a district is worth opening before they open it.
 */
export function renderPicker(
  root: HTMLElement,
  index: DataIndex,
  current: Place | null,
  onPick: (city: string, district: string) => void,
): void {
  const cities = Object.keys(index.cities);
  const city = current?.city && index.cities[current.city] ? current.city : cities[0]!;
  const districts = Object.keys(index.cities[city] ?? {});
  const district =
    current?.district && index.cities[city]?.[current.district] ? current.district : districts[0]!;

  // Both selects are rebuilt on every pick, which would drop focus onto <body>
  // mid-selection. Remember which one the user was on so it can be handed back.
  const focused = Array.from(root.querySelectorAll("select")).findIndex(
    (el) => el === document.activeElement,
  );

  root.replaceChildren();
  const row = document.createElement("div");
  row.className = "flex gap-2";

  const citySelect = select(cities.map((c) => ({ value: c, label: c })), city);
  const districtSelect = select(
    districts.map((d) => {
      const c = index.cities[city]![d]!.counts;
      return { value: d, label: `${d}（${c.clinic + c.pharmacy}）` };
    }),
    district,
  );
  citySelect.id = "picker-city";
  citySelect.setAttribute("aria-label", "縣市");
  districtSelect.id = "picker-district";
  districtSelect.setAttribute("aria-label", "行政區");

  citySelect.addEventListener("change", () => {
    const nextCity = citySelect.value;
    const nextDistrict = Object.keys(index.cities[nextCity] ?? {})[0]!;
    onPick(nextCity, nextDistrict);
  });
  districtSelect.addEventListener("change", () => onPick(citySelect.value, districtSelect.value));

  row.append(citySelect, districtSelect);
  root.append(row);

  if (focused >= 0) (focused === 0 ? citySelect : districtSelect).focus();
}

function select(options: { value: string; label: string }[], selected: string): HTMLSelectElement {
  const el = document.createElement("select");
  el.className =
    "flex-1 rounded border border-hair bg-white px-3 py-2 text-base text-ink focus:outline-none focus:ring-1 focus:ring-muted";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === selected) opt.selected = true;
    el.append(opt);
  }
  return el;
}
