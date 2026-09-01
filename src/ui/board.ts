import { SLOTS, isOpen } from "../lib/hours";
import { SLOT_HOURS, describeSlot, type SlotPosition, type SlotResolution } from "../lib/slot";
import type { DayClass } from "../lib/calendar";
import type { Venue } from "../lib/types";

/**
 * The session the user actually cares about: the one they are in, or — when
 * they are in a lunch or night gap — the one coming next. `selectOpen` and
 * `renderBoard` are separate entry points and must resolve this identically,
 * or the list and the heading would name different sessions.
 */
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
  /**
   * Set when the office calendar could not be fetched, so no holiday check ran.
   * Distinct from "no calendar published for this year", which is legitimate and
   * warned about at build time — an unreachable calendar must be said out loud,
   * or an ordinary-looking day implies a check that never happened.
   */
  calendarUnavailable?: boolean;
  /** Set when these venues came from a previous session's cache, not the network. */
  cachedAt?: string;
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

  let title: string;
  let sub: string;
  if (at.kind === "in") {
    // Never claim 還開著 above an empty list. The h1 is what someone scanning on
    // a phone reads first, and it must not contradict the paragraph below it.
    title = open.length > 0 ? `${describeSlot(position)} 還開著` : describeSlot(position);
    sub = slotTimeLabel(position.slotIndex);
  } else {
    title = at.reason === "lunch" ? "現在是午休時間" : "現在多數院所已打烊";
    sub = `下一個時段：${describeSlot(position)}`;
  }
  root.append(heading(title, sub));

  // Ordered by how much they change the meaning of everything below.
  if (args.cachedAt) {
    root.append(
      notice(
        `目前無法取得最新資料，以下是 ${args.cachedAt} 存下的內容，院所時段可能已經改變。` +
          "出門前務必先打電話確認。",
      ),
    );
  }

  if (args.calendarUnavailable) {
    root.append(
      notice("無法取得辦公日曆，今天是否為假日或補班沒有檢查到；若適逢連假，看診時段可能與下方登記不同。"),
    );
  }

  if (day.holiday) {
    root.append(notice(`今天是${day.label}，院所看診時段可能與平日登記不同，建議先電話確認。`));
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

/** Shared so the heading line and the footer table can never disagree. */
const clock = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

function slotTimeLabel(slotIndex: number): string {
  const pair = SLOT_HOURS[slotIndex];
  if (!pair) return "";
  return `本站定義：${clock(pair[0])} – ${clock(pair[1])}`;
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
    const digits = v.tel.replace(/[^\d+]/g, "");
    // 29 of 29,691 source numbers strip to something other than the 9 or 10
    // digits a Taiwanese number has: missing or duplicated area codes, two
    // extensions, one full-width digit. A href built from those dials a
    // stranger, which is worse than no link in a product whose whole
    // instruction is "call first" — so those render as plain text and the user
    // dials the displayed number, which is the source of truth either way.
    if (digits.length === 9 || digits.length === 10) {
      const tel = document.createElement("a");
      tel.className = "mt-2 inline-block text-sm text-open underline";
      tel.href = `tel:${digits}`;
      tel.textContent = `打電話 ${v.tel}`;
      li.append(tel);
    } else {
      const tel = document.createElement("p");
      tel.className = "mt-2 text-sm text-ink";
      tel.textContent = `電話 ${v.tel}`;
      li.append(tel);
    }
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

  // The NHI publishes only 上午/下午/晚上 with no clock times, so this mapping is
  // ours and has to be legible in every state — including a gap, where the
  // heading names a session but shows no hours. Derived from SLOT_HOURS rather
  // than retyped, or it would drift from slot.ts.
  const sessions = document.createElement("p");
  sessions.textContent = `本站時段定義：${SLOT_HOURS.map(
    ([start, end], i) => `${SLOTS[i] ?? ""} ${clock(start)}–${clock(end)}`,
  ).join("、")}`;

  const caveat = document.createElement("p");
  caveat.textContent =
    "看診時段由院所每月申報，臨時休診無法反映；「晚上」不保證營業到幾點。" +
    "本站提供的是候選清單與電話，不是保證 —— 出門前請先打電話。";

  const attribution = document.createElement("p");
  attribution.textContent =
    "資料來源：衛生福利部中央健康保險署「健保特約醫事機構」開放資料、" +
    "行政院人事行政總處「政府行政機關辦公日曆表」。依政府資料開放授權條款第 1 版利用。";

  el.append(freshness, sessions, caveat, attribution);
  return el;
}
