const BASE = "https://info.nhi.gov.tw/api/iode0010/v1/rest";

export type NhiRecord = Record<string, string>;

export const RESOURCES = {
  clinics: "A21030000I-D21004-009",
  pharmacies: "A21030000I-D21005-001",
  fixedHours: "A21030000I-D21006-001",
} as const;

/** Datasets whose `modified` timestamp we treat as the data date. */
export const DATASETS = {
  clinics: "A21030000I-D21004",
} as const;

const PAGE = 1000;

const ATTEMPTS = 4;
const TIMEOUT_MS = 60_000;

/**
 * `fetch` with a per-attempt timeout and retries on network errors, timeouts and
 * 5xx/429. A full rebuild fires dozens of concurrent requests at two government
 * hosts, and a single dropped connection used to abort the whole daily run with
 * a bare "fetch failed". 4xx other than 429 are returned as-is: retrying a bad
 * request cannot help, and callers already turn !ok into a descriptive error.
 */
export async function fetchWithRetry(
  url: string,
  { attempts = ATTEMPTS, baseDelayMs = 2000 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (i - 1)));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status < 500 && res.status !== 429) return res;
      lastError = new Error(`HTTP ${res.status}`);
      await res.body?.cancel();
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`${url} -> ${describe(lastError)} (after ${attempts} attempts)`, {
    cause: lastError,
  });
}

/** undici reports every network failure as "fetch failed"; the real reason is in `cause`. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return `${err.message}${cause}`;
}

interface DatastoreResponse {
  success: boolean;
  result: { total: number; records: NhiRecord[] };
}

/**
 * Pull every row of a CKAN datastore resource.
 *
 * The API caps `limit` at 1000 regardless of what is asked for, so the total is
 * read from the first page and the remaining pages are fetched concurrently.
 */
export async function fetchAll(resourceId: string): Promise<NhiRecord[]> {
  const first = await getPage(resourceId, 0);
  const total = first.result.total;
  const records = [...first.result.records];

  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);

  const rest = await Promise.all(offsets.map((o) => getPage(resourceId, o)));
  for (const page of rest) records.push(...page.result.records);

  if (records.length !== total) {
    throw new Error(`${resourceId}: expected ${total} rows, received ${records.length}`);
  }
  return records;
}

async function getPage(resourceId: string, offset: number): Promise<DatastoreResponse> {
  const url = `${BASE}/datastore/${resourceId}?limit=${PAGE}&offset=${offset}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = (await res.json()) as DatastoreResponse;
  if (!body.success) throw new Error(`${url} -> success=false`);
  return body;
}

/** The dataset's own `modified` timestamp, as YYYY-MM-DD. */
export async function fetchDatasetModified(identifier: string): Promise<string> {
  const url = `${BASE}/dataset/${identifier}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = (await res.json()) as { modified?: string };
  const modified = body.modified;
  if (!modified) throw new Error(`${url} -> no modified field`);
  return modified.slice(0, 10).replace(/\//g, "-");
}

/**
 * Resolve this year's 辦公日曆表 CSV from the data.gov.tw dataset page.
 * The filename changes yearly and mid-year, so it must never be hardcoded.
 * Returns the decoded CSV text, or null when this year's file is not published.
 */
export async function fetchOfficeCalendar(year: number): Promise<string | null> {
  const rocYear = year - 1911;
  const page = await fetchText("https://data.gov.tw/dataset/14718");
  const links = [
    ...new Set(
      [...page.matchAll(/https?:\/\/[^"'\s<>\\]+?\.csv[^"'\s<>\\]*/gi)].map((m) =>
        m[0].replace(/&amp;/g, "&"),
      ),
    ),
  ];

  const candidates = links
    .map((url) => ({ url, name: safeDecode(url) }))
    .filter(({ name }) => name.includes(`${rocYear}年`) && !name.includes("Google"));

  if (candidates.length === 0) return null;

  // Prefer the most recently published revision — later files sort last by the
  // yyyymm directory segment embedded in the URL. Verified against ROC 114,
  // where a corrected calendar in files/202510 correctly outranks the original
  // in files/202407.
  candidates.sort((a, b) => a.url.localeCompare(b.url));
  const chosen = candidates[candidates.length - 1]!;

  const res = await fetchWithRetry(chosen.url);
  if (!res.ok) throw new Error(`${chosen.url} -> HTTP ${res.status}`);
  return new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
