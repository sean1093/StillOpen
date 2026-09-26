/**
 * The data workflow runs once a day, so a build older than this means at least
 * one scheduled refresh did not land (24h cadence plus slack for a late runner).
 */
export const STALE_AFTER_HOURS = 36;

/**
 * Past this age the site warns above the list and the data workflow goes red.
 * Shared by both so "the page is shouting" and "someone got paged" can never
 * disagree about what counts as too old.
 */
export const ALERT_AFTER_DAYS = 7;

/** Hours between the build instant and `now`; NaN when `generatedAt` is unparsable. */
export function dataAgeHours(generatedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(generatedAt)) / 3_600_000;
}
