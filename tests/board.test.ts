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

  it("links 9-digit numbers too, not just 10-digit ones", () => {
    renderBoard(root, {
      venues: [venue("a", { tel: "(049)2691404" })],
      at: sundayEvening,
      day,
      sourceDate: "2026-09-01",
    });
    const link = root.querySelector<HTMLAnchorElement>('a[href^="tel:"]');
    expect(link?.getAttribute("href")).toBe("tel:0492691404");
  });

  it("renders an unlinkable number as text rather than dialling a wrong one", () => {
    renderBoard(root, {
      venues: [venue("a", { tel: "(07)6250942#23" })],
      at: sundayEvening,
      day,
      sourceDate: "2026-09-01",
    });
    expect(root.textContent).toContain("(07)6250942#23");
    expect(root.querySelector('a[href^="tel:"]')).toBeNull();
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
    // The h1 is read first on a phone, so it must not claim 還開著 over an empty
    // list. It still names the session, and the time table still disambiguates 晚上.
    expect(root.querySelector("h1")?.textContent).toBe("星期日晚上");
    expect(root.textContent).toContain("18:00");
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
