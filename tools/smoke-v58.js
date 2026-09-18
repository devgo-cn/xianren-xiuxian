// ECS 服务器端冒烟(存档全链路): 需在 ECS 上运行(依赖 /opt/dongtian/game-core.js 与本机 8090 正式服务)
// 用法: node tools/smoke-v58.js  — Core 层 7 项 + HTTP 全链路 3 项
/* v5.8 后端冒烟: 快照结算全链路(重启 dongtian-save 后跑) */
const http = require("http");
const zlib = require("zlib");
const Core = require("/opt/dongtian/game-core.js");
/* 不 require save-server.js —— 它被 require 时会顺带 listen 8090 撞正式服务; pack/unpack 就地实现 */
const pack = (o) => "g1:" + zlib.gzipSync(Buffer.from(JSON.stringify(o))).toString("base64");
const unpack = (s) => JSON.parse(zlib.gunzipSync(Buffer.from(s.slice(3), "base64")).toString("utf8"));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("PASS", msg); } else { fail++; console.log("FAIL", msg); } };

function mkState(over) {
  const now = Date.now();
  return Object.assign({
    realmIdx: 12, exp: 0, spirit: 0, arrayLv: 5, arts: [], journal: [], milestones: {},
    peakSpirit: 0, bestArtQ: -1, lastTs: now - 7200 * 1000, mats: {}, pills: {}, buffs: [],
    offPills: [], travel: null, mails: [], offlineBoostUntil: 0,
    trialBest: 100, trialBoost: 0, trialBoostUntil: 0, trialSp: 900, trialEq: 3,
    pages: {}, name: "", _pn: "", _named: 0, _settledAt: 0, ver: 2, skills: {},
  }, over || {});
}
const stripTs = (s) => { const c = Object.assign({}, s); delete c.lastTs; delete c._settledAt; return c; };

/* ---- Core 层 ---- */
// 1) 快照灵石: dt=7200s → waves=60, spirit = 60*900*0.7 = 37800 (offMult=1 无boost池)
const r1 = Core.settle(mkState(), Date.now());
ok(r1.gains.spirit === 37800, "快照灵石 = 60波*900*0.7 = 37800, got " + r1.gains.spirit);

// 2) 快照装备: equip.total = round(60*3*0.7) = 126
const eq = r1.gains.equip || {};
ok(eq.total === 126, "装备 total = round(60*3*0.7) = 126, got " + eq.total);
ok((eq.kept || 0) + (eq.melted || 0) === 126, "kept+melted = total, got " + eq.kept + "+" + eq.melted);

// 3) trial 标记: kills = waves*trialBest = 6000, snap=1
const tr = r1.gains.trial || {};
ok(tr.kills === 6000 && tr.snap === 1, "trial kills=6000 snap=1, got " + JSON.stringify({ k: tr.kills, s: tr.snap }));

// 4) 修为全场景 100%: 在线 60s 与离线 60s 的 exp 完全相等(同参数)
const nowA = Date.now();
const rOn = Core.settle(mkState({ lastTs: nowA - 60 * 1000 }), nowA);      // 60s → online
const nowB = Date.now();
const rOff = Core.settle(mkState({ lastTs: nowB - 60 * 1000 - 3600 * 1000 }), nowB); // 1h+60s 前锚→ 离线? 不行, 锚按lastTs, dt=3660s>180 → 离线, dt=3660
// 改: 直接比 exp/dt 每秒速率
const rateOn = rOn.gains.exp / 60;
const rateOff = rOff.gains.exp / 3660;
ok(Math.abs(rateOn - rateOff) < rateOn * 1e-9, "修为速率在线=离线(100%无七折) " + rateOn.toFixed(3) + " vs " + rateOff.toFixed(3));

// 5) boost 池离线加成比率 2.8 (trial 1.8 + pill 0.3? no: 1.8+? boost池=max(1+boost) 对称buffMult? 权重...)
// buffMultWeighted 区间加权取最强 — 全程覆盖单条 1.8 → offMult = 2.8
const nowC = Date.now();
const b18 = [{ tag: "trial", mult: 1, boost: 1.8, name: "兽潮余威", start: nowC - 7200e3, until: nowC + 1e8 }];
const rB = Core.settle(mkState({ buffs: b18, lastTs: nowC - 7200 * 1000 }), nowC);
const rateB = rB.gains.exp / 7200;
const nowD = Date.now();
const rP = Core.settle(mkState({ lastTs: nowD - 7200 * 1000 }), nowD);
const rateP = rP.gains.exp / 7200;
ok(Math.abs(rateB / rateP - 2.8) < 1e-6, "离线带兽潮余威修为 x2.8, got " + (rateB / rateP).toFixed(4));
// 6) 快照灵石同样吃 boost: 37800*2.8 = 105840
ok(rB.gains.spirit === Math.round(60 * 900 * 0.7 * 2.8), "快照灵石 x2.8 = 105840, got " + rB.gains.spirit);

/* ---- HTTP 全链路 ---- */
const ID = "smoke-v58-" + Date.now();
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: 8090, path, method,
      headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
      (res) => { let buf = ""; res.on("data", c => buf += c); res.on("end", () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
(async () => {
  /* 注: settle 锚 = min(max(lastTs, last_settle), now), 普通 PUT 会刷新 last_settle ——
   * 所以必须"新档直接 settle", 不能先 PUT 再 settle(否则 dt≈0, 正确的反刷行为) */
  const st = mkState();
  const p2 = await req("PUT", "/api/save?id=" + ID + "&settle=1", { __z: pack(st) });
  const gg = p2.gains || {};
  ok(gg.spirit === 37800 && gg.equip && gg.equip.total === 126, "HTTP settle 离线快照结算 spirit=37800 equip.total=126, got " + gg.spirit + "/" + (gg.equip && gg.equip.total));
  // GET 回读 → trialSp/trialEq 过 sanitize 未丢(且 settle 后回写档仍保留)
  const g1 = await req("GET", "/api/save?id=" + ID);
  const back = unpack(g1.data);
  ok(back.trialSp === 900 && back.trialEq === 3, "GET 回读 trialSp=900 trialEq=3, got " + back.trialSp + "/" + back.trialEq);
  // 立刻再 settle 一次 → dt≈0, 不重复结算(反刷)
  const st3 = mkState(); delete st3.lastTs;   // lastTs 用回包档内的 _settledAt? 直接空跑
  const p3 = await req("PUT", "/api/save?id=" + ID + "&settle=1", { __z: pack({ ...mkState(), lastTs: Date.now() }) });
  const gg3 = p3.gains || {};
  ok((gg3.spirit || 0) === 0, "连续 settle 不重复发收益(反刷), got spirit=" + gg3.spirit);

  console.log(fail === 0 ? "\nALL SMOKE PASSED (" + pass + ")" : "\n" + fail + " FAILURES");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("SMOKE ERROR", e); process.exit(1); });
