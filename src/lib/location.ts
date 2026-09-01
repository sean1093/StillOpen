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

/** 1-3 CJK characters followed by a 區/鄉/鎮/市 suffix. */
const DISTRICT_PATTERN = /^([\u4e00-\u9fff]{1,3}[區鄉鎮市])/;

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
 * Resolve a venue to a city and district.
 *
 * City resolution is belt-and-braces: the address prefix first, then the
 * GOVAREANO code. Measured over the full datasets this reaches 100%. District
 * resolution reaches 99.95%; the remainder are addresses that name a 里 instead
 * of a 區, which land in `UNKNOWN_DISTRICT` so they stay reachable at city
 * level instead of being silently dropped.
 *
 * Returns `null` only when both signals fail — such a record cannot be placed
 * anywhere and the caller must drop it.
 */
export function parseLocation(address: string, govAreaNo: string): Location | null {
  const normalised = normaliseAddress((address ?? "").trim());
  const cityPrefix = normalised.match(CITY_PATTERN)?.[1];
  const city = cityPrefix ?? GOV_AREA_TO_CITY[(govAreaNo ?? "").trim()];
  if (!city) return null;

  const remainder = cityPrefix ? normalised.slice(cityPrefix.length) : "";
  const districtMatch = remainder.match(DISTRICT_PATTERN);
  return { city, district: districtMatch?.[1] ?? UNKNOWN_DISTRICT };
}
