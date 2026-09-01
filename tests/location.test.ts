import { describe, it, expect } from "vitest";
import {
  parseLocation,
  normaliseAddress,
  GOV_AREA_TO_CITY,
  UNKNOWN_DISTRICT,
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
