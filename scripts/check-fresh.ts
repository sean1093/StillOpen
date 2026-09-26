import { readFile } from "node:fs/promises";
import { ALERT_AFTER_DAYS, dataAgeHours } from "../src/lib/freshness";
import type { DataIndex } from "../src/lib/types";

/**
 * Run by the data workflow only when the NHI source was unreachable. Keeping
 * yesterday's data is the designed outcome for a short outage, so that is a
 * warning; once the committed data is older than ALERT_AFTER_DAYS it is an
 * error, because by then the site itself is telling users the data is suspect.
 */
const index = JSON.parse(await readFile("data/index.json", "utf8")) as DataIndex;
const hours = dataAgeHours(index.generatedAt, new Date());
const days = (hours / 24).toFixed(1);

// Written as "not younger than" so an unparsable timestamp (NaN) fails loudly.
if (!(hours < ALERT_AFTER_DAYS * 24)) {
  console.log(
    `::error::NHI open data unreachable and data/ is ${days} days old ` +
      `(built ${index.generatedAt}); limit is ${ALERT_AFTER_DAYS} days.`,
  );
  process.exit(1);
}
console.log(
  `::warning::NHI open data unreachable; keeping data/ built ${index.generatedAt} (${days} days old).`,
);
