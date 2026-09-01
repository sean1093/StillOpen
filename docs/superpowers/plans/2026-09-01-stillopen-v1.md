# StillOpen v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static site that answers "which NHI-contracted clinics and pharmacies in my district are open right now?", rebuilt daily from Taiwan MOHW open data with no backend.

**Architecture:** A GitHub Actions cron job pulls two NHI datasets through their CKAN-compatible datastore API, filters expired contracts, parses each venue's weekly schedule into a 21-character bitmap, shards the result by city/district into static JSON, and commits it. GitHub Pages serves a Vite-built frontend that fetches exactly one shard — the user's saved district. No server, no database, no API key, no runtime third-party dependency.

**Tech Stack:** Vite 5 · TypeScript 5 · Tailwind CSS 3 · Vitest 2 · tsx (build scripts) · GitHub Actions · GitHub Pages

**Spec:** [`docs/superpowers/specs/2026-09-01-stillopen-design.md`](../specs/2026-09-01-stillopen-design.md)

## Global Constraints

- **UI language is Traditional Chinese.** Code, comments, identifiers, commit messages and this plan are English.
- **Bitmap encoding is never inverted.** `N` = 看診 (open), `Y` = 休診 (closed), exactly as the NHI publishes it. 21 characters. Index `0-6` = Mon–Sun morning, `7-13` = Mon–Sun afternoon, `14-20` = Mon–Sun evening.
- **Slot time table** (product-defined, must be printed in the UI): 上午 `08:00–12:00`, 下午 `14:00–18:00`, 晚上 `18:00–21:00`.
- **`CLOSESHOP` must always be filtered.** Every record carries a value; it is the contract end date, not an empty column. 2,634 of 24,736 clinics are already expired.
- **Never overwrite good data with bad.** If any sanity gate in Task 5 fails, the build aborts with a non-zero exit and commits nothing.
- **GitHub Actions `cron` is UTC.** 07:30 CST is `30 23 * * *` (previous UTC day). Getting this wrong silently serves yesterday's data.
- **Attribution is mandatory** (政府資料開放授權條款第 1 版). Footer text is fixed; see Task 7 Step 7.
- **No geocoding, no GPS, no map in v1.** District is user-selected. See spec §5.2.
- **Node 20+** (`fetch`, `Array.prototype.flat`, `structuredClone` assumed available).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/types.ts` | The data contract shared by build script and frontend. No logic. |
| `src/lib/hours.ts` | `HOLIDAYDUTY_CNAME` text → 21-char bitmap; open/closed lookup. |
| `src/lib/location.ts` | `ADDRESS` + `GOVAREANO` → `{ city, district }`. Owns all name normalisation. |
| `src/lib/slot.ts` | `Date` → which of the 21 bitmap cells applies now; owns the slot time table. |
| `src/lib/calendar.ts` | DGPA office-calendar CSV → holiday / make-up-workday classification. |
| `scripts/nhi.ts` | CKAN datastore pagination client. Network only, no business logic. |
| `scripts/build-data.ts` | Pure transform (`buildFromRecords`) + thin `main()` that does IO. |
| `src/ui/picker.ts` | City/district selection, `localStorage` persistence. |
| `src/ui/board.ts` | Renders the venue list and all honesty copy. |
| `src/main.ts` | Wiring only: load index → resolve district → fetch shard → render. |
| `data/` | Generated, committed. `index.json` + `{city}/{district}.json`. |
| `.github/workflows/data.yml` | Daily data rebuild + commit. |
| `.github/workflows/pages.yml` | Build and deploy the site. |

Logic lives in `src/lib/` so the frontend and the build script share one implementation — the bitmap is written and read by the same code, so the two can never disagree.

---

### Task 1: Scaffold, shared types, and the hours parser

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/style.css`
- Create: `src/lib/types.ts`
- Create: `src/lib/hours.ts`
- Test: `tests/hours.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type HoursBitmap = string` (21 chars)
  - `type VenueKind = "clinic" | "pharmacy"`
  - `interface Venue { id, name, kind, cat, tel, addr, spec, open, note }`
  - `interface DistrictEntry { file: string; counts: { clinic: number; pharmacy: number } }`
  - `interface DataIndex { generatedAt: string; sourceDate: string; cities: Record<string, Record<string, DistrictEntry>> }`
  - `const DAYS: readonly string[]` (7, Mon-first)
  - `const SLOTS: readonly string[]` (`["上午","下午","晚上"]`)
  - `parseHours(text: string): HoursBitmap | null`
  - `isOpen(bitmap: HoursBitmap, dayIndex: number, slotIndex: number): boolean`

- [ ] **Step 1: Initialise the project**

```bash
cd StillOpen
npm init -y
npm i -D vite typescript vitest tailwindcss@3 postcss autoprefixer tsx @types/node
npx tailwindcss init -p
mkdir -p src/lib src/ui scripts tests data
```

- [ ] **Step 2: Write the config files**

`package.json` — replace the `scripts` block and add `type`:

```json
{
  "name": "stillopen",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "build:data": "tsx scripts/build-data.ts"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "scripts", "tests"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "/StillOpen/",
  publicDir: "data" === "data" ? "public" : "public",
  test: { globals: true, environment: "node" },
});
```

> `base` must be `/StillOpen/` because the site is served from a project Pages path, not a user page.

`tailwind.config.js`:

```js
export default {
  content: ["./index.html", "./src/**/*.ts"],
  theme: {
    extend: {
      colors: {
        paper: "#faf8f4",
        ink: "#2b2a28",
        muted: "#8a857d",
        hair: "#e5e0d8",
        open: "#5f7a5f",
        shut: "#a8836b",
      },
    },
  },
  plugins: [],
};
```

`src/style.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html { -webkit-text-size-adjust: 100%; }
body { @apply bg-paper text-ink antialiased; }
```

`index.html`:

```html
<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>還開著 · StillOpen</title>
    <meta name="description" content="選你的行政區，看此刻還開著的健保特約診所與藥局。" />
  </head>
  <body>
    <main id="app" class="mx-auto max-w-xl px-5 py-8"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `src/lib/types.ts`**

```ts
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
```

- [ ] **Step 4: Write the failing test**

`tests/hours.test.ts` — every fixture below is a verbatim record pulled from the live NHI API on 2026-09-01.

```ts
import { describe, it, expect } from "vitest";
import { parseHours, isOpen, DAYS, SLOTS } from "../src/lib/hours";

/** 臺北市立聯合醫院附設大安門診部 (HOSP_ID 2101020019) — real record. */
const DAAN =
  "星期一上午看診、星期二上午看診、星期三上午看診、星期四上午看診、星期五上午看診、星期六上午休診、星期日上午休診、" +
  "星期一下午看診、星期二下午看診、星期三下午看診、星期四下午看診、星期五下午看診、星期六下午休診、星期日下午休診、" +
  "星期一晚上休診、星期二晚上休診、星期三晚上休診、星期四晚上休診、星期五晚上休診、星期六晚上休診、星期日晚上休診";

/** 高雄市立中醫醫院 (HOSP_ID 0807350018) — real record, open Saturday morning. */
const KMCH =
  "星期一上午看診、星期二上午看診、星期三上午看診、星期四上午看診、星期五上午看診、星期六上午看診、星期日上午休診、" +
  "星期一下午看診、星期二下午看診、星期三下午看診、星期四下午看診、星期五下午看診、星期六下午休診、星期日下午休診、" +
  "星期一晚上看診、星期二晚上看診、星期三晚上看診、星期四晚上看診、星期五晚上休診、星期六晚上休診、星期日晚上休診";

const ALL_OPEN = SLOTS.flatMap((s) => DAYS.map((d) => `${d}${s}看診`)).join("、");

describe("constants", () => {
  it("orders days Monday-first and slots morning-first", () => {
    expect(DAYS).toEqual(["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]);
    expect(SLOTS).toEqual(["上午", "下午", "晚上"]);
  });
});

describe("parseHours", () => {
  it("parses a weekday-only clinic", () => {
    expect(parseHours(DAAN)).toBe("NNNNNYYNNNNNYYYYYYYYY");
  });

  it("parses a clinic open Saturday morning and four weekday evenings", () => {
    expect(parseHours(KMCH)).toBe("NNNNNNYNNNNNYYNNNNYYY");
  });

  it("parses an always-open venue", () => {
    expect(parseHours(ALL_OPEN)).toBe("N".repeat(21));
  });

  it("returns null for an empty string", () => {
    expect(parseHours("")).toBeNull();
    expect(parseHours("   ")).toBeNull();
  });

  it("returns null when no cell can be read", () => {
    expect(parseHours("本院暫停營業")).toBeNull();
  });

  it("marks unreadable cells closed rather than failing the whole record", () => {
    const partial = "星期一上午看診、星期二上午看診";
    expect(parseHours(partial)).toBe("NN" + "Y".repeat(19));
  });

  it("is insensitive to cell ordering", () => {
    const reversed = DAAN.split("、").reverse().join("、");
    expect(parseHours(reversed)).toBe(parseHours(DAAN));
  });
});

describe("isOpen", () => {
  const daan = parseHours(DAAN)!;

  it("reads Monday morning as open", () => {
    expect(isOpen(daan, 0, 0)).toBe(true);
  });

  it("reads Sunday morning as closed", () => {
    expect(isOpen(daan, 6, 0)).toBe(false);
  });

  it("reads Friday afternoon as open", () => {
    expect(isOpen(daan, 4, 1)).toBe(true);
  });

  it("reads Monday evening as closed", () => {
    expect(isOpen(daan, 0, 2)).toBe(false);
  });

  it("returns false for out-of-range indices instead of throwing", () => {
    expect(isOpen(daan, 7, 0)).toBe(false);
    expect(isOpen(daan, 0, 3)).toBe(false);
    expect(isOpen(daan, -1, 0)).toBe(false);
  });

  it("returns false for a malformed bitmap", () => {
    expect(isOpen("NNN", 0, 0)).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/hours.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/hours"`.

- [ ] **Step 6: Write `src/lib/hours.ts`**

```ts
import type { HoursBitmap } from "./types";

/** Monday-first, matching the NHI's own 21-cell ordering. */
export const DAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;

export const SLOTS = ["上午", "下午", "晚上"] as const;

export type SlotName = (typeof SLOTS)[number];

export const BITMAP_LENGTH = DAYS.length * SLOTS.length;

/**
 * Turn NHI `HOLIDAYDUTY_CNAME` into a 21-character bitmap.
 *
 * The source is a 、-joined list of cells like `星期三晚上看診`. Cells may be
 * reordered or missing; a missing cell is treated as closed, because a venue
 * that does not declare a session is not open for it. Returns `null` only when
 * not a single cell is readable — that record has no schedule at all and the
 * caller must drop it.
 */
export function parseHours(text: string): HoursBitmap | null {
  if (!text || !text.trim()) return null;

  const cells: string[] = new Array(BITMAP_LENGTH).fill("Y");
  let found = 0;

  for (let slotIndex = 0; slotIndex < SLOTS.length; slotIndex++) {
    for (let dayIndex = 0; dayIndex < DAYS.length; dayIndex++) {
      const prefix = `${DAYS[dayIndex]}${SLOTS[slotIndex]}`;
      const at = slotIndex * DAYS.length + dayIndex;
      if (text.includes(`${prefix}看診`)) {
        cells[at] = "N";
        found++;
      } else if (text.includes(`${prefix}休診`)) {
        found++;
      }
    }
  }

  return found === 0 ? null : cells.join("");
}

/** Safe cell lookup. Out-of-range or malformed input reads as closed. */
export function isOpen(bitmap: HoursBitmap, dayIndex: number, slotIndex: number): boolean {
  if (bitmap.length !== BITMAP_LENGTH) return false;
  if (dayIndex < 0 || dayIndex >= DAYS.length) return false;
  if (slotIndex < 0 || slotIndex >= SLOTS.length) return false;
  return bitmap[slotIndex * DAYS.length + dayIndex] === "N";
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/hours.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts \
  tailwind.config.js postcss.config.js index.html src/style.css \
  src/lib/types.ts src/lib/hours.ts tests/hours.test.ts
git commit -m "feat: scaffold project and parse NHI schedule text into a bitmap"
```

---

### Task 2: Address → city and district

**Files:**
- Create: `src/lib/location.ts`
- Test: `tests/location.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface Location { city: string; district: string }`
  - `const GOV_AREA_TO_CITY: Readonly<Record<string, string>>` — 22 entries
  - `const UNKNOWN_DISTRICT = "其他"`
  - `normaliseAddress(address: string): string`
  - `parseLocation(address: string, govAreaNo: string): Location | null`

**Why this task exists:** the NHI ships no coordinates, so the district string
parsed here is the only location key the product has. Measured against all
34,864 live records: address-prefix matching resolves the city for 34,861 and
the district for 34,843. The 21 misses are fully enumerated and each has a
deterministic cause — this task fixes all of them.

- [ ] **Step 1: Write the failing test**

`tests/location.test.ts` — the failing addresses below are verbatim from the
live datasets on 2026-09-01.

```ts
import { describe, it, expect } from "vitest";
import {
  parseLocation,
  normaliseAddress,
  GOV_AREA_TO_CITY,
  UNKNOWN_DISTRICT,
} from "../src/lib/location";

describe("normaliseAddress", () => {
  it("canonicalises 台 to 臺", () => {
    expect(normaliseAddress("台北市大安區")).toBe("臺北市大安區");
    expect(normaliseAddress("台中市西屯區")).toBe("臺中市西屯區");
  });

  it("upgrades the pre-2014 桃園縣 to 桃園市", () => {
    expect(normaliseAddress("桃園縣中壢市龍東路38號")).toBe("桃園市中壢區龍東路38號");
    expect(normaliseAddress("桃園縣八德市建國路１１８０號")).toBe("桃園市八德區建國路１１８０號");
    expect(normaliseAddress("桃園縣桃園市春日路２８５號")).toBe("桃園市桃園區春日路２８５號");
  });

  it("leaves an already-correct address untouched", () => {
    expect(normaliseAddress("新北市新莊區大觀街４６－２號")).toBe("新北市新莊區大觀街４６－２號");
  });

  it("does not rewrite 桃園市 districts when the county form is absent", () => {
    expect(normaliseAddress("桃園市中壢區中美路13.15.17號")).toBe("桃園市中壢區中美路13.15.17號");
  });
});

describe("GOV_AREA_TO_CITY", () => {
  it("covers all 22 codes the NHI datasets actually use", () => {
    expect(Object.keys(GOV_AREA_TO_CITY)).toHaveLength(22);
  });

  it("maps the ambiguous 臺南市 code to the canonical spelling", () => {
    expect(GOV_AREA_TO_CITY["10021"]).toBe("臺南市");
  });
});

describe("parseLocation — ordinary addresses", () => {
  const cases: [string, string, string, string][] = [
    ["臺北市大安區辛亥路３段１５號", "63000", "臺北市", "大安區"],
    ["新北市鶯歌區鶯桃路２段６２號及６４號１至４樓", "65000", "新北市", "鶯歌區"],
    ["高雄市苓雅區凱旋二路１３２號", "64000", "高雄市", "苓雅區"],
    ["苗栗縣三義鄉廣盛村１６鄰八股路２４之９號", "10005", "苗栗縣", "三義鄉"],
    ["彰化縣田中鎮中路里中南路三段５１２號", "10007", "彰化縣", "田中鎮"],
    ["新竹縣竹北市光明六路１號", "10004", "新竹縣", "竹北市"],
    ["臺南市北區正覺里公園路６６１號", "10021", "臺南市", "北區"],
  ];

  for (const [addr, gov, city, district] of cases) {
    it(`resolves ${addr}`, () => {
      expect(parseLocation(addr, gov)).toEqual({ city, district });
    });
  }
});

describe("parseLocation — the real-world misses", () => {
  it("falls back to GOVAREANO when the city prefix is a retired name", () => {
    // 桃園縣 was upgraded in 2014; three records still carry the old form.
    expect(parseLocation("桃園縣八德市建國路１１８０號、１１８２號、１１８０－１號", "68000")).toEqual({
      city: "桃園市",
      district: "八德區",
    });
  });

  it("buckets 新竹市 addresses that skip the district and give a 里 instead", () => {
    // 18 live records look like this. 里 → 區 cannot be inferred without a
    // village table, so they land in a visible bucket rather than vanish.
    expect(parseLocation("新竹市關帝里南門街８６號", "10018")).toEqual({
      city: "新竹市",
      district: UNKNOWN_DISTRICT,
    });
    expect(parseLocation("新竹市延平路３段６８５號", "10018")).toEqual({
      city: "新竹市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("buckets the 臺中市 address that skips the district", () => {
    expect(parseLocation("臺中市上石里河南路二段４１１．４１３號１Ｆ", "66000")).toEqual({
      city: "臺中市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("recovers the city from GOVAREANO when the address is blank", () => {
    expect(parseLocation("", "63000")).toEqual({
      city: "臺北市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("returns null only when neither address nor GOVAREANO is usable", () => {
    expect(parseLocation("", "")).toBeNull();
    expect(parseLocation("地址不詳", "99999")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/location.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/location"`.

- [ ] **Step 3: Write `src/lib/location.ts`**

```ts
export interface Location {
  city: string;
  district: string;
}

/** Shown to the user, so it must read as a real bucket rather than an error. */
export const UNKNOWN_DISTRICT = "其他";

/**
 * 戶役政 city codes, derived by majority vote over all 34,864 NHI records on
 * 2026-09-01. Exactly 22 codes appear. Code 10021 is the only ambiguous one —
 * the source spells it both 臺南市 and 台南市 — resolved to the official form.
 */
export const GOV_AREA_TO_CITY: Readonly<Record<string, string>> = Object.freeze({
  "09007": "連江縣",
  "09020": "金門縣",
  "10002": "宜蘭縣",
  "10004": "新竹縣",
  "10005": "苗栗縣",
  "10007": "彰化縣",
  "10008": "南投縣",
  "10009": "雲林縣",
  "10010": "嘉義縣",
  "10013": "屏東縣",
  "10014": "臺東縣",
  "10015": "花蓮縣",
  "10016": "澎湖縣",
  "10017": "基隆市",
  "10018": "新竹市",
  "10020": "嘉義市",
  "10021": "臺南市",
  "63000": "臺北市",
  "64000": "高雄市",
  "65000": "新北市",
  "66000": "臺中市",
  "68000": "桃園市",
});

const CITY_PATTERN = new RegExp(
  "^(" +
    [
      "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
      "基隆市", "新竹市", "嘉義市",
      "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣",
      "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
    ].join("|") +
    ")",
);

/** 1-3 CJK characters followed by a 區/鄉/鎮/市 suffix. */
const DISTRICT_PATTERN = /^([\u4e00-\u9fff]{1,3}[區鄉鎮市])/;

/** 桃園縣 was upgraded to 桃園市 in 2014; its 市 became 區. */
const TAOYUAN_UPGRADED = ["八德", "桃園", "中壢", "平鎮", "楊梅", "蘆竹", "大溪"];

/**
 * Canonicalise a raw NHI address: 台 → 臺, and rewrite retired 桃園縣 forms.
 * Full-width digits are deliberately left alone — they are display text here,
 * and only matter once geocoding arrives (spec §6).
 */
export function normaliseAddress(address: string): string {
  let out = address.replace(/台/g, "臺");
  if (out.startsWith("桃園縣")) {
    out = "桃園市" + out.slice("桃園縣".length);
    for (const name of TAOYUAN_UPGRADED) {
      if (out.startsWith(`桃園市${name}市`)) {
        out = `桃園市${name}區` + out.slice(`桃園市${name}市`.length);
        break;
      }
    }
  }
  return out;
}

/**
 * Resolve a venue to a city and district.
 *
 * City resolution is belt-and-braces: the address prefix first, then the
 * GOVAREANO code. Measured over the full datasets this reaches 100%. District
 * resolution reaches 99.95%; the remainder are addresses that name a 里 instead
 * of a 區, which land in `UNKNOWN_DISTRICT` so they stay reachable at city
 * level instead of being silently dropped.
 *
 * Returns `null` only when both signals fail — such a record cannot be placed
 * anywhere and the caller must drop it.
 */
export function parseLocation(address: string, govAreaNo: string): Location | null {
  const normalised = normaliseAddress((address ?? "").trim());
  const cityMatch = normalised.match(CITY_PATTERN);
  const city = cityMatch?.[1] ?? GOV_AREA_TO_CITY[(govAreaNo ?? "").trim()];
  if (!city) return null;

  const remainder = cityMatch ? normalised.slice(cityMatch[1].length) : "";
  const districtMatch = remainder.match(DISTRICT_PATTERN);
  return { city, district: districtMatch?.[1] ?? UNKNOWN_DISTRICT };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/location.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/location.ts tests/location.test.ts
git commit -m "feat: resolve city and district from NHI address and area code"
```

---

### Task 3: Which bitmap cell is "now"

**Files:**
- Create: `src/lib/slot.ts`
- Test: `tests/slot.test.ts`

**Interfaces:**
- Consumes: `DAYS`, `SLOTS` from `src/lib/hours.ts`.
- Produces:
  - `const SLOT_HOURS: readonly (readonly [number, number])[]` — `[[8,12],[14,18],[18,21]]`
  - `interface SlotPosition { dayIndex: number; slotIndex: number }`
  - `type SlotResolution = { kind: "in"; at: SlotPosition } | { kind: "gap"; reason: "lunch" | "night"; next: SlotPosition }`
  - `dayIndexOf(d: Date): number` — Monday = 0, Sunday = 6
  - `resolveSlot(d: Date): SlotResolution`
  - `describeSlot(p: SlotPosition): string` — e.g. `"星期日晚上"`

**Why a `gap` is a first-class result:** the NHI publishes no clock times, so
between 12:00–14:00 and after 21:00 there is no honest cell to read. The UI must
say so and offer the next session rather than render an empty list (spec §5.1).

- [ ] **Step 1: Write the failing test**

`tests/slot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSlot, dayIndexOf, describeSlot, SLOT_HOURS } from "../src/lib/slot";

/** Local-time constructor; the product is single-timezone (Asia/Taipei). */
const at = (isoDate: string, h: number, m = 0) => {
  const [y, mo, d] = isoDate.split("-").map(Number);
  return new Date(y!, mo! - 1, d!, h, m, 0, 0);
};

// 2026-08-31 is a Monday; 2026-09-06 is a Sunday.
const MON = "2026-08-31";
const SAT = "2026-09-05";
const SUN = "2026-09-06";

describe("SLOT_HOURS", () => {
  it("matches the product-defined table in the spec", () => {
    expect(SLOT_HOURS).toEqual([
      [8, 12],
      [14, 18],
      [18, 21],
    ]);
  });
});

describe("dayIndexOf", () => {
  it("indexes Monday as 0", () => {
    expect(dayIndexOf(at(MON, 9))).toBe(0);
  });

  it("indexes Saturday as 5 and Sunday as 6", () => {
    expect(dayIndexOf(at(SAT, 9))).toBe(5);
    expect(dayIndexOf(at(SUN, 9))).toBe(6);
  });
});

describe("resolveSlot — inside a session", () => {
  const inside: [number, number, number, string][] = [
    [8, 0, 0, "morning opens at 08:00"],
    [11, 59, 0, "morning runs to 11:59"],
    [14, 0, 1, "afternoon opens at 14:00"],
    [17, 59, 1, "afternoon runs to 17:59"],
    [18, 0, 2, "evening opens at 18:00"],
    [20, 59, 2, "evening runs to 20:59"],
  ];

  for (const [h, m, slotIndex, label] of inside) {
    it(label, () => {
      expect(resolveSlot(at(MON, h, m))).toEqual({
        kind: "in",
        at: { dayIndex: 0, slotIndex },
      });
    });
  }
});

describe("resolveSlot — gaps", () => {
  it("reports the lunch gap and points at the afternoon session", () => {
    expect(resolveSlot(at(MON, 12, 0))).toEqual({
      kind: "gap",
      reason: "lunch",
      next: { dayIndex: 0, slotIndex: 1 },
    });
    expect(resolveSlot(at(MON, 13, 59))).toEqual({
      kind: "gap",
      reason: "lunch",
      next: { dayIndex: 0, slotIndex: 1 },
    });
  });

  it("reports the night gap and points at tomorrow morning", () => {
    expect(resolveSlot(at(MON, 21, 0))).toEqual({
      kind: "gap",
      reason: "night",
      next: { dayIndex: 1, slotIndex: 0 },
    });
    expect(resolveSlot(at(MON, 23, 59))).toEqual({
      kind: "gap",
      reason: "night",
      next: { dayIndex: 1, slotIndex: 0 },
    });
  });

  it("treats the small hours as the night gap before this morning", () => {
    expect(resolveSlot(at(MON, 3, 30))).toEqual({
      kind: "gap",
      reason: "night",
      next: { dayIndex: 0, slotIndex: 0 },
    });
  });

  it("wraps Sunday night to Monday morning", () => {
    expect(resolveSlot(at(SUN, 22, 0))).toEqual({
      kind: "gap",
      reason: "night",
      next: { dayIndex: 0, slotIndex: 0 },
    });
  });
});

describe("describeSlot", () => {
  it("renders a human label", () => {
    expect(describeSlot({ dayIndex: 6, slotIndex: 2 })).toBe("星期日晚上");
    expect(describeSlot({ dayIndex: 0, slotIndex: 0 })).toBe("星期一上午");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/slot.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/slot"`.

- [ ] **Step 3: Write `src/lib/slot.ts`**

```ts
import { DAYS, SLOTS } from "./hours";

/**
 * Product-defined session hours, `[startHour, endHourExclusive)`.
 * The NHI publishes only 上午/下午/晚上 with no clock times, so this table is
 * ours and must be printed in the UI (spec §5.1).
 */
export const SLOT_HOURS = [
  [8, 12],
  [14, 18],
  [18, 21],
] as const satisfies readonly (readonly [number, number])[];

export interface SlotPosition {
  /** Monday = 0 … Sunday = 6, matching the bitmap. */
  dayIndex: number;
  slotIndex: number;
}

export type SlotResolution =
  | { kind: "in"; at: SlotPosition }
  | { kind: "gap"; reason: "lunch" | "night"; next: SlotPosition };

/** `Date#getDay` is Sunday-first; the bitmap is Monday-first. */
export function dayIndexOf(d: Date): number {
  return (d.getDay() + 6) % 7;
}

const nextDay = (dayIndex: number) => (dayIndex + 1) % DAYS.length;

/** Which bitmap cell applies at `d`, or which gap we are sitting in. */
export function resolveSlot(d: Date): SlotResolution {
  const dayIndex = dayIndexOf(d);
  const minutes = d.getHours() * 60 + d.getMinutes();

  for (let slotIndex = 0; slotIndex < SLOT_HOURS.length; slotIndex++) {
    const [start, end] = SLOT_HOURS[slotIndex]!;
    if (minutes >= start * 60 && minutes < end * 60) {
      return { kind: "in", at: { dayIndex, slotIndex } };
    }
  }

  const [morningStart] = SLOT_HOURS[0]!;
  const [, morningEnd] = SLOT_HOURS[0]!;
  const [afternoonStart] = SLOT_HOURS[1]!;

  // Before the day's first session — the night gap belongs to today's morning.
  if (minutes < morningStart * 60) {
    return { kind: "gap", reason: "night", next: { dayIndex, slotIndex: 0 } };
  }

  // Between morning and afternoon.
  if (minutes >= morningEnd * 60 && minutes < afternoonStart * 60) {
    return { kind: "gap", reason: "lunch", next: { dayIndex, slotIndex: 1 } };
  }

  // After the last session — roll over to tomorrow morning.
  return { kind: "gap", reason: "night", next: { dayIndex: nextDay(dayIndex), slotIndex: 0 } };
}

export function describeSlot(p: SlotPosition): string {
  return `${DAYS[p.dayIndex] ?? ""}${SLOTS[p.slotIndex] ?? ""}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/slot.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slot.ts tests/slot.test.ts
git commit -m "feat: map wall-clock time to a schedule cell or a session gap"
```

---

### Task 4: Government office calendar

**Files:**
- Create: `src/lib/calendar.ts`
- Test: `tests/calendar.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface DayInfo { date: string; weekday: string; isDayOff: boolean; note: string }`
  - `interface DayClass { holiday: boolean; makeUpWorkday: boolean; label: string }`
  - `parseCalendarCsv(csv: string): Map<string, DayInfo>` — keyed `YYYYMMDD`
  - `classifyDay(info: DayInfo | undefined): DayClass`
  - `toKey(d: Date): string` — `YYYYMMDD`

**Verified source format** (fetched 2026-09-01 from the 115年 CSV):

```
西元日期,星期,是否放假,備註
20260101,四,2,開國紀念日
20260102,五,0,
20260103,六,2,
```

365 data rows. `是否放假` is only ever `0` (working) or `2` (off). The 115 file
carries a UTF-8 BOM; the 116 file does not, despite `_utf8bom` in its filename —
so the parser must strip an optional BOM. 2026 contains 16 weekday holidays and
zero make-up workdays; the make-up branch still exists because other years have
them, and is covered by a synthetic row.

> **Do not hardcode the CSV URL.** `dgpa.gov.tw` filenames change every year and
> mid-year (there is a `114年…(1141020更新)` revision). Task 5 discovers the link
> from the dataset page.

- [ ] **Step 1: Write the failing test**

`tests/calendar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCalendarCsv, classifyDay, toKey } from "../src/lib/calendar";

/** Verbatim rows from the 115年 DGPA CSV, plus one synthetic make-up workday. */
const CSV = [
  "西元日期,星期,是否放假,備註",
  "20260101,四,2,開國紀念日",
  "20260102,五,0,",
  "20260103,六,2,",
  "20260215,日,2,小年夜",
  "20260216,一,2,農曆除夕",
  "20260220,五,2,補假",
  "20260501,五,2,勞動節",
  "20260901,二,0,",
  "20260228,六,0,補行上班", // synthetic: 2026 has none, other years do
].join("\r\n");

describe("parseCalendarCsv", () => {
  const map = parseCalendarCsv(CSV);

  it("keys every row by YYYYMMDD", () => {
    expect(map.size).toBe(9);
    expect(map.get("20260101")).toEqual({
      date: "20260101",
      weekday: "四",
      isDayOff: true,
      note: "開國紀念日",
    });
  });

  it("reads 0 as a working day and 2 as a day off", () => {
    expect(map.get("20260102")!.isDayOff).toBe(false);
    expect(map.get("20260103")!.isDayOff).toBe(true);
  });

  it("normalises an absent remark to an empty string", () => {
    expect(map.get("20260102")!.note).toBe("");
  });

  it("strips a UTF-8 BOM", () => {
    const withBom = parseCalendarCsv("\uFEFF" + CSV);
    expect(withBom.get("20260101")!.note).toBe("開國紀念日");
  });

  it("tolerates LF-only line endings", () => {
    const lf = parseCalendarCsv(CSV.replace(/\r\n/g, "\n"));
    expect(lf.size).toBe(9);
  });

  it("ignores blank and malformed lines instead of throwing", () => {
    const messy = parseCalendarCsv(CSV + "\r\n\r\ngarbage\r\n,,,\r\n");
    expect(messy.size).toBe(9);
  });
});

describe("classifyDay", () => {
  const map = parseCalendarCsv(CSV);

  it("flags a weekday public holiday", () => {
    expect(classifyDay(map.get("20260101"))).toEqual({
      holiday: true,
      makeUpWorkday: false,
      label: "開國紀念日",
    });
  });

  it("labels an unnamed weekend day off without calling it a holiday", () => {
    expect(classifyDay(map.get("20260103"))).toEqual({
      holiday: false,
      makeUpWorkday: false,
      label: "",
    });
  });

  it("flags a named weekend day off as a holiday", () => {
    expect(classifyDay(map.get("20260215"))).toEqual({
      holiday: true,
      makeUpWorkday: false,
      label: "小年夜",
    });
  });

  it("flags a weekend that is a working day as a make-up workday", () => {
    expect(classifyDay(map.get("20260228"))).toEqual({
      holiday: false,
      makeUpWorkday: true,
      label: "補行上班",
    });
  });

  it("treats an ordinary weekday as neither", () => {
    expect(classifyDay(map.get("20260901"))).toEqual({
      holiday: false,
      makeUpWorkday: false,
      label: "",
    });
  });

  it("degrades safely when the year is not in the calendar", () => {
    expect(classifyDay(undefined)).toEqual({
      holiday: false,
      makeUpWorkday: false,
      label: "",
    });
  });
});

describe("toKey", () => {
  it("zero-pads month and day", () => {
    expect(toKey(new Date(2026, 8, 1))).toBe("20260901");
    expect(toKey(new Date(2026, 0, 5))).toBe("20260105");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/calendar.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/calendar"`.

- [ ] **Step 3: Write `src/lib/calendar.ts`**

```ts
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

const WEEKEND = new Set(["六", "日"]);

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

  const weekend = WEEKEND.has(info.weekday);
  if (!info.isDayOff && weekend) {
    return { holiday: false, makeUpWorkday: true, label: info.note };
  }
  if (info.isDayOff && info.note) {
    return { holiday: true, makeUpWorkday: false, label: info.note };
  }
  return { holiday: false, makeUpWorkday: false, label: "" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/calendar.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar.ts tests/calendar.test.ts
git commit -m "feat: classify holidays and make-up workdays from the DGPA calendar"
```

---

### Task 5: Data build — fetch, filter, gate, shard

**Files:**
- Create: `scripts/nhi.ts`
- Create: `scripts/build-data.ts`
- Test: `tests/build-data.test.ts`

**Interfaces:**
- Consumes: `parseHours` (Task 1), `parseLocation`, `UNKNOWN_DISTRICT` (Task 2), `Venue`, `DataIndex`, `DistrictEntry` (Task 1).
- Produces:
  - `type NhiRecord = Record<string, string>`
  - `const RESOURCES: { clinics: string; pharmacies: string; fixedHours: string }`
  - `fetchAll(resourceId: string): Promise<NhiRecord[]>`
  - `fetchDatasetModified(identifier: string): Promise<string>` — `YYYY-MM-DD`
  - `const GATES: { minClinics: number; minPharmacies: number; maxHoursFailRate: number; maxLocationFailRate: number }`
  - `interface BuildStats { raw: number; live: number; kept: number; hoursFailed: number; locationFailed: number }`
  - `interface BuildResult { index: DataIndex; shards: Map<string, Venue[]>; stats: Record<VenueKind, BuildStats>; warnings: string[] }`
  - `buildFromRecords(input: { clinics, pharmacies, fixedHours, today, sourceDate, generatedAt }): BuildResult`
  - `class GateFailure extends Error`

**Verified upstream facts** (2026-09-01):

| | clinics | pharmacies |
|---|---:|---:|
| Resource ID | `A21030000I-D21004-009` | `A21030000I-D21005-001` |
| raw rows | 24,736 | 10,128 |
| contract still valid | 22,102 | 7,654 |
| schedule parseable | 22,081 | 7,609 |
| parse failure rate | 0.095% | 0.588% |

`limit` caps at 1000, so pagination is mandatory. Full pull of both datasets
takes under two seconds with concurrent page requests.

- [ ] **Step 1: Write `scripts/nhi.ts`**

Network-only, no business logic, so it carries no unit test of its own — Task 6
exercises it for real against the live API.

```ts
const BASE = "https://info.nhi.gov.tw/api/iode0010/v1/rest";

export type NhiRecord = Record<string, string>;

export const RESOURCES = {
  clinics: "A21030000I-D21004-009",
  pharmacies: "A21030000I-D21005-001",
  fixedHours: "A21030000I-D21006-001",
} as const;

/** Datasets whose `modified` timestamp we treat as the data date. */
export const DATASETS = {
  clinics: "A21030000I-D21004",
} as const;

const PAGE = 1000;

interface DatastoreResponse {
  success: boolean;
  result: { total: number; records: NhiRecord[] };
}

/**
 * Pull every row of a CKAN datastore resource.
 *
 * The API caps `limit` at 1000 regardless of what is asked for, so the total is
 * read from the first page and the remaining pages are fetched concurrently.
 */
export async function fetchAll(resourceId: string): Promise<NhiRecord[]> {
  const first = await getPage(resourceId, 0);
  const total = first.result.total;
  const records = [...first.result.records];

  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);

  const rest = await Promise.all(offsets.map((o) => getPage(resourceId, o)));
  for (const page of rest) records.push(...page.result.records);

  if (records.length !== total) {
    throw new Error(`${resourceId}: expected ${total} rows, received ${records.length}`);
  }
  return records;
}

async function getPage(resourceId: string, offset: number): Promise<DatastoreResponse> {
  const url = `${BASE}/datastore/${resourceId}?limit=${PAGE}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = (await res.json()) as DatastoreResponse;
  if (!body.success) throw new Error(`${url} -> success=false`);
  return body;
}

/** The dataset's own `modified` timestamp, as YYYY-MM-DD. */
export async function fetchDatasetModified(identifier: string): Promise<string> {
  const url = `${BASE}/dataset/${identifier}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = (await res.json()) as { modified?: string };
  const modified = body.modified;
  if (!modified) throw new Error(`${url} -> no modified field`);
  return modified.slice(0, 10).replace(/\//g, "-");
}

/**
 * Resolve this year's 辦公日曆表 CSV from the data.gov.tw dataset page.
 * The filename changes yearly and mid-year, so it must never be hardcoded.
 * Returns the decoded CSV text, or null when this year's file is not published.
 */
export async function fetchOfficeCalendar(year: number): Promise<string | null> {
  const rocYear = year - 1911;
  const page = await (await fetch("https://data.gov.tw/dataset/14718")).text();
  const links = [
    ...new Set(
      [...page.matchAll(/https?:\/\/[^"'\s<>\\]+?\.csv[^"'\s<>\\]*/gi)].map((m) =>
        m[0].replace(/&amp;/g, "&"),
      ),
    ),
  ];

  const candidates = links
    .map((url) => ({ url, name: safeDecode(url) }))
    .filter(({ name }) => name.includes(`${rocYear}年`) && !name.includes("Google"));

  if (candidates.length === 0) return null;

  // Prefer the most recently published revision — later files sort last by the
  // yyyymm directory segment embedded in the URL.
  candidates.sort((a, b) => a.url.localeCompare(b.url));
  const chosen = candidates[candidates.length - 1]!;

  const res = await fetch(chosen.url);
  if (!res.ok) throw new Error(`${chosen.url} -> HTTP ${res.status}`);
  return new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
}

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/build-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFromRecords, GateFailure, GATES } from "../scripts/build-data";
import type { NhiRecord } from "../scripts/nhi";

const OPEN_ALL = [
  "星期一上午看診、星期二上午看診、星期三上午看診、星期四上午看診、星期五上午看診、星期六上午看診、星期日上午看診",
  "星期一下午看診、星期二下午看診、星期三下午看診、星期四下午看診、星期五下午看診、星期六下午看診、星期日下午看診",
  "星期一晚上看診、星期二晚上看診、星期三晚上看診、星期四晚上看診、星期五晚上看診、星期六晚上看診、星期日晚上看診",
].join("、");

const clinic = (over: Partial<NhiRecord> = {}): NhiRecord => ({
  HOSP_ID: "2101020019",
  HOSP_NAME: "臺北市立聯合醫院附設大安門診部",
  HOSP_CODE_CNAME: "一般診所（醫務室）",
  TEL: "(02)27390997",
  ADDRESS: "臺北市大安區辛亥路３段１５號",
  BRANCH_TYPE_CNAME: "臺北業務組",
  SPECIAL_TYPE: "4",
  SERVICE_CNAME: "門診診療",
  FUNCTYPE_CNAME: "家醫科",
  CLOSESHOP: "20281123",
  HOLIDAYDUTY_CNAME: OPEN_ALL,
  HOLIDAY_REMARK_CNAME: "成人疫苗僅於星期一、二、五提供。",
  GOVAREANO: "63000",
  CONT_S_DATE: "19971124",
  ...over,
});

/** Enough valid rows to clear the count gates. */
const bulk = (n: number, kind: "clinic" | "pharmacy"): NhiRecord[] =>
  Array.from({ length: n }, (_, i) =>
    clinic({
      HOSP_ID: `${kind}-${i}`,
      HOSP_NAME: `${kind} ${i}`,
      ADDRESS: "臺北市大安區辛亥路３段１５號",
    }),
  );

const input = (over: Partial<Parameters<typeof buildFromRecords>[0]> = {}) => ({
  clinics: bulk(GATES.minClinics, "clinic"),
  pharmacies: bulk(GATES.minPharmacies, "pharmacy"),
  fixedHours: [] as NhiRecord[],
  today: "20260901",
  sourceDate: "2026-09-01",
  generatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("buildFromRecords — mapping", () => {
  const result = buildFromRecords(input());

  it("shards by city and district", () => {
    expect(result.index.cities["臺北市"]!["大安區"]).toBeDefined();
    expect(result.shards.has("臺北市/大安區.json")).toBe(true);
  });

  it("records the source and generation dates for the UI", () => {
    expect(result.index.sourceDate).toBe("2026-09-01");
    expect(result.index.generatedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("counts clinics and pharmacies separately in the index", () => {
    const entry = result.index.cities["臺北市"]!["大安區"]!;
    expect(entry.counts.clinic).toBe(GATES.minClinics);
    expect(entry.counts.pharmacy).toBe(GATES.minPharmacies);
  });

  it("maps every field onto the Venue contract", () => {
    const venue = result.shards.get("臺北市/大安區.json")!.find((v) => v.id === "clinic-0")!;
    expect(venue).toEqual({
      id: "clinic-0",
      name: "clinic 0",
      kind: "clinic",
      cat: "一般診所（醫務室）",
      tel: "(02)27390997",
      addr: "臺北市大安區辛亥路３段１５號",
      spec: ["家醫科"],
      open: "N".repeat(21),
      note: "成人疫苗僅於星期一、二、五提供。",
    });
  });

  it("splits multi-value specialties and trims them", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...bulk(GATES.minClinics, "clinic"),
          clinic({ HOSP_ID: "multi", FUNCTYPE_CNAME: "內科, 眼科 ,復健科" }),
        ],
      }),
    );
    const venue = r.shards.get("臺北市/大安區.json")!.find((v) => v.id === "multi")!;
    expect(venue.spec).toEqual(["內科", "眼科", "復健科"]);
  });

  it("normalises a placeholder note to an empty string", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...bulk(GATES.minClinics, "clinic"),
          clinic({ HOSP_ID: "dash", HOLIDAY_REMARK_CNAME: "-" }),
        ],
      }),
    );
    const venue = r.shards.get("臺北市/大安區.json")!.find((v) => v.id === "dash")!;
    expect(venue.note).toBe("");
  });

  it("sorts venues stably so the daily git diff stays small", () => {
    const forward = buildFromRecords(input());
    const reversed = buildFromRecords(
      input({ clinics: [...bulk(GATES.minClinics, "clinic")].reverse() }),
    );
    expect(reversed.shards.get("臺北市/大安區.json")!.map((v) => v.id)).toEqual(
      forward.shards.get("臺北市/大安區.json")!.map((v) => v.id),
    );
  });
});

describe("buildFromRecords — filtering", () => {
  it("drops venues whose contract ended on or before today", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...bulk(GATES.minClinics, "clinic"),
          clinic({ HOSP_ID: "expired", CLOSESHOP: "20240115" }),
          clinic({ HOSP_ID: "ends-today", CLOSESHOP: "20260901" }),
          clinic({ HOSP_ID: "ends-tomorrow", CLOSESHOP: "20260902" }),
        ],
      }),
    );
    const ids = new Set(r.shards.get("臺北市/大安區.json")!.map((v) => v.id));
    expect(ids.has("expired")).toBe(false);
    expect(ids.has("ends-today")).toBe(false);
    expect(ids.has("ends-tomorrow")).toBe(true);
  });

  it("drops venues with no readable schedule and counts them", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...bulk(GATES.minClinics, "clinic"),
          clinic({ HOSP_ID: "no-hours", HOLIDAYDUTY_CNAME: "" }),
        ],
      }),
    );
    expect(r.shards.get("臺北市/大安區.json")!.some((v) => v.id === "no-hours")).toBe(false);
    expect(r.stats.clinic.hoursFailed).toBe(1);
  });

  it("keeps an unplaceable district in a visible bucket", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...bulk(GATES.minClinics, "clinic"),
          clinic({ HOSP_ID: "hsinchu", ADDRESS: "新竹市關帝里南門街８６號", GOVAREANO: "10018" }),
        ],
      }),
    );
    expect(r.index.cities["新竹市"]!["其他"]).toBeDefined();
    expect(r.shards.get("新竹市/其他.json")!.map((v) => v.id)).toEqual(["hsinchu"]);
  });
});

describe("buildFromRecords — gates", () => {
  it("aborts when the clinic count collapses", () => {
    expect(() =>
      buildFromRecords(input({ clinics: bulk(GATES.minClinics - 1, "clinic") })),
    ).toThrow(GateFailure);
  });

  it("aborts when the pharmacy count collapses", () => {
    expect(() =>
      buildFromRecords(input({ pharmacies: bulk(GATES.minPharmacies - 1, "pharmacy") })),
    ).toThrow(GateFailure);
  });

  it("aborts when the schedule parse failure rate exceeds 1%", () => {
    const total = GATES.minClinics;
    const broken = Math.ceil(total * 0.02);
    const rows = [
      ...bulk(total - broken, "clinic"),
      ...Array.from({ length: broken }, (_, i) =>
        clinic({ HOSP_ID: `broken-${i}`, HOLIDAYDUTY_CNAME: "" }),
      ),
    ];
    expect(() => buildFromRecords(input({ clinics: rows }))).toThrow(/schedule parse/i);
  });

  it("aborts when the location failure rate exceeds 2%", () => {
    const total = GATES.minClinics;
    const broken = Math.ceil(total * 0.03);
    const rows = [
      ...bulk(total - broken, "clinic"),
      ...Array.from({ length: broken }, (_, i) =>
        clinic({ HOSP_ID: `nowhere-${i}`, ADDRESS: "地址不詳", GOVAREANO: "99999" }),
      ),
    ];
    expect(() => buildFromRecords(input({ clinics: rows }))).toThrow(/location/i);
  });
});

describe("buildFromRecords — cross-check against D21006", () => {
  it("warns when the text schedule disagrees with the published bitmap", () => {
    const r = buildFromRecords(
      input({
        fixedHours: [
          { 醫事機構代碼: "clinic-0", 看診星期: "YYYYYYYYYYYYYYYYYYYYY", 開業狀況: "0" },
        ],
      }),
    );
    expect(r.warnings.join("\n")).toMatch(/clinic-0/);
  });

  it("stays silent when the two sources agree", () => {
    const r = buildFromRecords(
      input({
        fixedHours: [{ 醫事機構代碼: "clinic-0", 看診星期: "N".repeat(21), 開業狀況: "0" }],
      }),
    );
    expect(r.warnings).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/build-data.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/build-data"`.

- [ ] **Step 4: Write `scripts/build-data.ts`**

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseHours } from "../src/lib/hours";
import { parseLocation } from "../src/lib/location";
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
 * Sanity floors. Measured 2026-09-01: 24,736 clinics and 10,128 pharmacies raw;
 * parse failure 0.095% and 0.588% respectively; location failure 0.06%. These
 * thresholds sit far enough below observed values to survive normal churn and
 * far enough above to catch an upstream format change or a truncated response.
 */
export const GATES = {
  minClinics: 20_000,
  minPharmacies: 8_000,
  maxHoursFailRate: 0.01,
  maxLocationFailRate: 0.02,
} as const;

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
}

const clean = (v: string | undefined): string => {
  const t = (v ?? "").trim();
  return t === "-" ? "" : t;
};

const shardPath = (city: string, district: string) => `${city}/${district}.json`;

/** Pure transform — no IO, so the gates and mapping are fully testable. */
export function buildFromRecords(input: BuildInput): BuildResult {
  const shards = new Map<string, Venue[]>();
  const counts = new Map<string, { clinic: number; pharmacy: number }>();
  const stats = {} as Record<VenueKind, BuildStats>;
  const bitmapById = new Map<string, string>();

  for (const [kind, rows] of [
    ["clinic", input.clinics],
    ["pharmacy", input.pharmacies],
  ] as const) {
    const stat: BuildStats = { raw: rows.length, live: 0, kept: 0, hoursFailed: 0, locationFailed: 0 };

    for (const row of rows) {
      if (clean(row.CLOSESHOP) <= input.today) continue;
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

      const path = shardPath(where.city, where.district);
      (shards.get(path) ?? shards.set(path, []).get(path)!).push(venue);
      const c = counts.get(path) ?? { clinic: 0, pharmacy: 0 };
      c[kind]++;
      counts.set(path, c);
      bitmapById.set(venue.id, open);
      stat.kept++;
    }

    stats[kind] = stat;
    assertGates(kind, stat);
  }

  // Stable ordering keeps the daily commit diff to genuinely changed rows.
  for (const venues of shards.values()) {
    venues.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const cities: DataIndex["cities"] = {};
  for (const path of [...shards.keys()].sort()) {
    const [city, file] = path.split("/") as [string, string];
    const district = file.replace(/\.json$/, "");
    const entry: DistrictEntry = { file: path, counts: counts.get(path)! };
    (cities[city] ??= {})[district] = entry;
  }

  return {
    index: { generatedAt: input.generatedAt, sourceDate: input.sourceDate, cities },
    shards,
    stats,
    warnings: crossCheck(bitmapById, input.fixedHours),
  };
}

function assertGates(kind: VenueKind, stat: BuildStats): void {
  const floor = kind === "clinic" ? GATES.minClinics : GATES.minPharmacies;
  if (stat.kept < floor) {
    throw new GateFailure(
      `${kind}: kept ${stat.kept} rows, floor is ${floor} — refusing to overwrite good data`,
    );
  }
  if (stat.live > 0) {
    const hoursRate = stat.hoursFailed / stat.live;
    if (hoursRate > GATES.maxHoursFailRate) {
      throw new GateFailure(
        `${kind}: schedule parse failure ${(hoursRate * 100).toFixed(2)}% exceeds ` +
          `${(GATES.maxHoursFailRate * 100).toFixed(0)}% — upstream format probably changed`,
      );
    }
    const locationRate = stat.locationFailed / stat.live;
    if (locationRate > GATES.maxLocationFailRate) {
      throw new GateFailure(
        `${kind}: location failure ${(locationRate * 100).toFixed(2)}% exceeds ` +
          `${(GATES.maxLocationFailRate * 100).toFixed(0)}%`,
      );
    }
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
  const [clinics, pharmacies, fixedHours, sourceDate] = await Promise.all([
    fetchAll(RESOURCES.clinics),
    fetchAll(RESOURCES.pharmacies),
    fetchAll(RESOURCES.fixedHours),
    fetchDatasetModified(DATASETS.clinics),
  ]);

  const now = new Date();
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
  await writeFile(
    join(DATA_ROOT, "index.json"),
    JSON.stringify(result.index, null, 0) + "\n",
    "utf8",
  );
  for (const [path, venues] of result.shards) {
    const full = join(DATA_ROOT, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(venues, null, 0) + "\n", "utf8");
  }

  const calendar = await fetchOfficeCalendar(now.getFullYear());
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/build-data.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 6: Run the real build against the live API**

Run: `npm run build:data`

Expected output shape (exact counts drift daily):

```
clinic: raw 24736 → live 22102 → kept 22081 (hours failed 21, location failed 0)
pharmacy: raw 10128 → live 7654 → kept 7609 (hours failed 45, location failed 0)
shards: 395, source date: 2026-09-01
```

Then confirm the output on disk:

```bash
test -f data/index.json && echo "index ok"
test -f data/calendar.csv && echo "calendar ok"
ls data | head
node -e "const i=require('./data/index.json'); console.log(Object.keys(i.cities).length,'cities'); console.log(i.cities['臺北市']['大安區'])"
```

Expected: 22 cities; the 大安區 entry prints a `file` and non-zero `counts`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS — all four test files.

- [ ] **Step 8: Commit**

```bash
git add scripts/nhi.ts scripts/build-data.ts tests/build-data.test.ts data
git commit -m "feat: build sharded venue data from NHI open data with sanity gates"
```

---

### Task 6: Daily rebuild workflow

**Files:**
- Create: `.github/workflows/data.yml`

**Interfaces:**
- Consumes: `npm run build:data` (Task 5).
- Produces: a committed `data/` tree on `main`, refreshed daily.

- [ ] **Step 1: Write the workflow**

```yaml
name: data

on:
  schedule:
    # 07:30 Asia/Taipei. GitHub cron is UTC, so this is the previous UTC day.
    - cron: "30 23 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: data
  cancel-in-progress: false

jobs:
  rebuild:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - run: npm ci

      - name: Verify logic before touching data
        run: npm test

      # A gate failure exits non-zero here, so the commit step never runs and
      # yesterday's data keeps serving.
      - name: Rebuild data
        run: npm run build:data

      - name: Commit if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data
          if git diff --cached --quiet; then
            echo "no data change"
            exit 0
          fi
          git commit -m "chore(data): refresh from NHI open data"
          git push
```

- [ ] **Step 2: Trigger it manually and confirm it succeeds**

Precondition: `data.yml` must already be on `main` — `workflow_dispatch` can only
dispatch a workflow that exists on the target ref. In practice this step runs
after the merge in Task 8 Step 2.

A manual dispatch produces no new commit, so it is identified by **id**: record
the highest existing run id first, then require the selected run to exceed it.
That is unambiguous without depending on clock skew, and unlike `--limit 1` — a
snapshot that can return a stale or queued run — it cannot select something that
already existed. There is no fixed `sleep`: a guess at GitHub's queue latency
either wastes time or reads too early.

The selector also requires `event == "workflow_dispatch"` and
`headSha == "$BEFORE"`, so a run against a different commit cannot be picked up.
Two dispatches at the *same* commit remain genuinely indistinguishable — GitHub
exposes no field linking a `workflow_dispatch` to its caller — so rather than
guess, the selector requires **exactly one** match and refuses when it sees more.
That converts a silent false pass into a loud, actionable failure using only
fields that exist.

```bash
set -euo pipefail
REPO=sean1093/StillOpen

git fetch -q origin main
BEFORE=$(git rev-parse origin/main)
# `gh run list` returns newest-first and run ids increase with creation time, so
# the max over the sampled window is the newest run's id — a baseline needs only
# the newest run to be in the window. The exactly-one guards below need a
# stronger property: EVERY match must be in the window, or a second match could
# hide off the page and N=1 would be wrong. Each guard therefore checks that the
# window still reaches back past its baseline, and refuses if it does not.
#
# `|| echo 0` because a workflow absent from the default branch is UNKNOWN to
# GitHub, so `gh run list --workflow` exits non-zero with "could not find any
# workflows named …" rather than returning `[]`. Under `set -e` that aborts the
# whole block before the zero-baseline path can be reached. Verified the first
# time this ran against a repo with no history.
BEFORE_MAX=$(gh run list --workflow=data --limit 100 --json databaseId \
               --jq '[.[].databaseId] | max // 0' 2>/dev/null || echo 0)
PAGES_MAX=$(gh run list --workflow=pages --limit 100 --json databaseId \
              --jq '[.[].databaseId] | max // 0' 2>/dev/null || echo 0)
echo "main before: $BEFORE"
echo "highest existing data run id: $BEFORE_MAX"
echo "highest existing pages run id: $PAGES_MAX"

gh workflow run data --ref main

# `unique` so GitHub's re-run button, which reuses the run id, cannot read as a
# second run. Zero matches means "not created yet" and keeps waiting; more than
# one is refused rather than guessed at.
ID=""
deadline=$(( $(date +%s) + 120 ))
while [ -z "$ID" ]; do
  IDS=$(gh run list --workflow=data --limit 100 --json databaseId,event,headSha \
          --jq "[.[] | select(.databaseId > $BEFORE_MAX
                              and .event == \"workflow_dispatch\"
                              and .headSha == \"$BEFORE\") | .databaseId]
                | unique | .[]")
  N=$(printf '%s' "$IDS" | awk 'NF{n++} END{print n+0}')
  FLOOR=$(gh run list --workflow=data --limit 100 --json databaseId --jq '[.[].databaseId] | min // 0')
  # A zero baseline means no runs existed, so any window covers every candidate.
  [ "$BEFORE_MAX" -eq 0 ] || [ "$FLOOR" -le "$BEFORE_MAX" ] || { echo "FAIL: the run window no longer reaches the baseline, so a second match could be hidden; let runs finish and re-run this check"; exit 1; }
  if [ "$N" -gt 1 ]; then
    echo "FAIL: $N data dispatches are in flight at $BEFORE:"
    printf '  %s\n' $IDS
    echo "  GitHub exposes no field linking a workflow_dispatch to its caller, so"
    echo "  this check cannot tell them apart and will not guess. Wait for all of"
    echo "  them to finish, then re-run this check against a single dispatch."
    exit 1
  fi
  [ "$N" -eq 1 ] && { ID=$IDS; break; }
  [ "$(date +%s)" -ge "$deadline" ] && { echo "FAIL: dispatched data run never appeared"; exit 1; }
  sleep 5
done
echo "data run id: $ID"

deadline=$(( $(date +%s) + 1800 ))
while :; do
  out=$(gh run view "$ID" --json status,conclusion --jq '"\(.status) \(.conclusion // "-")"')
  st=${out%% *}; cc=${out##* }
  echo "  $(date -u +%H:%M:%S)Z status=$st conclusion=$cc"
  [ "$st" = "completed" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { echo "FAIL: data run $ID still '$st' after 1800s"; exit 1; }
  sleep 15
done
[ "$cc" = "success" ] || { echo "FAIL: data run $ID concluded '$cc'"; gh run view "$ID" --log-failed; exit 1; }
echo "PASS: data run $ID succeeded"
```

Expected — `data run id` must exceed `highest existing data run id`:

```
main before: <40-hex>
highest existing data run id: <digits or 0>
data run id: <larger digits>
  HH:MM:SSZ status=in_progress conclusion=-
  HH:MM:SSZ status=completed conclusion=success
PASS: data run <digits> succeeded
```

**A green run is not the whole claim.** The workflow commits only when `data/`
actually changed, so success has two legitimate outcomes — and one illegitimate
one that looks identical from the run list. Decide between them explicitly:

```bash
git fetch -q origin main
AFTER=$(git rev-parse origin/main)

# Capture the log, then match the string. Do NOT pipe it into `grep -q`: grep
# exits on the first match and closes the pipe, `gh` dies with SIGPIPE, and
# under `set -o pipefail` the pipeline reports 141 even though the text WAS
# found — which would silently invert this test on its most common outcome.
#
# Match git's OUTPUT, not the string `no data change`. `gh run view --log`
# includes the `##[group]Run …` echo of the step's own SOURCE, so the literal
# `echo "no data change"` appears in the log whether or not that branch ran.
# Matching it reported `nothing` on a run that had just committed 7 files. The
# bracket form `] chore(data)` cannot appear in the source echo — there the line
# reads `git commit -m "chore(data): …"` — so it only matches git's real output
# `[main c15c51f] chore(data): refresh from NHI open data`.
LOG=$(gh run view "$ID" --log)
if [[ $LOG == *'] chore(data): refresh from NHI open data'* ]]; then
  CLAIMED=committed
else
  CLAIMED=nothing
fi
echo "claimed: $CLAIMED"
echo "main after: $AFTER"

if [ "$CLAIMED" = nothing ]; then
  [ "$AFTER" = "$BEFORE" ] \
    || { echo "FAIL: run claimed no change but main moved $BEFORE -> $AFTER"; exit 1; }
  echo "PASS: ran and correctly found nothing to commit"
else
  # `AFTER != BEFORE` is NOT proof this run pushed: a concurrent data-only commit
  # would move main and pass. Bind the verdict to the commit THIS run created.
  # The workflow's `git commit` prints "[main <short>] chore(data): refresh…".
  BOT_SHA=$(printf '%s\n' "$LOG" \
    | sed -n 's/.*\[[^]]* \([0-9a-f]\{7,\}\)\] chore(data): refresh from NHI open data.*/\1/p' \
    | tail -1)
  [ -n "$BOT_SHA" ] \
    || { echo "FAIL: run neither reported 'no data change' nor printed a commit line"; exit 1; }
  git merge-base --is-ancestor "$BOT_SHA" "$AFTER" \
    || { echo "FAIL: the run's commit $BOT_SHA never reached origin/main — the push was lost"; exit 1; }
  git log -1 --format='%h %an %s' "$BOT_SHA"
  [ "$(git log -1 --format='%an' "$BOT_SHA")" = "github-actions[bot]" ] \
    || { echo "FAIL: $BOT_SHA was not authored by github-actions[bot]"; exit 1; }
  # `-c core.quotePath=false` because every shard filename is CJK and git quotes
  # non-ASCII paths by default, emitting `"data/\346\241\203…"`. Those start with
  # a quote, not `data/`, so the sed kept every one of them and the check failed
  # on a commit that was entirely inside data/.
  outside=$(git -c core.quotePath=false show --name-only --format= "$BOT_SHA" \
              | sed '/^data\//d;/^$/d')
  [ -z "$outside" ] \
    || { echo "FAIL: the bot commit touched files outside data/:"; printf '%s\n' "$outside"; exit 1; }
  echo "PASS: ran and committed a real data refresh ($BOT_SHA)"
fi
```

**Telling the two apart.** `no data change` is printed only when the workflow's
own `git add data && git diff --cached --quiet` found the freshly rebuilt tree
byte-identical to the committed one. That is git's comparison, not a heuristic,
so it is positive evidence that there was nothing to commit — not evidence that
the commit was skipped. The failure this distinguishes is the `else` branch:
the run rebuilt data and did **not** print `no data change`, yet `main` did not
move. That means the commit or the push was lost — a rejected non-fast-forward,
or credentials not persisted — and it would otherwise show as a perfectly green
run that silently shipped nothing.

Expected, one of exactly these two:

```
claimed: nothing
main after: <same 40-hex as before>
PASS: ran and correctly found nothing to commit
```

```
claimed: committed
main after: <new 40-hex>
<short> github-actions[bot] chore(data): refresh from NHI open data
PASS: ran and committed a real data refresh (<short>)
```

Finally, confirm the chain into deployment. A **newly created** `pages` run with
`"event": "workflow_run"` must appear — that is the GITHUB_TOKEN-suppression
workaround doing its job, and its absence means the site will never refresh.
This is the highest-value assertion in the procedure, so it is keyed three ways:
an id above the pre-dispatch baseline (newly created), `event == "workflow_run"`
(chained rather than pushed), and `headSha == "$AFTER"` (built from the `main`
this data run left behind).

Those three keys narrow it but do **not** attribute it. A `workflow_run` run
carries no reference to the run that triggered it, so if `data` were dispatched
twice at the same commit, the second dispatch's deploy would match all three
keys just as well as the first's — and a broken chain for the run under test
would be masked by its sibling. So this selector, like the dispatch selector,
requires **exactly one** match and refuses otherwise.

`$AFTER` is correct in both outcomes: it is `origin/main` after the data run,
whether or not the bot committed. If a human pushes to `main` between the data
run finishing and the chained event being created, the head moves past `$AFTER`
and this times out — a false failure, which is the safe direction.

After the `data` run has concluded:

```bash
CHAINED=""
deadline=$(( $(date +%s) + 180 ))
while [ -z "$CHAINED" ]; do
  IDS=$(gh run list --workflow=pages --limit 100 --json databaseId,event,headSha \
          --jq "[.[] | select(.databaseId > $PAGES_MAX
                              and .event == \"workflow_run\"
                              and .headSha == \"$AFTER\") | .databaseId]
                | unique | .[]")
  N=$(printf '%s' "$IDS" | awk 'NF{n++} END{print n+0}')
  FLOOR=$(gh run list --workflow=pages --limit 100 --json databaseId --jq '[.[].databaseId] | min // 0')
  # A zero baseline means no runs existed, so any window covers every candidate.
  [ "$PAGES_MAX" -eq 0 ] || [ "$FLOOR" -le "$PAGES_MAX" ] || { echo "FAIL: the run window no longer reaches the baseline, so a second match could be hidden; let runs finish and re-run this check"; exit 1; }
  if [ "$N" -gt 1 ]; then
    echo "FAIL: $N chained pages runs match $AFTER:"
    printf '  %s\n' $IDS
    echo "  A workflow_run run carries no reference to the specific run that"
    echo "  triggered it, so this cannot attribute the chain and will not guess."
    echo "  Wait for them to finish, then re-run against a single data dispatch."
    exit 1
  fi
  [ "$N" -eq 1 ] && { CHAINED=$IDS; break; }
  [ "$(date +%s)" -ge "$deadline" ] \
    && { echo "FAIL: no pages run chained off the data run — the site will never refresh"; exit 1; }
  sleep 10
done
echo "PASS: pages run $CHAINED chained off data at $AFTER (event=workflow_run)"
```

Then re-run the byte-identity block in **Task 8 Step 3** with `SHA` unset, so it
resolves `origin/main` afresh and proves the refresh actually reached the
deployed site rather than merely passing CI.

- [ ] **Step 3: Confirm the gate actually blocks a bad build**

Temporarily raise the floor above reality, run, and confirm failure:

```bash
sed -i.bak 's/minClinics: 20_000/minClinics: 99_000/' scripts/build-data.ts
npm run build:data; echo "exit=$?"
mv scripts/build-data.ts.bak scripts/build-data.ts
```

Expected: `exit=1` with a message containing `refusing to overwrite good data`.
Then confirm the working tree is clean again: `git status --short scripts/`.

- [ ] **Step 4: Commit**

```bash
git status --short
git log --oneline -3
```

Expected: no uncommitted changes under `scripts/`; the workflow commit and the
bot's data commit are both present.

---

### Task 7: The board

**Files:**
- Create: `src/ui/picker.ts`
- Create: `src/ui/board.ts`
- Create: `src/main.ts`
- Test: `tests/board.test.ts`

**Interfaces:**
- Consumes: `Venue`, `DataIndex` (Task 1), `isOpen`, `SLOTS`, `DAYS` (Task 1), `resolveSlot`, `describeSlot`, `SLOT_HOURS`, `SlotResolution` (Task 3), `parseCalendarCsv`, `classifyDay`, `toKey`, `DayClass` (Task 4).
- Produces:
  - `loadSaved(): { city: string; district: string } | null`
  - `saveChoice(city: string, district: string): void`
  - `renderPicker(root: HTMLElement, index: DataIndex, current: { city: string; district: string } | null, onPick: (city: string, district: string) => void): void`
  - `selectOpen(venues: Venue[], at: SlotResolution): Venue[]`
  - `renderBoard(root: HTMLElement, args: { venues: Venue[]; at: SlotResolution; day: DayClass; sourceDate: string }): void`

- [ ] **Step 1: Write the failing test**

`tests/board.test.ts` — covers the selection logic and the honesty copy, which
are the parts that can be wrong in a way that misleads someone looking for a
doctor. Layout is not tested.

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { selectOpen, renderBoard } from "../src/ui/board";
import { loadSaved, saveChoice } from "../src/ui/picker";
import { parseHours } from "../src/lib/hours";
import type { Venue } from "../src/lib/types";
import type { SlotResolution } from "../src/lib/slot";

const hours = (spec: Record<string, string[]>): string => {
  const cells: string[] = [];
  for (const slot of ["上午", "下午", "晚上"]) {
    for (const day of ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]) {
      cells.push(`${day}${slot}${spec[slot]?.includes(day) ? "看診" : "休診"}`);
    }
  }
  return cells.join("、");
};

const venue = (id: string, over: Partial<Venue> = {}): Venue => ({
  id,
  name: `${id} 診所`,
  kind: "clinic",
  cat: "一般診所",
  tel: "(02)12345678",
  addr: "臺北市大安區辛亥路３段１５號",
  spec: ["兒科"],
  open: parseHours(hours({ 晚上: ["星期日"] }))!,
  note: "",
  ...over,
});

const sundayEvening: SlotResolution = { kind: "in", at: { dayIndex: 6, slotIndex: 2 } };
const mondayLunch: SlotResolution = {
  kind: "gap",
  reason: "lunch",
  next: { dayIndex: 0, slotIndex: 1 },
};

describe("selectOpen", () => {
  it("keeps only venues open in the current cell", () => {
    const list = [
      venue("open-sun-eve"),
      venue("weekday-only", { open: parseHours(hours({ 上午: ["星期一"] }))! }),
    ];
    expect(selectOpen(list, sundayEvening).map((v) => v.id)).toEqual(["open-sun-eve"]);
  });

  it("uses the next session when sitting in a gap", () => {
    const list = [
      venue("mon-afternoon", { open: parseHours(hours({ 下午: ["星期一"] }))! }),
      venue("sun-evening"),
    ];
    expect(selectOpen(list, mondayLunch).map((v) => v.id)).toEqual(["mon-afternoon"]);
  });

  it("returns an empty list rather than throwing when nothing is open", () => {
    expect(selectOpen([venue("weekday", { open: "Y".repeat(21) })], sundayEvening)).toEqual([]);
  });
});

describe("renderBoard", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
  });

  const day = { holiday: false, makeUpWorkday: false, label: "" };

  it("always states the data date", () => {
    renderBoard(root, { venues: [venue("a")], at: sundayEvening, day, sourceDate: "2026-09-01" });
    expect(root.textContent).toContain("2026-09-01");
  });

  it("always states the phone-first disclaimer", () => {
    renderBoard(root, { venues: [venue("a")], at: sundayEvening, day, sourceDate: "2026-09-01" });
    expect(root.textContent).toContain("出門前請先打電話");
  });

  it("prints the session time table so 晚上 is never ambiguous", () => {
    renderBoard(root, { venues: [venue("a")], at: sundayEvening, day, sourceDate: "2026-09-01" });
    expect(root.textContent).toContain("18:00");
    expect(root.textContent).toContain("21:00");
  });

  it("shows the venue's own remark when it has one", () => {
    renderBoard(root, {
      venues: [venue("a", { note: "幼兒疫苗僅於星期三、四早上提供。" })],
      at: sundayEvening,
      day,
      sourceDate: "2026-09-01",
    });
    expect(root.textContent).toContain("幼兒疫苗僅於星期三、四早上提供。");
  });

  it("offers a tel: link", () => {
    renderBoard(root, { venues: [venue("a")], at: sundayEvening, day, sourceDate: "2026-09-01" });
    const link = root.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
    expect(link?.getAttribute("href")).toBe("tel:0212345678");
  });

  it("warns on a public holiday", () => {
    renderBoard(root, {
      venues: [venue("a")],
      at: sundayEvening,
      day: { holiday: true, makeUpWorkday: false, label: "中秋節" },
      sourceDate: "2026-09-01",
    });
    expect(root.textContent).toContain("中秋節");
    expect(root.textContent).toContain("可能與平日登記不同");
  });

  it("says so on a make-up workday", () => {
    renderBoard(root, {
      venues: [venue("a")],
      at: sundayEvening,
      day: { holiday: false, makeUpWorkday: true, label: "補行上班" },
      sourceDate: "2026-09-01",
    });
    expect(root.textContent).toContain("補班");
  });

  it("explains a gap and names the next session instead of showing nothing", () => {
    renderBoard(root, {
      venues: [venue("mon-afternoon", { open: parseHours(hours({ 下午: ["星期一"] }))! })],
      at: mondayLunch,
      day,
      sourceDate: "2026-09-01",
    });
    expect(root.textContent).toContain("午休");
    expect(root.textContent).toContain("星期一下午");
  });

  it("says plainly when nothing is open", () => {
    renderBoard(root, { venues: [], at: sundayEvening, day, sourceDate: "2026-09-01" });
    expect(root.textContent).toContain("沒有登記看診");
  });

  it("escapes venue text rather than injecting it as markup", () => {
    renderBoard(root, {
      venues: [venue("x", { name: "<img src=x onerror=alert(1)>" })],
      at: sundayEvening,
      day,
      sourceDate: "2026-09-01",
    });
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("picker persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a choice", () => {
    expect(loadSaved()).toBeNull();
    saveChoice("臺北市", "大安區");
    expect(loadSaved()).toEqual({ city: "臺北市", district: "大安區" });
  });

  it("returns null for corrupt storage rather than throwing", () => {
    localStorage.setItem("stillopen.place", "{not json");
    expect(loadSaved()).toBeNull();
  });
});
```

- [ ] **Step 2: Install jsdom and register it**

```bash
npm i -D jsdom
```

Add to `vite.config.ts`'s `test` block: `environmentMatchGlobs: [["tests/board.test.ts", "jsdom"]]`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/board.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ui/board"`.

- [ ] **Step 4: Write `src/ui/picker.ts`**

```ts
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

  citySelect.addEventListener("change", () => {
    const nextCity = citySelect.value;
    const nextDistrict = Object.keys(index.cities[nextCity] ?? {})[0]!;
    onPick(nextCity, nextDistrict);
  });
  districtSelect.addEventListener("change", () => onPick(citySelect.value, districtSelect.value));

  row.append(citySelect, districtSelect);
  root.append(row);
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
```

- [ ] **Step 5: Write `src/ui/board.ts`**

```ts
import { isOpen } from "../lib/hours";
import { SLOT_HOURS, describeSlot, type SlotPosition, type SlotResolution } from "../lib/slot";
import type { DayClass } from "../lib/calendar";
import type { Venue } from "../lib/types";

const positionOf = (at: SlotResolution): SlotPosition => (at.kind === "in" ? at.at : at.next);

/** Venues open in the cell the user actually cares about right now. */
export function selectOpen(venues: Venue[], at: SlotResolution): Venue[] {
  const { dayIndex, slotIndex } = positionOf(at);
  return venues.filter((v) => isOpen(v.open, dayIndex, slotIndex));
}

export interface BoardArgs {
  venues: Venue[];
  at: SlotResolution;
  day: DayClass;
  sourceDate: string;
}

/**
 * Render the list. Every branch here is written on the assumption that someone
 * is holding a sick child — so it never shows an empty screen without saying
 * why, and it never implies a guarantee the data cannot support.
 */
export function renderBoard(root: HTMLElement, args: BoardArgs): void {
  const { venues, at, day, sourceDate } = args;
  const position = positionOf(at);
  const open = selectOpen(venues, at);

  root.replaceChildren();

  root.append(
    heading(
      at.kind === "in" ? `${describeSlot(position)} 還開著` : `現在${gapWord(at)}`,
      at.kind === "in" ? slotTimeLabel(position.slotIndex) : `下一個時段：${describeSlot(position)}`,
    ),
  );

  if (day.holiday) {
    root.append(
      notice(`今天是${day.label}，院所看診時段可能與平日登記不同，建議先電話確認。`),
    );
  } else if (day.makeUpWorkday) {
    root.append(notice("今日補班，多數院所仍依週末時段營業。"));
  }

  if (open.length === 0) {
    root.append(
      paragraph("這個行政區在這個時段沒有登記看診的診所或藥局。試試相鄰行政區，或改看下一個時段。"),
    );
  } else {
    const list = document.createElement("ul");
    list.className = "mt-5 divide-y divide-hair border-y border-hair";
    for (const v of open) list.append(venueRow(v));
    root.append(list);
  }

  root.append(footer(sourceDate));
}

const gapWord = (at: SlotResolution): string =>
  at.kind === "gap" && at.reason === "lunch" ? "是午休時間" : "多數院所已打烊";

function slotTimeLabel(slotIndex: number): string {
  const pair = SLOT_HOURS[slotIndex];
  if (!pair) return "";
  const [start, end] = pair;
  return `本站定義：${String(start).padStart(2, "0")}:00 – ${String(end).padStart(2, "0")}:00`;
}

function heading(title: string, sub: string): HTMLElement {
  const wrap = document.createElement("header");
  const h1 = document.createElement("h1");
  h1.className = "text-2xl font-medium tracking-tight";
  h1.textContent = title;
  const p = document.createElement("p");
  p.className = "mt-1 text-sm text-muted";
  p.textContent = sub;
  wrap.append(h1, p);
  return wrap;
}

function venueRow(v: Venue): HTMLElement {
  const li = document.createElement("li");
  li.className = "py-4";

  const top = document.createElement("div");
  top.className = "flex items-baseline justify-between gap-3";
  const name = document.createElement("span");
  name.className = "font-medium";
  name.textContent = v.name;
  const kind = document.createElement("span");
  kind.className = "shrink-0 text-xs text-muted";
  kind.textContent = v.kind === "pharmacy" ? "藥局" : v.cat;
  top.append(name, kind);

  const addr = document.createElement("p");
  addr.className = "mt-1 text-sm text-muted";
  addr.textContent = v.addr;

  li.append(top, addr);

  if (v.spec.length > 0) {
    const spec = document.createElement("p");
    spec.className = "mt-1 text-sm text-ink/80";
    spec.textContent = v.spec.join("・");
    li.append(spec);
  }

  if (v.note) {
    const note = document.createElement("p");
    note.className = "mt-2 rounded bg-shut/10 px-2 py-1 text-sm text-shut";
    note.textContent = v.note;
    li.append(note);
  }

  if (v.tel) {
    const tel = document.createElement("a");
    tel.className = "mt-2 inline-block text-sm text-open underline";
    tel.href = `tel:${v.tel.replace(/[^\d+]/g, "")}`;
    tel.textContent = `打電話 ${v.tel}`;
    li.append(tel);
  }

  return li;
}

function notice(text: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "mt-4 rounded border border-shut/30 bg-shut/10 px-3 py-2 text-sm text-shut";
  el.textContent = text;
  return el;
}

function paragraph(text: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "mt-6 text-sm text-muted";
  el.textContent = text;
  return el;
}

function footer(sourceDate: string): HTMLElement {
  const el = document.createElement("footer");
  el.className = "mt-8 space-y-2 border-t border-hair pt-4 text-xs leading-relaxed text-muted";

  const freshness = document.createElement("p");
  freshness.textContent = `資料日期 ${sourceDate}，每日自健保署開放資料更新。`;

  const caveat = document.createElement("p");
  caveat.textContent =
    "看診時段由院所每月申報，臨時休診無法反映；「晚上」不保證營業到幾點。" +
    "本站提供的是候選清單與電話，不是保證 —— 出門前請先打電話。";

  const attribution = document.createElement("p");
  attribution.textContent =
    "資料來源：衛生福利部中央健康保險署「健保特約醫事機構」開放資料、" +
    "行政院人事行政總處「政府行政機關辦公日曆表」。依政府資料開放授權條款第 1 版利用。";

  el.append(freshness, caveat, attribution);
  return el;
}
```

- [ ] **Step 6: Write `src/main.ts`**

```ts
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
  const initial =
    saved && index.cities[saved.city]?.[saved.district]
      ? saved
      : firstPlace(index);
  await show(initial);
}

function firstPlace(index: DataIndex): Place {
  const city = Object.keys(index.cities)[0]!;
  return { city, district: Object.keys(index.cities[city]!)[0]! };
}

start().catch((err) => {
  app.textContent = `資料載入失敗：${err instanceof Error ? err.message : String(err)}`;
});
```

- [ ] **Step 7: Point Vite at the committed data**

`data/` must ship as static assets. Set `publicDir` correctly in
`vite.config.ts`, replacing the placeholder written in Task 1 Step 2:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "/StillOpen/",
  build: { outDir: "dist" },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["tests/board.test.ts", "jsdom"]],
  },
});
```

Then create `public/` as a symlink-free copy step in `package.json`:

```json
{
  "scripts": {
    "prebuild": "rm -rf public/data && mkdir -p public && cp -R data public/data",
    "build": "vite build"
  }
}
```

Add `public/` to `.gitignore`:

```bash
echo "public/" >> .gitignore
```

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS — all five test files, 15 new board tests among them.

- [ ] **Step 9: Smoke-test the real thing in a browser**

```bash
npm run build && npm run preview
```

Open the printed URL. Verify by eye:
1. A city and district select appear, defaulting to the first city.
2. The heading names the current session or explains the gap.
3. Every row shows name, address, specialties, and a tappable phone link.
4. The footer shows the data date, the phone-first caveat, and the attribution.
5. Change district → the list changes. Reload → the choice persisted.

- [ ] **Step 10: Commit**

```bash
git add src/ui/picker.ts src/ui/board.ts src/main.ts tests/board.test.ts \
  vite.config.ts package.json package-lock.json .gitignore
git commit -m "feat: render the open-now board with district picker"
```

---

### Task 8: Publish

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run build` (Task 7).
- Produces: a live site at `https://sean1093.github.io/StillOpen/`.

- [ ] **Step 1: Write the deploy workflow**

```yaml
name: pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - run: npm ci
      - run: npm test
      - run: npm run build

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Enable Pages and deploy**

Run in `bash`. Every check below either proves what it claims or exits non-zero;
there is no `|| true` anywhere, and no step accepts "the latest run" as evidence.

```bash
set -euo pipefail
REPO=sean1093/StillOpen

# Record the run-id baseline BEFORE the push, so the deploy run can be required
# to be newly created. A prior run can carry the same headSha — for example one
# triggered by this push before Pages was enabled, or an earlier deploy of the
# same commit — and selecting it would report PASS without ever validating this
# attempt.
# `|| echo 0`: a workflow absent from the default branch is unknown to GitHub,
# so this exits non-zero rather than returning `[]`, aborting under `set -e`.
PAGES_MAX=$(gh run list --workflow=pages --limit 100 --json databaseId \
              --jq '[.[].databaseId] | max // 0' 2>/dev/null || echo 0)
echo "highest existing pages run id: $PAGES_MAX"

# The workflow is already committed. Publishing it to main is what triggers the
# first deploy: a human push is not GITHUB_TOKEN-suppressed, so `pages` starts on
# its own. Do not `gh workflow run pages` here — then you cannot tell which
# trigger you observed, which is the thing being verified.
git checkout main
git merge --ff-only feat/v1
git push
SHA=$(git rev-parse HEAD)
echo "deploying commit $SHA"

# Enable Pages. 201 = created, 409 = already enabled. Anything else — 401/403
# auth, 404 wrong repo, 422 bad config — is a real failure and must stop here,
# otherwise a pre-existing successful run makes broken setup look fine.
if err=$(gh api -X POST "repos/$REPO/pages" -f build_type=workflow 2>&1 >/dev/null); then
  echo "pages: created"
elif [[ $err == *"HTTP 409"* ]]; then
  echo "pages: already enabled, continuing"
else
  echo "FAIL: could not enable Pages"; printf '%s\n' "$err"; exit 1
fi

# Assert the resulting state. Printing the fields would pass for ANY build_type,
# including a legacy branch-based Pages config that will never serve this
# workflow's artifact, so the value is tested rather than displayed.
PAGES_STATE=$(gh api "repos/$REPO/pages" --jq '"\(.build_type) \(.status) \(.html_url)"')
echo "pages state: $PAGES_STATE"
[ "${PAGES_STATE%% *}" = workflow ] \
  || { echo "FAIL: Pages build_type is '${PAGES_STATE%% *}', expected 'workflow'"; exit 1; }
```

Expected — `status` may be `building` this early, which is fine; the run poll
below is the real gate. `build_type` is asserted, not merely shown:

```
highest existing pages run id: <digits or 0>
deploying commit <40-hex>
pages: created                  # or: pages: already enabled, continuing
pages state: workflow built https://sean1093.github.io/StillOpen/
```

Now identify the run **for this deployment attempt** and poll it to a terminal
conclusion. `gh run list --limit 1` is a snapshot: it can return an older
successful run, or one still queued, and either would be mistaken for proof.
Matching `headSha` alone is not enough either — a prior run can carry the same
commit. Requiring **both** a matching `headSha` and an id above the pre-push
baseline pins it to this attempt: the SHA proves it is building the right tree,
the id proves it is not a recycled result.

```bash
# `unique` so a re-run, which reuses the id, cannot read as a second run. Zero
# matches means "not created yet" and keeps waiting; more than one is refused.
ID=""
deadline=$(( $(date +%s) + 120 ))
while [ -z "$ID" ]; do
  IDS=$(gh run list --workflow=pages --limit 100 --json databaseId,headSha \
          --jq "[.[] | select(.headSha == \"$SHA\"
                              and .databaseId > $PAGES_MAX) | .databaseId]
                | unique | .[]")
  N=$(printf '%s' "$IDS" | awk 'NF{n++} END{print n+0}')
  FLOOR=$(gh run list --workflow=pages --limit 100 --json databaseId --jq '[.[].databaseId] | min // 0')
  # A zero baseline means no runs existed, so any window covers every candidate.
  [ "$PAGES_MAX" -eq 0 ] || [ "$FLOOR" -le "$PAGES_MAX" ] || { echo "FAIL: the run window no longer reaches the baseline, so a second match could be hidden; let runs finish and re-run this check"; exit 1; }
  if [ "$N" -gt 1 ]; then
    echo "FAIL: $N new pages runs match $SHA:"
    printf '  %s\n' $IDS
    echo "  Cannot tell which belongs to this deployment attempt, and will not"
    echo "  guess. Wait for them to finish, then re-run this check."
    exit 1
  fi
  [ "$N" -eq 1 ] && { ID=$IDS; break; }
  [ "$(date +%s)" -ge "$deadline" ] && { echo "FAIL: no new pages run for $SHA after 120s"; exit 1; }
  sleep 5
done
echo "pages run id: $ID"

deadline=$(( $(date +%s) + 900 ))
while :; do
  out=$(gh run view "$ID" --json status,conclusion --jq '"\(.status) \(.conclusion // "-")"')
  st=${out%% *}; cc=${out##* }
  echo "  $(date -u +%H:%M:%S)Z status=$st conclusion=$cc"
  [ "$st" = "completed" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { echo "FAIL: pages run $ID still '$st' after 900s"; exit 1; }
  sleep 10
done
[ "$cc" = "success" ] || { echo "FAIL: pages run $ID concluded '$cc'"; gh run view "$ID" --log-failed; exit 1; }
echo "PASS: pages run $ID succeeded for $SHA"
```

Expected — the run id must be newly created, and the last line must appear:

```
pages run id: <digits>
  HH:MM:SSZ status=in_progress conclusion=-
  HH:MM:SSZ status=in_progress conclusion=-
  HH:MM:SSZ status=completed conclusion=success
PASS: pages run <digits> succeeded for <40-hex>
```

Any other terminal `conclusion` (`failure`, `cancelled`, `timed_out`,
`action_required`) exits non-zero and dumps the failing logs. If the run was
created before Pages was enabled it fails inside `deploy-pages`; re-run it with
`gh run rerun "$ID"` and poll again rather than debugging the workflow.

- [ ] **Step 3: Verify the live site serves real data**

```bash
set -euo pipefail
BASE=https://sean1093.github.io/StillOpen
SHA=${SHA:-$(git rev-parse origin/main)}

curl -fsS "$BASE/data/index.json" -o /tmp/live-index.json \
  || { echo "FAIL: index.json not served"; exit 1; }
node -e "
const i=JSON.parse(require('fs').readFileSync('/tmp/live-index.json','utf8'));
console.log('sourceDate', i.sourceDate);
console.log('generatedAt', i.generatedAt);
const cities=Object.keys(i.cities).length;
const districts=Object.values(i.cities).reduce((n,c)=>n+Object.keys(c).length,0);
const da=i.cities['臺北市']?.['大安區'];
console.log('cities', cities);
console.log('districts', districts);
console.log('臺北市 大安區', JSON.stringify(da));
// Assert, do not merely display: a truncated or half-written index would print
// small numbers and sail on to the next command. Exact equality is left to the
// byte-identity check below, so these are the invariants that hold across any
// rebuild.
const bad=[];
if(!/^\d{4}-\d{2}-\d{2}$/.test(i.sourceDate||'')) bad.push('sourceDate malformed');
if(Number.isNaN(Date.parse(i.generatedAt||''))) bad.push('generatedAt unparseable');
if(cities<22) bad.push(\`cities \${cities} < 22\`);
if(districts<393) bad.push(\`districts \${districts} < 393\`);
if(!da||!(da.counts?.clinic>0)) bad.push('臺北市 大安區 missing or has no clinics');
if(bad.length){console.error('FAIL: '+bad.join('; '));process.exit(1)}
console.log('PASS: index.json structurally sound');
"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
echo "index.html $code"
[ "$code" = 200 ] || { echo "FAIL: site root not served"; exit 1; }
```

Expected — 22 cities, 393 districts, a non-zero 大安區 count, and a 200. The
floors are `>=`, not `==`, so a later rebuild that legitimately adds a district
does not fail; shrinkage, which is what a truncated deploy looks like, does:

```
sourceDate 2026-08-31
generatedAt 2026-09-01T07:53:15.338Z
cities 22
districts 393
臺北市 大安區 {"file":"臺北市/大安區.json","counts":{"clinic":642,"pharmacy":96}}
PASS: index.json structurally sound
index.html 200
```

**Deployed successfully and deployed the current data are different claims.**
Prove the second one by comparing the served index byte-for-byte against the
commit that was actually deployed:

```bash
live=$(shasum -a 256 < /tmp/live-index.json | cut -d' ' -f1)
want=$(git show "$SHA:data/index.json" | shasum -a 256 | cut -d' ' -f1)
echo "live   $live"
echo "commit $want"
if [ "$live" != "$want" ]; then
  echo "FAIL: deployed index.json is not the one committed at $SHA"
  echo "  live   generatedAt: $(node -pe "JSON.parse(require('fs').readFileSync('/tmp/live-index.json','utf8')).generatedAt")"
  echo "  commit generatedAt: $(git show "$SHA:data/index.json" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).generatedAt")"
  exit 1
fi
echo "PASS: deployed index.json is byte-identical to $SHA"
```

Expected: two identical hashes and the `PASS` line. On mismatch the two
`generatedAt` values are printed side by side — an **older** live value is a
stale deploy, which is the failure this pipeline is shaped to prevent. Re-run
this same block after any later deploy (including a cron-chained one) to prove
that refresh reached the site.

**The CJK shard path is the most likely way this deployment silently
half-works.** Shard filenames contain Chinese characters; `src/main.ts` fetches
`${import.meta.env.BASE_URL}data/${entry.file}` with `entry.file` holding raw
CJK, which `fetch()` percent-encodes on the way out. That path has only ever
been exercised against Vite's preview server. Pages is a different host:

```bash
# data/臺北市/大安區.json, percent-encoded exactly as the browser sends it
SHARD='data/%E8%87%BA%E5%8C%97%E5%B8%82/%E5%A4%A7%E5%AE%89%E5%8D%80.json'
code=$(curl -s -o /tmp/live-shard.json -w '%{http_code}' "$BASE/$SHARD")
echo "cjk shard $code"
[ "$code" = 200 ] || { echo "FAIL: CJK shard path not served"; exit 1; }
node -e "
const fs=require('fs');
const v=JSON.parse(fs.readFileSync('/tmp/live-shard.json','utf8'));
const c=JSON.parse(fs.readFileSync('/tmp/live-index.json','utf8')).cities['臺北市']['大安區'].counts;
const want=c.clinic+c.pharmacy;
console.log('venues', v.length, '| index says', want);
if(v.length!==want){console.error('FAIL: shard and index disagree');process.exit(1)}
console.log('PASS: CJK shard served and consistent with index');
"
```

Expected (the count is derived from the live index, so it stays correct after
any rebuild; today it is 738 = 642 clinics + 96 pharmacies):

```
cjk shard 200
venues 738 | index says 738
PASS: CJK shard served and consistent with index
```

A `404` here while Step 3's `index.json` returned 200 is the half-working case:
the board renders, the city list populates, and every district you click is
empty.

- [ ] **Step 4: Confirm the scarcity claim holds on the live data**

The premise of the product is that Sunday evenings are scarce. Verify it against
what actually shipped:

```bash
node -e "
const fs=require('fs'),path='data';
let all=[];
for(const c of fs.readdirSync(path)){
  const p=path+'/'+c;
  if(!fs.statSync(p).isDirectory())continue;
  for(const f of fs.readdirSync(p)) all.push(...JSON.parse(fs.readFileSync(p+'/'+f,'utf8')));
}
const openAt=(v,d,s)=>v.open[s*7+d]==='N';
const clinics=all.filter(v=>v.kind==='clinic');
console.log('clinics', clinics.length);
console.log('sunday evening', clinics.filter(v=>openAt(v,6,2)).length);
console.log('paediatrics, sunday evening',
  clinics.filter(v=>v.spec.some(s=>s.includes('兒科'))&&openAt(v,6,2)).length);
"
```

Expected order of magnitude: ~22,000 clinics, ~900 open Sunday evening, ~170
with paediatrics. A wildly different number means the bitmap indexing is wrong
and must be fixed before launch.

- [ ] **Step 5: Update the README**

Replace the status line with the live link and mark v1 shipped:

```markdown
- **狀態：** v1 上線 — <https://sean1093.github.io/StillOpen/>
  設計文件見 [`docs/superpowers/specs/2026-09-01-stillopen-design.md`](docs/superpowers/specs/2026-09-01-stillopen-design.md)，
  實作計畫見 [`docs/superpowers/plans/2026-09-01-stillopen-v1.md`](docs/superpowers/plans/2026-09-01-stillopen-v1.md)
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: link the live site"
git push
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task:

| Spec | Task |
|---|---|
| §2 product definition, board-first | 7 |
| §2.1 non-goals (no map/GPS/hospitals/accounts) | Not built — asserted by Global Constraints |
| §3 data sources and endpoint format | 5 (`scripts/nhi.ts`) |
| §3.1 field semantics, `CLOSESHOP` filter | 5 |
| §3.2 no coordinates | 2 (district-only location) |
| §4 architecture, daily cron | 5, 6 |
| §4.1 commit data to repo | 6 |
| §4.2 output format and bitmap encoding | 1 (`types.ts`), 5 (sharding) |
| §5.1 three sessions, no clock times | 3, and printed by 7 |
| §5.2 manual district, `localStorage` | 7 (`picker.ts`) |
| §5.3 holiday degradation, D21007 gap | 4, 7 |
| §5.4 sanity gates and abort behaviour | 5 (gates), 6 (gate verified live) |
| §5.5 honesty copy in the UI | 7 (asserted by test) |
| §6 v2 geocoding | Deliberately absent |
| §7 tech stack | 1 |
| §8 testing strategy | 1–5, 7 |
| §9 attribution | 7 (`footer`) |

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N".
Every code step carries runnable code. The one forward reference — Task 1 Step 2
writing a throwaway `publicDir` line that Task 7 Step 7 replaces — is called out
explicitly at both ends.

**Type consistency.** Checked across tasks: `HoursBitmap`, `Venue`,
`DistrictEntry`, `DataIndex` (Task 1) are consumed unchanged by Tasks 5 and 7.
`SlotResolution`/`SlotPosition` (Task 3) flow into `selectOpen` and `renderBoard`
(Task 7) with matching shapes. `DayClass` (Task 4) is the `day` argument of
`renderBoard`. `NhiRecord` (Task 5, `scripts/nhi.ts`) is what
`buildFromRecords` accepts and what the Task 5 test fixtures produce.
`UNKNOWN_DISTRICT` (Task 2) is the value Task 5's bucket test asserts.
`parseLocation` returns `Location | null` in Task 2 and is null-checked in Task 5.
`GATES` is exported from `scripts/build-data.ts` and imported by both its own
test and — for floor values — nothing else.
