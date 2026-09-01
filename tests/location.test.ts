import { describe, it, expect } from "vitest";
import { DISTRICTS } from "../src/lib/districts";
import {
  parseLocation,
  normaliseAddress,
  districtCandidates,
  GOV_AREA_TO_CITY,
  UNKNOWN_DISTRICT,
  type LocationTally,
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

describe("parseLocation — districts the pattern alone cannot read", () => {
  const cases: [string, string, string, string][] = [
    // The seven from the defect report: a street name that starts with a
    // suffix character, on both sides of the ambiguity.
    ["新北市板橋區區公所前街１號", "65000", "新北市", "板橋區"],
    ["臺北市信義區市民大道五段８號", "63000", "臺北市", "信義區"],
    ["金門縣金湖鎮市港路１號", "09020", "金門縣", "金湖鎮"],
    ["桃園市平鎮區環南路１００號", "68000", "桃園市", "平鎮區"],
    ["高雄市前鎮區一心二路５０號", "64000", "高雄市", "前鎮區"],
    ["臺南市左鎮區中正路１號", "10021", "臺南市", "左鎮區"],
    ["臺南市新市區華興街１號", "10021", "臺南市", "新市區"],
    // Three readings: 前鎮區鎮 is too long, 前鎮 too short, and only the middle
    // one is a district — so neither end of the candidate list is safe to take.
    ["高雄市前鎮區鎮榮街４５號", "64000", "高雄市", "前鎮區"],
    // Two characters of the street name look like a district suffix.
    ["新竹市東區光鎮里南大路５４９號１樓", "10018", "新竹市", "東區"],
  ];

  for (const [address, govAreaNo, city, district] of cases) {
    it(`reads ${address} as ${district}`, () => {
      expect(parseLocation(address, govAreaNo)).toEqual({ city, district });
    });
  }

  it("resolves a district attested by a single ambiguous address", () => {
    // THE case the discarded corpus vote got wrong. When a city's only 板橋區
    // address is one whose longest reading is the phantom 板橋區區, a vote casts
    // that address's single ballot for the phantom, real 板橋區 finishes with
    // zero, and the venue is filed under a district that does not exist.
    //
    // A table lookup cannot be talked into that, and this one call is the whole
    // proof: resolution reads one address and one frozen table, so there is no
    // corpus to be rare in.
    expect(parseLocation("新北市板橋區區運路２８號１樓、２樓", "65000")).toEqual({
      city: "新北市",
      district: "板橋區",
    });
  });

  it("does not let one city's street name name another city's district", () => {
    expect(parseLocation("臺南市新市區華興街１號", "10021")).toEqual({
      city: "臺南市",
      district: "新市區",
    });
    // 新市區 is 臺南市's, and 高雄市 has no district of that name — so the same
    // string must not resolve there.
    expect(parseLocation("高雄市新市區華興街１號", "64000")).toEqual({
      city: "高雄市",
      district: UNKNOWN_DISTRICT,
    });
  });

  it("buckets an address whose readings are all unknown", () => {
    // 前鎮鄉 does not exist and neither does 前鎮; inventing either as a
    // district for one venue is worse than a visible 其他.
    expect(parseLocation("高雄市前鎮鄉一心二路５０號", "64000")).toEqual({
      city: "高雄市",
      district: UNKNOWN_DISTRICT,
    });
    // An upstream typo: 湖口市 does not exist, and the real 湖口鄉 follows it in
    // the same string. Reading past the typo is deliberately not attempted.
    expect(parseLocation("新竹縣湖口市湖口鄉中正路一段１８５號", "10004")).toEqual({
      city: "新竹縣",
      district: UNKNOWN_DISTRICT,
    });
  });
});

describe("parseLocation — the optional tally", () => {
  const tally = (): LocationTally => ({ fellThrough: 0 });

  it("counts an answer reached only after a longer reading was rejected", () => {
    const t = tally();
    // 板橋區區 is rejected, 板橋區 answers.
    expect(parseLocation("新北市板橋區區運路２８號１樓、２樓", "65000", t)).toEqual({
      city: "新北市",
      district: "板橋區",
    });
    expect(t.fellThrough).toBe(1);
  });

  it("stays at zero when the address's own longest reading is the answer", () => {
    const t = tally();
    parseLocation("臺北市大安區辛亥路３段１５號", "63000", t);
    // 平鎮區 is the longest reading of its address even though 平鎮 follows it.
    parseLocation("桃園市平鎮區環南路１００號", "68000", t);
    // No candidate matched at all: 其他 is counted by the build's own ceiling,
    // and charging it here too would double-count the same venue.
    parseLocation("高雄市新市區華興街１號", "64000", t);
    // No city prefix, so there is no remainder and no reading to reject.
    parseLocation("", "63000", t);
    expect(t.fellThrough).toBe(0);
  });

  it("resolves identically whether or not a tally is passed", () => {
    for (const [address, govAreaNo] of [
      ["新北市板橋區區運路２８號１樓、２樓", "65000"],
      ["高雄市前鎮區鎮榮街４５號", "64000"],
      ["新竹市關帝里南門街８６號", "10018"],
      ["地址不詳", "99999"],
    ] as const) {
      expect(parseLocation(address, govAreaNo, tally())).toEqual(
        parseLocation(address, govAreaNo),
      );
    }
  });
});

describe("DISTRICTS", () => {
  const names = Object.entries(DISTRICTS).flatMap(([city, ds]) =>
    Object.keys(ds).map((d) => `${city}/${d}`),
  );

  it("holds the 366 districts the verified build attested, across 22 cities", () => {
    expect(Object.keys(DISTRICTS)).toHaveLength(22);
    expect(names).toHaveLength(366);
  });

  it("lists only names district resolution can actually match", () => {
    // A table entry the candidate reader can never produce is dead weight and
    // probably a corrupted line. Note the obvious check — "no name ends in two
    // suffix characters, since that is what the greedy read produced" — is not
    // available: 平鎮區, 左鎮區, 新市區 and 前鎮區 all really do, which is the
    // entire defect. Only the frozen table separates them from 板橋區區.
    const unreachable = Object.values(DISTRICTS)
      .flatMap((ds) => Object.keys(ds))
      .filter((d) => !districtCandidates(d).includes(d));
    expect(unreachable).toEqual([]);
  });

  it("excludes the phantom the discarded vote shipped", () => {
    // 湖口市 does not exist; it came from one typo'd address, and a phantom in
    // the table would be permanent in a way a phantom in one build was not.
    expect(DISTRICTS["新竹縣"]?.["湖口市"]).toBeUndefined();
    expect(DISTRICTS["新竹縣"]?.["湖口鄉"]).toBe(true);
  });

  it("has no bucket named 其他, which is a fallback and not a district", () => {
    expect(names.filter((n) => n.endsWith(`/${UNKNOWN_DISTRICT}`))).toEqual([]);
  });
});
