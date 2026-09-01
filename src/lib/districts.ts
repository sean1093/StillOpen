/**
 * Every district (區/鄉/鎮/縣轄市) each city really has — the table district
 * resolution looks up. Frozen deliberately: which districts exist is a fact
 * about Taiwan, not about today's data, and inferring it from the corpus on
 * every build made a rare district's fate depend on which addresses happened to
 * land in the file that morning.
 *
 * Extracted from the verified build of 2026-09-01 — 369 shards, 29,698 venues,
 * 22 cities — and checked entry by entry against Taiwan's 368 township-level
 * divisions. 366 entries; every one is attested by a contracted venue.
 *
 * Three names in that build's index are deliberately not here:
 *
 *   新竹縣湖口市 — does not exist. Its single venue is an upstream typo for
 *     湖口鄉, and the address says so itself: 新竹縣湖口市湖口鄉中正路一段１８５號.
 *     The discarded corpus vote had ranked it a district on that one address
 *     alone. It now resolves to UNKNOWN_DISTRICT, which is conservative rather
 *     than helpless — the correct reading is sitting right there in the string,
 *     and is left unread on purpose: a second pattern to rescue typo'd
 *     addresses is the kind of heuristic this table replaced.
 *
 *   金門縣烏坵鄉 and 連江縣南竿鄉 — real divisions, absent because neither is
 *     named by a single D21004 or D21005 row, expired ones included (probed
 *     2026-09-01 over all 34,869 raw records: zero hits each). For 南竿鄉 that
 *     is the scope working rather than a gap — Matsu's provision there is
 *     連江縣立醫院, and 醫院 are an explicit non-goal (spec §2.1), so no row in
 *     either dataset can name it; 連江縣's four rows are the 衛生所 of 北竿, 東引
 *     and 莒光. 烏坵鄉 simply has nobody practising. They stay out because every
 *     entry here should be traceable to a real contracted venue; a first venue
 *     in either lands in UNKNOWN_DISTRICT, reachable at city level, and the
 *     build's 其他 gate notices if it is part of a wider shift.
 *
 * Districts change roughly once a decade. When one does, regenerate the body
 * from a build whose index you have checked, and reflow the printed lines:
 *
 *   node -e 'const c=JSON.parse(require("fs").readFileSync("data/index.json","utf8")).cities;
 *     for(const[k,v]of Object.entries(c))console.log(`"${k}": { ${Object.keys(v)
 *     .filter(d=>d!=="其他").map(d=>`"${d}": true`).join(", ")} },`)'
 *
 * Until then a genuinely new district is caught by the build's 其他 gate
 * (`GATES.maxUnknown`, scripts/build-data.ts), not by this file.
 */
export const DISTRICTS: Readonly<Record<string, Readonly<Record<string, true>>>> = Object.freeze({
  "南投縣": {
    "中寮鄉": true, "仁愛鄉": true, "信義鄉": true, "南投市": true, "名間鄉": true, "國姓鄉": true, "埔里鎮": true,
    "水里鄉": true, "竹山鎮": true, "草屯鎮": true, "集集鎮": true, "魚池鄉": true, "鹿谷鄉": true,
  },
  "嘉義市": {
    "東區": true, "西區": true,
  },
  "嘉義縣": {
    "中埔鄉": true, "六腳鄉": true, "大埔鄉": true, "大林鎮": true, "太保市": true, "布袋鎮": true, "新港鄉": true,
    "朴子市": true, "東石鄉": true, "梅山鄉": true, "民雄鄉": true, "水上鄉": true, "溪口鄉": true, "番路鄉": true,
    "竹崎鄉": true, "義竹鄉": true, "阿里山鄉": true, "鹿草鄉": true,
  },
  "基隆市": {
    "七堵區": true, "中山區": true, "中正區": true, "仁愛區": true, "信義區": true, "安樂區": true, "暖暖區": true,
  },
  "宜蘭縣": {
    "三星鄉": true, "五結鄉": true, "冬山鄉": true, "南澳鄉": true, "員山鄉": true, "壯圍鄉": true, "大同鄉": true,
    "宜蘭市": true, "礁溪鄉": true, "羅東鎮": true, "蘇澳鎮": true, "頭城鎮": true,
  },
  "屏東縣": {
    "三地門鄉": true, "九如鄉": true, "佳冬鄉": true, "來義鄉": true, "內埔鄉": true, "南州鄉": true, "屏東市": true,
    "崁頂鄉": true, "恆春鎮": true, "新園鄉": true, "新埤鄉": true, "春日鄉": true, "東港鎮": true, "枋寮鄉": true,
    "枋山鄉": true, "林邊鄉": true, "泰武鄉": true, "滿州鄉": true, "潮州鎮": true, "牡丹鄉": true, "獅子鄉": true,
    "琉球鄉": true, "瑪家鄉": true, "竹田鄉": true, "萬丹鄉": true, "萬巒鄉": true, "車城鄉": true, "里港鄉": true,
    "長治鄉": true, "霧臺鄉": true, "高樹鄉": true, "鹽埔鄉": true, "麟洛鄉": true,
  },
  "彰化縣": {
    "二林鎮": true, "二水鄉": true, "伸港鄉": true, "北斗鎮": true, "和美鎮": true, "員林市": true, "埔心鄉": true,
    "埔鹽鄉": true, "埤頭鄉": true, "大城鄉": true, "大村鄉": true, "彰化市": true, "永靖鄉": true, "溪州鄉": true,
    "溪湖鎮": true, "田中鎮": true, "田尾鄉": true, "社頭鄉": true, "福興鄉": true, "秀水鄉": true, "竹塘鄉": true,
    "線西鄉": true, "芬園鄉": true, "花壇鄉": true, "芳苑鄉": true, "鹿港鎮": true,
  },
  "新北市": {
    "三峽區": true, "三芝區": true, "三重區": true, "中和區": true, "五股區": true, "八里區": true, "土城區": true,
    "坪林區": true, "平溪區": true, "新店區": true, "新莊區": true, "板橋區": true, "林口區": true, "樹林區": true,
    "永和區": true, "汐止區": true, "泰山區": true, "淡水區": true, "深坑區": true, "烏來區": true, "瑞芳區": true,
    "石碇區": true, "石門區": true, "萬里區": true, "蘆洲區": true, "貢寮區": true, "金山區": true, "雙溪區": true,
    "鶯歌區": true,
  },
  "新竹市": {
    "北區": true, "東區": true, "香山區": true,
  },
  "新竹縣": {
    "五峰鄉": true, "北埔鄉": true, "寶山鄉": true, "尖石鄉": true, "峨眉鄉": true, "新埔鎮": true, "新豐鄉": true,
    "橫山鄉": true, "湖口鄉": true, "竹北市": true, "竹東鎮": true, "芎林鄉": true, "關西鎮": true,
  },
  "桃園市": {
    "中壢區": true, "八德區": true, "大園區": true, "大溪區": true, "平鎮區": true, "復興區": true, "新屋區": true,
    "桃園區": true, "楊梅區": true, "蘆竹區": true, "觀音區": true, "龍潭區": true, "龜山區": true,
  },
  "澎湖縣": {
    "七美鄉": true, "望安鄉": true, "湖西鄉": true, "白沙鄉": true, "西嶼鄉": true, "馬公市": true,
  },
  "臺中市": {
    "中區": true, "北區": true, "北屯區": true, "南區": true, "南屯區": true, "后里區": true, "和平區": true,
    "外埔區": true, "大安區": true, "大甲區": true, "大肚區": true, "大里區": true, "大雅區": true, "太平區": true,
    "新社區": true, "東勢區": true, "東區": true, "梧棲區": true, "沙鹿區": true, "清水區": true, "潭子區": true,
    "烏日區": true, "石岡區": true, "神岡區": true, "西區": true, "西屯區": true, "豐原區": true, "霧峰區": true,
    "龍井區": true,
  },
  "臺北市": {
    "中山區": true, "中正區": true, "信義區": true, "內湖區": true, "北投區": true, "南港區": true, "士林區": true,
    "大同區": true, "大安區": true, "文山區": true, "松山區": true, "萬華區": true,
  },
  "臺南市": {
    "七股區": true, "下營區": true, "中西區": true, "仁德區": true, "佳里區": true, "六甲區": true, "北區": true,
    "北門區": true, "南化區": true, "南區": true, "善化區": true, "大內區": true, "學甲區": true, "安南區": true,
    "安定區": true, "安平區": true, "官田區": true, "將軍區": true, "山上區": true, "左鎮區": true, "後壁區": true,
    "新化區": true, "新市區": true, "新營區": true, "東區": true, "東山區": true, "柳營區": true, "楠西區": true,
    "歸仁區": true, "永康區": true, "玉井區": true, "白河區": true, "西港區": true, "關廟區": true, "鹽水區": true,
    "麻豆區": true, "龍崎區": true,
  },
  "臺東縣": {
    "卑南鄉": true, "大武鄉": true, "太麻里鄉": true, "延平鄉": true, "成功鎮": true, "東河鄉": true, "池上鄉": true,
    "海端鄉": true, "綠島鄉": true, "臺東市": true, "蘭嶼鄉": true, "達仁鄉": true, "金峰鄉": true, "長濱鄉": true,
    "關山鎮": true, "鹿野鄉": true,
  },
  "花蓮縣": {
    "光復鄉": true, "卓溪鄉": true, "吉安鄉": true, "壽豐鄉": true, "富里鄉": true, "新城鄉": true, "玉里鎮": true,
    "瑞穗鄉": true, "秀林鄉": true, "花蓮市": true, "萬榮鄉": true, "豐濱鄉": true, "鳳林鎮": true,
  },
  "苗栗縣": {
    "三灣鄉": true, "三義鄉": true, "公館鄉": true, "卓蘭鎮": true, "南庄鄉": true, "大湖鄉": true, "後龍鎮": true,
    "泰安鄉": true, "獅潭鄉": true, "竹南鎮": true, "苑裡鎮": true, "苗栗市": true, "西湖鄉": true, "通霄鎮": true,
    "造橋鄉": true, "銅鑼鄉": true, "頭份市": true, "頭屋鄉": true,
  },
  "連江縣": {
    "北竿鄉": true, "東引鄉": true, "莒光鄉": true,
  },
  "金門縣": {
    "烈嶼鄉": true, "金城鎮": true, "金寧鄉": true, "金沙鎮": true, "金湖鎮": true,
  },
  "雲林縣": {
    "二崙鄉": true, "元長鄉": true, "北港鎮": true, "口湖鄉": true, "古坑鄉": true, "四湖鄉": true, "土庫鎮": true,
    "大埤鄉": true, "崙背鄉": true, "斗六市": true, "斗南鎮": true, "東勢鄉": true, "林內鄉": true, "水林鄉": true,
    "臺西鄉": true, "莿桐鄉": true, "虎尾鎮": true, "褒忠鄉": true, "西螺鎮": true, "麥寮鄉": true,
  },
  "高雄市": {
    "三民區": true, "仁武區": true, "內門區": true, "六龜區": true, "前金區": true, "前鎮區": true, "大寮區": true,
    "大樹區": true, "大社區": true, "小港區": true, "岡山區": true, "左營區": true, "彌陀區": true, "新興區": true,
    "旗山區": true, "旗津區": true, "杉林區": true, "林園區": true, "桃源區": true, "梓官區": true, "楠梓區": true,
    "橋頭區": true, "永安區": true, "湖內區": true, "燕巢區": true, "田寮區": true, "甲仙區": true, "美濃區": true,
    "苓雅區": true, "茂林區": true, "茄萣區": true, "路竹區": true, "那瑪夏區": true, "阿蓮區": true, "鳥松區": true,
    "鳳山區": true, "鹽埕區": true, "鼓山區": true,
  },
});
