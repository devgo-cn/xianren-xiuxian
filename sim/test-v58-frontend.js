// v5.8 前端单测: pushBoost 同类唯一 / adopt 去重洗存量 / 快照规整
const fs = require("fs");
const vm = require("vm");

const src10 = fs.readFileSync(__dirname + "/../src/10-base.js", "utf8");

function grab(name, from) {
  const i = from.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " not found");
  let depth = 0, j = from.indexOf("{", i);
  for (let k = j; k < from.length; k++) {
    if (from[k] === "{") depth++;
    else if (from[k] === "}") { depth--; if (!depth) return from.slice(i, k + 1); }
  }
  throw new Error(name + " unbalanced");
}

const store = {};
const sandbox = {
  console, Date, JSON, Math, isFinite, Set, Object, Array, store,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
};
sandbox.globalThis = sandbox;

const code = `
const BUFF_CAP_MS = 24 * 3600 * 1000;
const JRN_TAIL = 30, JRN_CAP = 300;
const CUR_VER = 2;
const TOTAL_SEGS = 54;
const QUALITY = [{ mult: 1 }];
function fin(v, lo, hi) {
  if (typeof v === "number" && isFinite(v)) {
    const H = (hi === undefined) ? 1e15 : hi, L = (lo === undefined) ? 0 : lo;
    return Math.min(H, Math.max(L, v));
  }
  return (lo === undefined) ? 0 : lo;
}
let _pred = { exp: 0, spirit: 0 };
let _buffCache = null, _buffCacheT = 0;
let state = {};
${grab("boostMult", src10)}
${grab("pushBoost", src10)}
${grab("adopt", src10)}
globalThis.__api = { boostMult, pushBoost, adopt, stateRef: () => state };
`;

vm.runInNewContext(code, sandbox);
const { boostMult, pushBoost, adopt } = sandbox.__api;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + " " + msg); if (!cond) fails++; };

// 1) pushBoost 同类唯一
sandbox.__api.stateRef().buffs = [];
ok(pushBoost(1.8, 48 * 3600, "兽潮余威", "trial") === true, "首推兽潮成功");
ok(sandbox.__api.stateRef().buffs.length === 1, "仅1条");
ok(pushBoost(1.5, 48 * 3600, "兽潮余威", "trial") === false, "更弱的兽潮不生效");
ok(sandbox.__api.stateRef().buffs.length === 1 && sandbox.__api.stateRef().buffs[0].boost === 1.8, "仍是原1.8条目");
ok(pushBoost(1.2, 12 * 3600, "洗髓丹", "pill") === true, "pill 与 trial 互不冲突");
ok(sandbox.__api.stateRef().buffs.length === 2, "trial+pill 各一条");
// mult 保护专项: 同 tag(pill) 下的 mult 类修为丹不被 boost 替换误删
sandbox.__api.stateRef().buffs = [{ tag: "trial", mult: 1, boost: 1.8, until: Date.now() + 1e8 }, { tag: "pill", mult: 2, boost: 0, name: "聚气丹", until: Date.now() + 1e8 }, { tag: "pill", mult: 1, boost: 0.3, name: "洗髓丹", until: Date.now() + 1e8 }];
ok(pushBoost(0.5, 12 * 3600, "洗髓丹", "pill") === true, "同tag下boost替换成功");
ok(sandbox.__api.stateRef().buffs.filter(b => b.tag === "pill" && b.mult > 1).length === 1, "mult 类修为丹未被 pushBoost 误删");
ok(sandbox.__api.stateRef().buffs.filter(b => b.tag === "pill" && b.boost > 0).length === 1 && sandbox.__api.stateRef().buffs.find(b => b.tag === "pill" && b.boost > 0).boost === 0.5, "同tag旧boost条目被替换");
ok(pushBoost(1.5, 12 * 3600, "洗髓丹", "pill") === true, "更强的洗髓替换");
ok(sandbox.__api.stateRef().buffs.filter(b => b.tag === "pill" && b.boost > 0).length === 1 && sandbox.__api.stateRef().buffs.find(b => b.tag === "pill" && b.boost > 0).boost === 1.5, "pill boost 唯一且为新值");

// 2) boostMult 读唯一化后的表
sandbox.__api.stateRef().buffs = [
  { tag: "trial", mult: 1, boost: 1.8 }, { tag: "pill", mult: 2, boost: 0 }, { tag: "pill", mult: 1, boost: 0.5 },
];
ok(Math.abs(boostMult() - 2.8) < 1e-9, "boostMult=2.8(取最强boost)");

// 3) adopt 洗存量重复(双兽潮余威)
const c = adopt({ arts: [{ slot: 0, q: 3, lv: 1, mult: 2, a: 1, d: 0, h: 0, fx: [] }],
  journal: [], realmIdx: 12, exp: 5,
  buffs: [
    { tag: "trial", mult: 1, boost: 1.8, name: "兽潮余威", start: 1, until: Date.now() + 1e8 },
    { tag: "trial", mult: 1, boost: 1.8, name: "兽潮余威", start: 2, until: Date.now() + 2e8 },
    { tag: "trial", mult: 1, boost: 1.2, name: "兽潮余威", start: 3, until: Date.now() + 3e8 },
    { tag: "pill", mult: 2, boost: 0, name: "聚气丹", start: 1, until: Date.now() + 1e8 },
    { tag: "pill", mult: 1, boost: 0.3, name: "洗髓丹", start: 1, until: Date.now() + 1e8 },
  ] });
const trials = c.buffs.filter(b => b.tag === "trial" && b.boost > 0);
ok(trials.length === 1 && trials[0].boost === 1.8, "三兽潮洗成一条(最高1.8) got " + trials.length);
ok(c.buffs.filter(b => b.tag === "pill" && b.mult > 1).length === 1, "mult 类不受去重影响");
ok(c.buffs.filter(b => b.tag === "pill" && b.boost > 0).length === 1, "pill boost 唯一");

// 4) 快照规整
ok(c.trialSp === 0 && c.trialEq === 0, "缺省快照=0");
const c2 = adopt({ arts: [{ slot: 0, q: 0, lv: 1, a: 1, d: 0, h: 0, fx: [] }], journal: [], realmIdx: 1, exp: 1, trialSp: 2500.7, trialEq: 8.9 });
ok(c2.trialSp === 2501 && c2.trialEq === 9, "快照取整 (" + c2.trialSp + "/" + c2.trialEq + ")");

console.log(fails ? "\n" + fails + " FAILURES" : "\nALL v5.8 FRONTEND TESTS PASSED");
process.exit(fails ? 1 : 0);
