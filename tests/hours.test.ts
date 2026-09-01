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
