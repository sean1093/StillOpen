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
