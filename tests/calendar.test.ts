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

  it("only treats 六 and 日 as the weekend, whatever the 星期 column says", () => {
    // A garbage 星期 value must read as an ordinary working day, not as 補班.
    for (const weekday of ["__proto__", "constructor", "toString", "Sat", ""]) {
      expect(classifyDay({ date: "20260301", weekday, isDayOff: false, note: "" })).toEqual({
        holiday: false,
        makeUpWorkday: false,
        label: "",
      });
    }
  });
});

describe("toKey", () => {
  it("zero-pads month and day", () => {
    expect(toKey(new Date(2026, 8, 1))).toBe("20260901");
    expect(toKey(new Date(2026, 0, 5))).toBe("20260105");
  });
});
