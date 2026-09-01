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

  const [morningStart, morningEnd] = SLOT_HOURS[0]!;
  const [afternoonStart] = SLOT_HOURS[1]!;

  // Before the day's first session — the night gap belongs to today's morning.
  if (minutes < morningStart * 60) {
    return { kind: "gap", reason: "night", next: { dayIndex, slotIndex: 0 } };
  }

  // Between morning and afternoon.
  if (minutes >= morningEnd * 60 && minutes < afternoonStart * 60) {
    return { kind: "gap", reason: "lunch", next: { dayIndex, slotIndex: 1 } };
  }

  // After the last session — roll over to tomorrow morning, wrapping Sunday.
  const tomorrow = (dayIndex + 1) % DAYS.length;
  return { kind: "gap", reason: "night", next: { dayIndex: tomorrow, slotIndex: 0 } };
}

export function describeSlot(p: SlotPosition): string {
  return `${DAYS[p.dayIndex] ?? ""}${SLOTS[p.slotIndex] ?? ""}`;
}
