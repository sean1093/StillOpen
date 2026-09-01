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
