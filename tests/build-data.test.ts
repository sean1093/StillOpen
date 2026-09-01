import { describe, it, expect } from "vitest";
import { buildFromRecords, GateFailure, GATES, type BuildInput } from "../scripts/build-data";
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

/** Distinctly-identified valid rows, all in 臺北市大安區. */
const rows = (n: number, kind: "clinic" | "pharmacy"): NhiRecord[] =>
  Array.from({ length: n }, (_, i) => clinic({ HOSP_ID: `${kind}-${i}`, HOSP_NAME: `${kind} ${i}` }));

/**
 * Permissive floors, so a handful of rows exercises exactly the code paths
 * 20,000 would. The production thresholds are pinned separately against the
 * exported `GATES`; these tests pin the gate *mechanism*.
 */
const testGates = (over: Partial<typeof GATES> = {}): typeof GATES => ({
  minClinics: 1,
  minPharmacies: 1,
  maxHoursFailRate: 1,
  maxLocationFailRate: 1,
  maxUnknown: 99,
  ...over,
});

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  clinics: rows(3, "clinic"),
  pharmacies: rows(2, "pharmacy"),
  fixedHours: [],
  today: "20260901",
  sourceDate: "2026-09-01",
  generatedAt: "2026-09-01T00:00:00.000Z",
  gates: testGates(),
  ...over,
});

const TAIPEI_DAAN = "臺北市/大安區.json";

describe("buildFromRecords — mapping", () => {
  const result = buildFromRecords(input());

  it("shards by city and district", () => {
    expect(result.index.cities["臺北市"]!["大安區"]!.file).toBe(TAIPEI_DAAN);
    expect(result.shards.has(TAIPEI_DAAN)).toBe(true);
  });

  it("records the source and generation dates for the UI", () => {
    expect(result.index.sourceDate).toBe("2026-09-01");
    expect(result.index.generatedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("counts clinics and pharmacies separately in the index", () => {
    expect(result.index.cities["臺北市"]!["大安區"]!.counts).toEqual({ clinic: 3, pharmacy: 2 });
  });

  it("maps every field onto the Venue contract", () => {
    const venue = result.shards.get(TAIPEI_DAAN)!.find((v) => v.id === "clinic-0")!;
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
        clinics: [...rows(3, "clinic"), clinic({ HOSP_ID: "multi", FUNCTYPE_CNAME: "內科, 眼科 ,復健科" })],
      }),
    );
    const venue = r.shards.get(TAIPEI_DAAN)!.find((v) => v.id === "multi")!;
    expect(venue.spec).toEqual(["內科", "眼科", "復健科"]);
  });

  it("normalises a placeholder note to an empty string", () => {
    const r = buildFromRecords(
      input({
        clinics: [...rows(3, "clinic"), clinic({ HOSP_ID: "dash", HOLIDAY_REMARK_CNAME: "-" })],
      }),
    );
    const venue = r.shards.get(TAIPEI_DAAN)!.find((v) => v.id === "dash")!;
    expect(venue.note).toBe("");
  });

  it("sorts venues by id so the daily git diff stays small", () => {
    const reversed = buildFromRecords(
      input({
        clinics: rows(3, "clinic").reverse(),
        pharmacies: rows(2, "pharmacy").reverse(),
      }),
    );
    expect(reversed.shards.get(TAIPEI_DAAN)!.map((v) => v.id)).toEqual([
      "clinic-0",
      "clinic-1",
      "clinic-2",
      "pharmacy-0",
      "pharmacy-1",
    ]);
  });
});

describe("buildFromRecords — filtering", () => {
  it("expires a venue only once its contract end date has arrived", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...rows(3, "clinic"),
          clinic({ HOSP_ID: "expired", CLOSESHOP: "20240115" }),
          clinic({ HOSP_ID: "ends-today", CLOSESHOP: "20260901" }),
          clinic({ HOSP_ID: "ends-tomorrow", CLOSESHOP: "20260902" }),
          // No termination recorded, so nothing has expired. Comparing the raw
          // field would sort "" before every date and silently drop this venue.
          clinic({ HOSP_ID: "no-end-date", CLOSESHOP: "" }),
        ],
      }),
    );
    const ids = new Set(r.shards.get(TAIPEI_DAAN)!.map((v) => v.id));
    expect(ids.has("expired")).toBe(false);
    expect(ids.has("ends-today")).toBe(false);
    expect(ids.has("ends-tomorrow")).toBe(true);
    expect(ids.has("no-end-date")).toBe(true);
    expect(r.stats.clinic.live).toBe(5);
  });

  it("drops venues with no readable schedule and counts them", () => {
    const r = buildFromRecords(
      input({
        clinics: [...rows(3, "clinic"), clinic({ HOSP_ID: "no-hours", HOLIDAYDUTY_CNAME: "" })],
      }),
    );
    expect(r.shards.get(TAIPEI_DAAN)!.some((v) => v.id === "no-hours")).toBe(false);
    expect(r.stats.clinic.hoursFailed).toBe(1);
  });

  it("drops venues that cannot be placed at all and counts them", () => {
    // Neither the address prefix nor GOVAREANO resolves, so there is no shard
    // to put it in — unlike a missing district, which still has a city.
    const r = buildFromRecords(
      input({
        clinics: [
          ...rows(3, "clinic"),
          clinic({ HOSP_ID: "nowhere", ADDRESS: "地址不詳", GOVAREANO: "99999" }),
        ],
      }),
    );
    expect(r.stats.clinic.locationFailed).toBe(1);
    expect(r.stats.clinic.kept).toBe(3);
  });

  it("keeps an unplaceable district in a visible bucket", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...rows(3, "clinic"),
          clinic({ HOSP_ID: "hsinchu", ADDRESS: "新竹市關帝里南門街８６號", GOVAREANO: "10018" }),
        ],
      }),
    );
    expect(r.index.cities["新竹市"]!["其他"]).toBeDefined();
    expect(r.shards.get("新竹市/其他.json")!.map((v) => v.id)).toEqual(["hsinchu"]);
  });
});

describe("buildFromRecords — gates", () => {
  it("aborts when the clinic count falls below the floor", () => {
    const gates = testGates({ minClinics: 3 });
    expect(() => buildFromRecords(input({ gates, clinics: rows(3, "clinic") }))).not.toThrow();
    expect(() => buildFromRecords(input({ gates, clinics: rows(2, "clinic") }))).toThrow(GateFailure);
  });

  it("aborts when the pharmacy count falls below the floor", () => {
    const gates = testGates({ minPharmacies: 2 });
    expect(() => buildFromRecords(input({ gates, pharmacies: rows(2, "pharmacy") }))).not.toThrow();
    expect(() =>
      buildFromRecords(input({ gates, pharmacies: rows(1, "pharmacy") })),
    ).toThrow(GateFailure);
  });

  it("aborts when the schedule parse failure rate exceeds the ceiling", () => {
    const gates = testGates({ maxHoursFailRate: 0.25 });
    const withBroken = (broken: number): NhiRecord[] => [
      ...rows(4 - broken, "clinic"),
      ...Array.from({ length: broken }, (_, i) =>
        clinic({ HOSP_ID: `broken-${i}`, HOLIDAYDUTY_CNAME: "" }),
      ),
    ];
    // 1 of 4 live rows sits exactly on the ceiling; 2 of 4 is over it.
    expect(() => buildFromRecords(input({ gates, clinics: withBroken(1) }))).not.toThrow();
    expect(() => buildFromRecords(input({ gates, clinics: withBroken(2) }))).toThrow(
      /schedule parse/i,
    );
  });

  it("aborts when the location failure rate exceeds the ceiling", () => {
    const gates = testGates({ maxLocationFailRate: 0.25 });
    const withNowhere = (broken: number): NhiRecord[] => [
      ...rows(4 - broken, "clinic"),
      ...Array.from({ length: broken }, (_, i) =>
        clinic({ HOSP_ID: `nowhere-${i}`, ADDRESS: "地址不詳", GOVAREANO: "99999" }),
      ),
    ];
    expect(() => buildFromRecords(input({ gates, clinics: withNowhere(1) }))).not.toThrow();
    expect(() => buildFromRecords(input({ gates, clinics: withNowhere(2) }))).toThrow(/location/i);
  });

  it("pins the production thresholds a real collapse has to trip", () => {
    // Deliberate values, compared against the KEPT count. Observed 2026-09-01:
    // 22,081 clinics and 7,610 pharmacies kept. A floor derived from the raw
    // counts instead would put minPharmacies at 8,000 — above the value it is
    // checked against, failing every build. Change these only with fresh
    // measurements from a live run.
    expect(GATES).toEqual({
      minClinics: 20_000,
      minPharmacies: 7_000,
      maxHoursFailRate: 0.01,
      maxLocationFailRate: 0.02,
      maxUnknown: 50,
    });
  });
});

describe("buildFromRecords — cross-check against D21006", () => {
  it("warns when the text schedule disagrees with the published bitmap", () => {
    const r = buildFromRecords(
      input({
        fixedHours: [{ 醫事機構代碼: "clinic-0", 看診星期: "Y".repeat(21), 開業狀況: "0" }],
      }),
    );
    expect(r.warnings.join("\n")).toMatch(/clinic-0/);
  });

  it("stays silent when the two sources agree", () => {
    const r = buildFromRecords(
      input({
        fixedHours: [
          { 醫事機構代碼: "clinic-0", 看診星期: "N".repeat(21), 開業狀況: "0" },
          // D21006 also covers venues we never kept, and carries rows whose
          // bitmap is truncated — neither is a disagreement.
          { 醫事機構代碼: "not-in-our-data", 看診星期: "Y".repeat(21), 開業狀況: "0" },
          { 醫事機構代碼: "clinic-1", 看診星期: "YY", 開業狀況: "0" },
        ],
      }),
    );
    expect(r.warnings).toEqual([]);
  });
});

describe("buildFromRecords — district resolution", () => {
  /** A row whose district the address string alone cannot settle. */
  const at = (id: string, address: string, govAreaNo: string): NhiRecord =>
    clinic({ HOSP_ID: id, HOSP_NAME: id, ADDRESS: address, GOVAREANO: govAreaNo });

  it("files a venue under the district, not the longest reading of its address", () => {
    // 區運路 is a street in 板橋區, so the longest reading invents 板橋區區. The
    // ambiguous address stands alone here — no clean 板橋區 address keeps it
    // company — because resolution must not depend on what else is in the file.
    const r = buildFromRecords(
      input({
        clinics: [...rows(3, "clinic"), at("eaten", "新北市板橋區區運路２８號１樓、２樓", "65000")],
      }),
    );
    expect([...r.shards.keys()]).not.toContain("新北市/板橋區區.json");
    expect(r.shards.get("新北市/板橋區.json")!.map((v) => v.id)).toEqual(["eaten"]);
    expect(r.index.cities["新北市"]!["板橋區"]!.counts).toEqual({ clinic: 1, pharmacy: 0 });
  });

  it("keeps a district whose own second character is a suffix character", () => {
    // Every 平鎮區 address also reads as 平鎮, which is nothing. The district
    // must not be demoted to 其他 on that account.
    const r = buildFromRecords(
      input({ clinics: [...rows(3, "clinic"), at("pj-1", "桃園市平鎮區環南路１００號", "68000")] }),
    );
    expect(r.index.cities["桃園市"]!["平鎮區"]!.counts).toEqual({ clinic: 1, pharmacy: 0 });
    expect(r.index.cities["桃園市"]?.["平鎮"]).toBeUndefined();
    expect(r.index.cities["桃園市"]?.["其他"]).toBeUndefined();
  });

  it("picks the middle reading when three are possible", () => {
    // 前鎮區鎮榮街: longest reads 前鎮區鎮, shortest reads 前鎮, only 前鎮區 is real.
    const r = buildFromRecords(
      input({ clinics: [...rows(3, "clinic"), at("qj", "高雄市前鎮區鎮榮街４５號", "64000")] }),
    );
    expect(r.shards.get("高雄市/前鎮區.json")!.map((v) => v.id)).toEqual(["qj"]);
    expect([...r.shards.keys()]).not.toContain("高雄市/前鎮區鎮.json");
  });

  it("resolves per city, so one city's street name cannot rename another's district", () => {
    const r = buildFromRecords(
      input({
        clinics: [
          ...rows(3, "clinic"),
          at("tn", "臺南市新市區華興街１號", "10021"),
          at("kh", "高雄市新市區華興街１號", "64000"),
        ],
      }),
    );
    expect([...r.shards.keys()]).toContain("臺南市/新市區.json");
    expect(r.shards.get("高雄市/其他.json")!.map((v) => v.id)).toEqual(["kh"]);
  });

  it("aborts when too many venues have no district in the frozen table", () => {
    const gates = testGates({ maxUnknown: 1 });
    // 里 instead of 區: the shape a genuinely new district would also take.
    const stray = (n: number, kind: string): NhiRecord[] =>
      Array.from({ length: n }, (_, i) =>
        at(`${kind}-stray-${i}`, "新竹市關帝里南門街８６號", "10018"),
      );

    expect(() =>
      buildFromRecords(input({ gates, clinics: [...rows(3, "clinic"), ...stray(1, "c")] })),
    ).not.toThrow();
    expect(() =>
      buildFromRecords(input({ gates, clinics: [...rows(3, "clinic"), ...stray(2, "c")] })),
    ).toThrow(GateFailure);
    // Counted corpus-wide: a new district brings clinics and pharmacies alike,
    // so one of each must trip a ceiling of one.
    expect(() =>
      buildFromRecords(
        input({
          gates,
          clinics: [...rows(3, "clinic"), ...stray(1, "c")],
          pharmacies: [...rows(2, "pharmacy"), ...stray(1, "p")],
        }),
      ),
    ).toThrow(/regenerate the table/);
  });
});
