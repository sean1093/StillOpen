import { describe, it, expect } from "vitest";
import {
  parseLocation,
  normaliseAddress,
  districtCandidates,
  parseCityCandidates,
  recordDistrictReading,
  resolveDistrict,
  GOV_AREA_TO_CITY,
  UNKNOWN_DISTRICT,
  type DistrictCensus,
} from "../src/lib/location";

describe("normaliseAddress", () => {
  it("canonicalises 台 to 臺", () => {
    expect(normaliseAddress("台北市大安區")).toBe("臺北市大安區");
    expect(normaliseAddress("台中市西屯區")).toBe("臺中市西屯區");
  });

  it("upgrades the pre-2014 桃園縣 to 桃園市", () => {
    expect(normaliseAddress("桃園縣中壢市龍東路38號")).toBe("桃園市中壢區龍東路38號");
    expect(normaliseAddress("桃園縣八德市建國路１１８０號")).toBe("桃園市八德區建國路１１８０號");
    expect(normaliseAddress("桃園縣桃園市春日路２８５號")).toBe("桃園市桃園區春日路２８５號");
  });

  it("leaves an already-correct address untouched", () => {
    expect(normaliseAddress("新北市新莊區大觀街４６－２號")).toBe("新北市新莊區大觀街４６－２號");
  });

  it("does not rewrite 桃園市 districts when the county form is absent", () => {
    expect(normaliseAddress("桃園市中壢區中美路13.15.17號")).toBe("桃園市中壢區中美路13.15.17號");
  });
});

describe("GOV_AREA_TO_CITY", () => {
  it("covers all 22 codes the NHI datasets actually use", () => {
    expect(Object.keys(GOV_AREA_TO_CITY)).toHaveLength(22);
  });

  it("maps the ambiguous 臺南市 code to the canonical spelling", () => {
    expect(GOV_AREA_TO_CITY["10021"]).toBe("臺南市");
  });
});

describe("parseLocation — ordinary addresses", () => {
  const cases: [string, string, string, string][] = [
    ["臺北市大安區辛亥路３段１５號", "63000", "臺北市", "大安區"],
    ["新北市鶯歌區鶯桃路２段６２號及６４號１至４樓", "65000", "新北市", "鶯歌區"],
    ["高雄市苓雅區凱旋二路１３２號", "64000", "高雄市", "苓雅區"],
    ["苗栗縣三義鄉廣盛村１６鄰八股路２４之９號", "10005", "苗栗縣", "三義鄉"],
    ["彰化縣田中鎮中路里中南路三段５１２號", "10007", "彰化縣", "田中鎮"],
    ["新竹縣竹北市光明六路１號", "10004", "新竹縣", "竹北市"],
    ["臺南市北區正覺里公園路６６１號", "10021", "臺南市", "北區"],
  ];

  for (const [addr, gov, city, district] of cases) {
    it(`resolves ${addr}`, () => {
      expect(parseLocation(addr, gov)).toEqual({ city, district });
    });
  }
});

describe("parseLocation — the real-world misses", () => {
  it("falls back to GOVAREANO when the city prefix is a retired name", () => {
    // 桃園縣 was upgraded in 2014; three records still carry the old form.
    expect(parseLocation("桃園縣八德市建國路１１８０號、１１８２號、１１８０－１號", "68000")).toEqual({
      city: "桃園市",
      district: "八德區",
    });
  });

  it("buckets 新竹市 addresses that skip the district and give a 里 instead", () => {
    // 18 live records look like this. 里 → 區 cannot be inferred without a
    // village table, so they land in a visible bucket rather than vanish.
    expect(parseLocation("新竹市關帝里南門街８６號", "10018")).toEqual({
      city: "新竹市",
      district: UNKNOWN_DISTRICT,
    });
    expect(parseLocation("新竹市延平路３段６８５號", "10018")).toEqual({
      city: "新竹市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("buckets the 臺中市 address that skips the district", () => {
    expect(parseLocation("臺中市上石里河南路二段４１１．４１３號１Ｆ", "66000")).toEqual({
      city: "臺中市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("recovers the city from GOVAREANO when the address is blank", () => {
    expect(parseLocation("", "63000")).toEqual({
      city: "臺北市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("returns null only when neither address nor GOVAREANO is usable", () => {
    expect(parseLocation("", "")).toBeNull();
    expect(parseLocation("地址不詳", "99999")).toBeNull();
  });
});

describe("districtCandidates", () => {
  it("offers every district-shaped prefix, longest first", () => {
    expect(districtCandidates("板橋區區運路２８號")).toEqual(["板橋區區", "板橋區"]);
    expect(districtCandidates("前鎮區鎮榮街４５號")).toEqual(["前鎮區鎮", "前鎮區", "前鎮"]);
  });

  it("offers a single candidate when only one reading is possible", () => {
    expect(districtCandidates("大安區辛亥路３段１５號")).toEqual(["大安區"]);
    expect(districtCandidates("三義鄉廣盛村１６鄰八股路２４之９號")).toEqual(["三義鄉"]);
  });

  it("offers nothing when no prefix is district-shaped", () => {
    expect(districtCandidates("關帝里南門街８６號")).toEqual([]);
    expect(districtCandidates("")).toEqual([]);
    // Full-width digits and Latin letters are outside the CJK range, so they
    // stop the scan rather than being read as part of a district name.
    expect(districtCandidates("１２３區")).toEqual([]);
  });

  it("never reads past the longest district name in Taiwan", () => {
    expect(districtCandidates("太麻里鄉大王村１號")).toEqual(["太麻里鄉"]);
    expect(districtCandidates("一二三四區路１號")).toEqual([]);
  });
});

describe("resolveDistrict", () => {
  /** Build a census the way the build's first pass does. */
  const censusOf = (addresses: [string, string][]): DistrictCensus => {
    const census: DistrictCensus = new Map();
    for (const [address, govAreaNo] of addresses) {
      const where = parseCityCandidates(address, govAreaNo);
      if (where) recordDistrictReading(census, where);
    }
    return census;
  };

  const resolve = (census: DistrictCensus, address: string, govAreaNo: string): string =>
    resolveDistrict(census, parseCityCandidates(address, govAreaNo)!);

  it("prefers the shorter reading when the corpus knows it as a district", () => {
    const census = censusOf([
      ["新北市板橋區文化路一段１號", "65000"],
      ["新北市板橋區中山路二段２號", "65000"],
      ["新北市板橋區區運路２８號１樓、２樓", "65000"],
    ]);
    expect(resolve(census, "新北市板橋區區運路２８號１樓、２樓", "65000")).toBe("板橋區");
  });

  it("keeps the longer reading when the shorter one is not a district", () => {
    // 平鎮/前鎮/左鎮/新市 are not districts, so the corpus never votes for them
    // however many addresses it sees.
    const census = censusOf([
      ["桃園市平鎮區環南路１００號", "68000"],
      ["高雄市前鎮區一心二路５０號", "64000"],
      ["臺南市左鎮區中正路１號", "10021"],
      ["臺南市新市區華興街１號", "10021"],
    ]);
    expect(resolve(census, "桃園市平鎮區環南路１００號", "68000")).toBe("平鎮區");
    expect(resolve(census, "高雄市前鎮區一心二路５０號", "64000")).toBe("前鎮區");
    expect(resolve(census, "臺南市左鎮區中正路１號", "10021")).toBe("左鎮區");
    expect(resolve(census, "臺南市新市區華興街１號", "10021")).toBe("新市區");
  });

  it("resolves the whole table of addresses the pattern alone cannot", () => {
    // Corpus-shaped: each real district is attested by more clean addresses
    // than the one street name that misleads a single-address read.
    const census = censusOf([
      ["新北市板橋區文化路一段１號", "65000"],
      ["新北市板橋區中山路二段２號", "65000"],
      ["臺北市信義區松高路１號", "63000"],
      ["臺北市信義區松仁路２號", "63000"],
      ["金門縣金湖鎮復興路１號", "09020"],
      ["金門縣金湖鎮太湖路２號", "09020"],
      ["桃園市平鎮區環南路１００號", "68000"],
      ["高雄市前鎮區一心二路５０號", "64000"],
      ["臺南市左鎮區中正路１號", "10021"],
      ["臺南市新市區華興街１號", "10021"],
      ["新北市板橋區區公所前街１號", "65000"],
      ["臺北市信義區市民大道五段８號", "63000"],
      ["金門縣金湖鎮市港路１號", "09020"],
    ]);
    const cases: [string, string, string][] = [
      ["新北市板橋區區公所前街１號", "65000", "板橋區"],
      ["臺北市信義區市民大道五段８號", "63000", "信義區"],
      ["金門縣金湖鎮市港路１號", "09020", "金湖鎮"],
      ["桃園市平鎮區環南路１００號", "68000", "平鎮區"],
      ["高雄市前鎮區一心二路５０號", "64000", "前鎮區"],
      ["臺南市左鎮區中正路１號", "10021", "左鎮區"],
      ["臺南市新市區華興街１號", "10021", "新市區"],
    ];
    for (const [address, govAreaNo, district] of cases) {
      expect(resolve(census, address, govAreaNo)).toBe(district);
    }
  });

  it("keeps the longest reading when two readings are equally attested", () => {
    // A tie is a genuine "cannot tell", and the longest reading is what a
    // single address already justifies. Measured over the 2026-09-01 corpus no
    // tie occurs: the tightest real contest is 3 votes to 0.
    const census = censusOf([
      ["新北市板橋區文化路一段１號", "65000"],
      ["新北市板橋區區公所前街１號", "65000"],
    ]);
    expect(resolve(census, "新北市板橋區區公所前街１號", "65000")).toBe("板橋區區");
  });

  it("buckets the address when the corpus knows none of its candidates", () => {
    const census = censusOf([["臺北市大安區辛亥路３段１５號", "63000"]]);
    // 前鎮鄉 does not exist and neither does 前鎮 — inventing either as a
    // district bucket would be worse than a visible 其他.
    expect(resolve(census, "高雄市前鎮鄉一心二路５０號", "64000")).toBe(UNKNOWN_DISTRICT);
    expect(resolve(census, "臺北市關帝里南門街８６號", "63000")).toBe(UNKNOWN_DISTRICT);
  });

  it("counts votes per city, so districts cannot leak between cities", () => {
    const census = censusOf([
      ["臺南市新市區華興街１號", "10021"],
      ["臺南市新市區中山路２號", "10021"],
    ]);
    // 新市區 is well attested in 臺南市 and unknown in 高雄市.
    expect(resolve(census, "臺南市新市區華興街１號", "10021")).toBe("新市區");
    expect(resolve(census, "高雄市新市區華興街１號", "64000")).toBe(UNKNOWN_DISTRICT);
  });
});

describe("parseCityCandidates", () => {
  it("reports the city with every district reading of the remainder", () => {
    expect(parseCityCandidates("新北市板橋區區運路２８號", "65000")).toEqual({
      city: "新北市",
      candidates: ["板橋區區", "板橋區"],
    });
  });

  it("normalises the address before reading the district", () => {
    expect(parseCityCandidates("桃園縣中壢市龍東路38號", "68000")).toEqual({
      city: "桃園市",
      candidates: ["中壢區"],
    });
  });

  it("has no candidates when the city came from GOVAREANO alone", () => {
    expect(parseCityCandidates("", "63000")).toEqual({ city: "臺北市", candidates: [] });
  });

  it("returns null when neither signal yields a city", () => {
    expect(parseCityCandidates("地址不詳", "99999")).toBeNull();
  });
});
