// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DataIndex, Venue } from "../src/lib/types";

/**
 * Wiring tests for `src/main.ts`. The module runs on import, so each test sets
 * up `#app`, stubs `fetch`, then re-imports it. Shard responses are deferred so
 * a test can land them out of order — which is the whole point: a board of one
 * district's clinics under a picker reading another is the failure this product
 * exists to prevent.
 */

type District = "大安區" | "中正區";

/** Open in all 21 cells, so a row renders whatever the wall clock says. */
const ALWAYS_OPEN = "N".repeat(21);

const INDEX: DataIndex = {
  generatedAt: "2026-09-01T00:00:00.000Z",
  sourceDate: "2026-08-31",
  cities: {
    臺北市: {
      大安區: { file: "臺北市/大安區.json", counts: { clinic: 1, pharmacy: 0 } },
      中正區: { file: "臺北市/中正區.json", counts: { clinic: 1, pharmacy: 0 } },
    },
  },
};

/** Named so it can never be confused with a picker option label like 大安區（1）. */
const venue = (name: string): Venue => ({
  id: name,
  name,
  kind: "clinic",
  cat: "一般診所",
  tel: "(02)12345678",
  addr: "臺北市",
  spec: [],
  open: ALWAYS_OPEN,
  note: "",
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * `Promise.withResolvers` is ES2024 and this project's locked `tsconfig.json`
 * declares `lib: ["ES2022", "DOM"]`, so the typed form is not available here.
 */
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** district → the shard response this test controls. */
let shards: Record<District, Deferred<Venue[]>>;

/**
 * Drain the mocked fetch chain. Every mock settles without real I/O, so the
 * continuations form a short bounded chain of microtasks — draining them costs
 * no wall-clock time and is deterministic, unlike a timer.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function boot(): Promise<void> {
  // Dynamic import is required, not stylistic: `main.ts` runs its whole start-up
  // as an import side effect, so it must be loaded *after* `#app` and the fetch
  // stub exist, and re-loaded per test via `vi.resetModules()`. A static import
  // would run once, before any of that setup.
  await import("../src/main");
  await settle();
}

const text = (): string => document.getElementById("app")?.textContent ?? "";

const districtSelect = (): HTMLSelectElement =>
  document.getElementById("picker-district") as HTMLSelectElement;

async function pick(district: District): Promise<void> {
  const select = districtSelect();
  select.value = district;
  select.dispatchEvent(new Event("change"));
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<main id="app"></main>';
  shards = { 大安區: defer<Venue[]>(), 中正區: defer<Venue[]>() };

  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("index.json")) return { ok: true, status: 200, json: async () => INDEX };
    if (url.endsWith("calendar.csv")) return { ok: false, status: 404, text: async () => "" };
    for (const [district, pending] of Object.entries(shards)) {
      if (url.includes(district)) {
        return { ok: true, status: 200, json: async () => await pending.promise };
      }
    }
    return { ok: false, status: 404, json: async () => [] };
  });

  vi.resetModules();
});

afterEach(() => {
  // Leave nothing dangling, or a detached earlier run could settle mid-test.
  for (const pending of Object.values(shards)) pending.resolve([]);
  vi.unstubAllGlobals();
});

describe("district selection", () => {
  it("ignores a stale shard that lands after a newer selection", async () => {
    await boot();
    shards.大安區.resolve([venue("大安診所")]);
    await settle();
    expect(text()).toContain("大安診所");

    // Two quick taps: 中正區, then straight back to 大安區 while 中正區 is in flight.
    await pick("中正區");
    await pick("大安區");
    expect(text()).toContain("大安診所");

    shards.中正區.resolve([venue("中正診所")]);
    await settle();

    expect(text()).toContain("大安診所");
    expect(text()).not.toContain("中正診所");
    expect(districtSelect().value).toBe("大安區");
  });

  it("surfaces a shard failure for a district picked after the first render", async () => {
    await boot();
    shards.大安區.resolve([venue("大安診所")]);
    await settle();

    await pick("中正區");
    shards.中正區.reject(new Error("HTTP 503"));
    await settle();

    expect(text()).toContain("資料載入失敗");
    expect(text()).not.toContain("大安診所");
    // The picker must survive and keep showing what the user actually chose,
    // rather than silently reverting and hiding that anything went wrong.
    expect(districtSelect()).not.toBeNull();
    expect(districtSelect().value).toBe("中正區");
  });

  it("does not report a superseded selection's failure over a newer board", async () => {
    await boot();
    shards.大安區.resolve([venue("大安診所")]);
    await settle();

    await pick("中正區");
    await pick("大安區");

    shards.中正區.reject(new Error("HTTP 503"));
    await settle();

    expect(text()).toContain("大安診所");
    expect(text()).not.toContain("資料載入失敗");
  });

  it("reports a failure to load the index at all", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await boot();

    expect(text()).toContain("資料載入失敗");
  });
});
