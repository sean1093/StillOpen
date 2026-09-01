export interface Location {
  city: string;
  district: string;
}

/** Shown to the user, so it must read as a real bucket rather than an error. */
export const UNKNOWN_DISTRICT = "其他";

/**
 * 戶役政 city codes, derived by majority vote over all 34,864 NHI records on
 * 2026-09-01. Exactly 22 codes appear. Code 10021 is the only ambiguous one —
 * the source spells it both 臺南市 and 台南市 — resolved to the official form.
 */
export const GOV_AREA_TO_CITY: Readonly<Record<string, string>> = Object.freeze({
  "09007": "連江縣",
  "09020": "金門縣",
  "10002": "宜蘭縣",
  "10004": "新竹縣",
  "10005": "苗栗縣",
  "10007": "彰化縣",
  "10008": "南投縣",
  "10009": "雲林縣",
  "10010": "嘉義縣",
  "10013": "屏東縣",
  "10014": "臺東縣",
  "10015": "花蓮縣",
  "10016": "澎湖縣",
  "10017": "基隆市",
  "10018": "新竹市",
  "10020": "嘉義市",
  "10021": "臺南市",
  "63000": "臺北市",
  "64000": "高雄市",
  "65000": "新北市",
  "66000": "臺中市",
  "68000": "桃園市",
});

const CITY_PATTERN = new RegExp(
  "^(" +
    [
      "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
      "基隆市", "新竹市", "嘉義市",
      "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣",
      "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
    ].join("|") +
    ")",
);

/**
 * A district name is 1-3 CJK characters plus a 區/鄉/鎮/市 suffix — but so is the
 * head of plenty of street names, and the two overlap in both directions:
 *
 *   板橋區區運路 — 板橋區 is the district, 區運路 the street
 *   信義區市民大道 — 信義區 + 市民大道
 *   平鎮區環南路 — 平鎮區 is the district; 平鎮 is nothing
 *   前鎮區鎮榮街 — 前鎮區 + 鎮榮街, so neither the longest nor the shortest
 *                  reading is right
 *
 * No pattern can separate those, because the distinguishing fact — 板橋區 is a
 * district and 平鎮 is not — is about Taiwan, not about the string. So the
 * reading is not decided here: every district-shaped prefix is offered as a
 * candidate and the corpus picks between them (`resolveDistrict`).
 */
const DISTRICT_SUFFIXES = "區鄉鎮市";

/** 3 characters plus the suffix — 太麻里鄉 is as long as district names get. */
const MAX_DISTRICT_LENGTH = 4;

const isCjk = (code: number): boolean => code >= 0x4e00 && code <= 0x9fff;

/** 桃園縣 was upgraded to 桃園市 in 2014; its 市 became 區. */
const TAOYUAN_UPGRADED = ["八德", "桃園", "中壢", "平鎮", "楊梅", "蘆竹", "大溪"];

/**
 * Canonicalise a raw NHI address: 台 → 臺, and rewrite retired 桃園縣 forms.
 * Full-width digits are deliberately left alone — they are display text here,
 * and only matter once geocoding arrives (spec §6).
 */
export function normaliseAddress(address: string): string {
  let out = address.replace(/台/g, "臺");
  if (out.startsWith("桃園縣")) {
    out = "桃園市" + out.slice("桃園縣".length);
    for (const name of TAOYUAN_UPGRADED) {
      if (out.startsWith(`桃園市${name}市`)) {
        out = `桃園市${name}區` + out.slice(`桃園市${name}市`.length);
        break;
      }
    }
  }
  return out;
}

/**
 * Every district-shaped prefix of an address remainder, longest first.
 *
 * The first entry is the reading a single address can justify on its own; the
 * rest are the shorter readings the corpus may prefer. Empty when nothing
 * district-shaped starts the remainder — an address that names a 里 instead of
 * a 區, most often.
 */
export function districtCandidates(remainder: string): string[] {
  let cjk = 0;
  while (
    cjk < MAX_DISTRICT_LENGTH &&
    cjk < remainder.length &&
    isCjk(remainder.charCodeAt(cjk))
  ) {
    cjk++;
  }

  const candidates: string[] = [];
  for (let length = cjk; length >= 2; length--) {
    if (DISTRICT_SUFFIXES.includes(remainder[length - 1]!)) {
      candidates.push(remainder.slice(0, length));
    }
  }
  return candidates;
}

export interface CityCandidates {
  city: string;
  /** Every district reading of the address, longest first. May be empty. */
  candidates: string[];
}

/**
 * Resolve the city and enumerate the district readings, without committing to
 * one. The build collects these over every record, then resolves each against
 * the census the whole corpus produced.
 *
 * City resolution is belt-and-braces: the address prefix first, then the
 * GOVAREANO code. Measured over the full datasets this reaches 100%. Returns
 * `null` only when both signals fail — such a record cannot be placed anywhere
 * and the caller must drop it.
 */
export function parseCityCandidates(address: string, govAreaNo: string): CityCandidates | null {
  const normalised = normaliseAddress((address ?? "").trim());
  const cityPrefix = normalised.match(CITY_PATTERN)?.[1];
  const city = cityPrefix ?? GOV_AREA_TO_CITY[(govAreaNo ?? "").trim()];
  if (!city) return null;

  const remainder = cityPrefix ? normalised.slice(cityPrefix.length) : "";
  return { city, candidates: districtCandidates(remainder) };
}

/**
 * city → district name → how many addresses read longest as that name.
 *
 * This is the whole district whitelist, and it is derived from the corpus being
 * built rather than from a table that can rot. A real district is the longest
 * reading of nearly every address in it, so it accumulates hundreds of votes; a
 * name only a street name can produce (板橋區區, 東區光鎮) accumulates a handful.
 * Kept per city, so 新市區 being a 臺南市 district says nothing about 高雄市.
 */
export type DistrictCensus = Map<string, Map<string, number>>;

/**
 * Cast one address's vote. Must be the only writer, so the tally and
 * `resolveDistrict` agree on which reading is being counted.
 */
export function recordDistrictReading(census: DistrictCensus, where: CityCandidates): void {
  const longest = where.candidates[0];
  if (longest === undefined) return;

  const counts = census.get(where.city);
  if (counts) counts.set(longest, (counts.get(longest) ?? 0) + 1);
  else census.set(where.city, new Map([[longest, 1]]));
}

/**
 * Pick the reading the corpus attests most often.
 *
 * Candidates arrive longest first and the comparison is strict, so an
 * unattested address keeps its longest reading only when nothing shorter is
 * attested either — and if no reading is attested at all, it lands in
 * `UNKNOWN_DISTRICT` rather than inventing a district bucket for one venue.
 * Measured 2026-09-01: 523 of 29,698 addresses are ambiguous, and the smallest
 * winning margin is 3 votes to 0 (左鎮區 over 左鎮).
 */
export function resolveDistrict(census: DistrictCensus, where: CityCandidates): string {
  const counts = census.get(where.city);
  let best = UNKNOWN_DISTRICT;
  let bestVotes = 0;

  for (const candidate of where.candidates) {
    const votes = counts?.get(candidate) ?? 0;
    if (votes > bestVotes) {
      best = candidate;
      bestVotes = votes;
    }
  }
  return best;
}

/**
 * Resolve a venue to a city and district from the address alone.
 *
 * Without a corpus the longest reading is the best a single address can do, so
 * this cannot separate 板橋區區運路 from 平鎮區環南路 — the build goes through
 * `parseCityCandidates` and `resolveDistrict` for that. District resolution
 * reaches 99.96%; the remainder are addresses that name a 里 instead of a 區,
 * which land in `UNKNOWN_DISTRICT` so they stay reachable at city level instead
 * of being silently dropped.
 */
export function parseLocation(address: string, govAreaNo: string): Location | null {
  const where = parseCityCandidates(address, govAreaNo);
  if (!where) return null;
  return { city: where.city, district: where.candidates[0] ?? UNKNOWN_DISTRICT };
}
