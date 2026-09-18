/* v5.9~v5.11 蒙特卡洛模拟器: 数值表从 src/00-pure.js 源码抓取(与线上 1:1), 战斗公式 1:1 复刻 50-battle.js
 * 用法: node sim/sim-v59.js [次数] [dt]  (可选第3参 old = 减半前倍速对照)
 * 旋钮(opt): bossK 血量倍率 / qnerf 玄天概率下调 / forceFullRed 强制全红 / maxSkill 满技能
 */
/* ============================================================
 * sim-v59.js —— v5.9 倍速概率减半后全境界模拟(蒙特卡洛)
 * 数值表从 src/00-pure.js 源码抠取(与线上 1:1), 战斗公式 1:1 复刻 50-battle.js
 *
 * 口径(与用户对齐):
 *  · 击杀即刷新; 怪从屏幕右侧刷出, 相向而行, 接近距离 = 半屏(CW=412 → 206px)
 *  · 倍速加速一切战斗实体(玩家攻/移速、怪移速、鹰、灵狐 —— 宠物按倍速同步算)
 *  · 兽潮 120s 与 BOSS 30s 走真实墙钟(倍速只加速战斗, 不加速计时)
 *  · 鹰 2s/发 calcDmg(atk,0.8,def,pen); 灵狐 8s 施法: 60%治20%maxHp / 40%攻+30%·6s
 *  · 装备 3.5%/杀、BOSS必掉、同槽评分择优; 旧装熔 50×1.6^q, 不入眼熔 40×1.5^q
 *  · 技能每杀全体+2 exp、BOSS+30; need=120×lv^1.9 满级20
 *  · 玩家死亡 / BOSS 30s 超时 → 兽潮从头再来(装备/技能保留)
 *  · 通关 = 一轮内杀满120小怪 + BOSS 30s 内被斩
 * ============================================================ */
"use strict";
const fs = require("fs");
const SRC = fs.readFileSync(__dirname + "/../src/00-pure.js", "utf8");

function grab(marker) {
  const i = SRC.indexOf(marker);
  if (i < 0) throw new Error("marker not found: " + marker);
  /* 找到 marker 后第一个 { 或 [ 作为起点, 配平对应括号 */
  let start = -1;
  for (let k = i; k < SRC.length; k++) { const c = SRC[k]; if (c === "{" || c === "[") { start = k; break; } if (c === "\n" && /\n\s*\n/.test(SRC.slice(k, k + 2))) break; }
  if (start < 0) throw new Error("no brace: " + marker);
  const open = SRC[start], close = open === "{" ? "}" : "]";
  let depth = 0, j = start, inStr = null;
  for (; j < SRC.length; j++) {
    const c = SRC[j];
    if (inStr) { if (c === "\\") j++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && SRC[j + 1] === "/") { while (j < SRC.length && SRC[j] !== "\n") j++; continue; }
    if (c === "/" && SRC[j + 1] === "*") { j = SRC.indexOf("*/", j) + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error("unbalanced: " + marker);
}
const C = {};
const ev = (marker) => {
  let code = grab(marker);
  code = code.replace(/^const (\w+) =/, "C.$1 =").replace(/^function (\w+)/, "C.$1 = function $1");
  eval(code);   // 严格 eval: 赋值表达式引用模块内 C, 可行
};
ev("const QUALITY =");
ev("const FX_POOL =");
ev("function fxCount");
ev("function fxValue");
ev("function eqMult");
ev("function finalStats");
ev("const SKILL_DEFS =");
ev("const MOB_POOLS =");
ev("const BASE_STATS =");
ev("const EQ_POW =");
ev("const QW_TABLE =");
ev("function bigIndexOf");
ev("function skillExpNeed");
ev("const BIGS =");

const { QUALITY, FX_POOL, fxCount, fxValue, eqMult, finalStats, SKILL_DEFS, MOB_POOLS,
  BASE_STATS, EQ_POW, QW_TABLE, skillExpNeed, BIGS } = C;

/* ---- 50-battle.js 常量 ---- */
const CW = 412, D_WALK = CW / 2;              // 竖屏 412px; 接近距离 = 半屏(用户口径)
const P_SPD = 42, E_SPD = 120, BOSS_SPD = 90;
const BASE_ASPD = 1.1;
const EQUIP_CHANCE = 0.035;
const SKILL_BIG = { damageMult: 2.5, cooldown: 4.0, triggerChance: 0.3, fps: 24, hitFrame: 12, count: 24 };
const SKILL_MAX = 20;
const SLOT_KIND = ["w", "a", "p", "s"];
const QMUL = [1.0, 1.4, 1.8, 2.5, 3.5, 5.0];
const rnd = Math.random, rr = (a, b) => a + rnd() * (b - a);
const calcDmg = (atk, mult, def, pen) =>
  Math.max(1, Math.round(atk * mult * (atk / (atk + Math.max(0, def * (1 - Math.min(90, pen || 0) / 100))))));

/* ---- 装备生成(源码 1:1) ---- */
let QNERF = false;
let FORCE_FULLRED = false;
function bestFullRed(bi) {
  const M = eqMult(5), pow = EQ_POW[Math.min(EQ_POW.length - 1, bi)] || 1;
  const mk = (kind, a, d, h) => ({ slot: SLOT_KIND.indexOf(kind), q: 5, a, d, h, fx: rollFx(kind, 5) });
  return [ mk("w", Math.round(16 * pow * M), 0, 0), mk("a", 0, Math.round(13 * pow * M), Math.round(120 * pow * M)),
           mk("p", Math.round(5 * pow * M), Math.round(6 * pow * M), Math.round(48 * pow * M)), mk("s", Math.round(8 * pow * M), Math.round(6 * pow * M), 0) ];
}   // true = 中后期玄天概率下调(对照旋钮)
const QW_NERF = { 6: [20,18,18,16,16,7], 7: [20,18,18,16,16,7], 8: [12,14,16,18,20,10], 9: [12,14,16,18,20,10], 10: [6,10,14,18,24,15], 11: [6,10,14,18,24,15] };
function pickQ(bi) {
  const qw = (QNERF && QW_NERF[bi]) || QW_TABLE[Math.min(QW_TABLE.length - 1, bi)];
  let x = rnd() * qw.reduce((s, r) => s + r, 0);
  for (let i = 0; i < QUALITY.length; i++) { x -= qw[i]; if (x <= 0) return i; }
  return 0;
}
function rollFx(kind, q) {
  const pool = (FX_POOL[kind] || FX_POOL.w).slice();
  const n = fxCount(q), f = [], legChance = 0.04 + q * 0.052;
  if (kind === "s") {
    const v = fxValue("aspd", q), leg = rnd() < legChance;
    f.push({ k: "aspd", v: leg ? Math.round(v * 2.4) : v, legendary: leg });
  }
  for (let i = f.length; i < n && pool.length; i++) {
    const key = pool.splice((rnd() * pool.length) | 0, 1)[0];
    const v = fxValue(key, q), leg = rnd() < legChance;
    f.push({ k: key, v: leg ? Math.round(v * 2.4) : v, legendary: leg });
  }
  return f;
}
function makeArt(bi, artsLen) {
  const q = pickQ(bi);
  const slot = artsLen < 4 ? artsLen : (rnd() * 4) | 0;
  const kind = SLOT_KIND[slot], M = eqMult(q);
  const pow = EQ_POW[Math.min(EQ_POW.length - 1, bi)] || 1;
  const r1 = rnd(), r2 = rnd(), r3 = rnd();
  let a, d, h;
  if (kind === "w") { a = Math.max(1, Math.round((4 + r1 * 15) * pow * M)); h = 0; d = 0; }
  else if (kind === "a") { h = Math.round((38 + r1 * 114) * pow * M); d = Math.max(1, Math.round((2 + r2 * 15) * pow * M)); a = 0; }
  else if (kind === "p") { h = Math.round((15 + r1 * 46) * pow * M); d = Math.max(1, Math.round((2 + r2 * 6) * pow * M)); a = Math.round((1.5 + r3 * 4.5) * pow * M); }
  else { a = Math.round((2.3 + r1 * 6.7) * pow * M); d = Math.max(1, Math.round((2 + r2 * 5) * pow * M)); h = 0; }
  return { slot, q, a, d, h, fx: rollFx(kind, q) };
}
function artCtxOf(bi, arts) {
  const bs = BASE_STATS[Math.min(BASE_STATS.length - 1, bi)];
  const eb0 = equipBonusOf(arts);
  return { atkRef: Math.max(220, bs[0] + eb0.atk), defRef: Math.max(90, bs[2] + eb0.def), hpRef: Math.max(320, bs[1] + eb0.hp) };
}
function artScore(a, ctx) {
  const base = (a.a || 0) * 1.0 + (a.d || 0) * 2.5 + (a.h || 0) * 0.05;
  let fx = 0;
  for (const f of (a.fx || [])) {
    const p = f.v / 100; let val = 0;
    if (f.k === "atk") val = p * ctx.atkRef;
    else if (f.k === "hp") val = p * ctx.hpRef * 0.05;
    else if (f.k === "dfn") val = p * ctx.defRef * 2.5;
    else if (f.k === "crit") val = p * ctx.atkRef * 0.55;
    else if (f.k === "critB") val = p * ctx.atkRef * 1.0;
    else if (f.k === "critD") val = p * ctx.atkRef * 0.15;
    else if (f.k === "pen") val = p * ctx.atkRef * 0.35;
    else if (f.k === "dodge") val = p * ctx.defRef * 2.5;
    else if (f.k === "life") val = p * ctx.atkRef * 0.5;
    else if (f.k === "aspd") val = p * ctx.atkRef * 0.8;
    fx += val * (f.legendary ? 1.3 : 1);
  }
  return Math.round((base + fx) * QMUL[Math.max(0, Math.min(5, a.q | 0))]);
}
function equipBonusOf(arts) {
  let atk = 0, def = 0, hp = 0;
  for (const a of arts) { atk += a.a || 0; def += a.d || 0; hp += a.h || 0; }
  const agg = { atk: 0, hp: 0, dfn: 0, crit: 0, critB: 0, critD: 0, pen: 0, dodge: 0, life: 0, aspd: 0 };
  for (const a of arts) for (const f of (a.fx || [])) if (agg[f.k] != null) agg[f.k] += f.v;
  return { atk, def, hp, agg };
}
function makePlayer(bi, arts) {
  const bs = BASE_STATS[Math.min(BASE_STATS.length - 1, bi)];
  const eb = equipBonusOf(arts);
  const s = finalStats({ hp: bs[1], atk: bs[0], def: bs[2] }, { hp: eb.hp, atk: eb.atk, def: eb.def }, eb.agg);
  s.lv = bi + 1;
  return s;
}
/* keepArtQuiet(源码 1:1): 同槽评分择优 */
function keepArtQuiet(a, arts, bi, addSpirit) {
  const idx = a.slot;
  if (idx >= arts.length) { arts.push(a); return true; }
  const w = arts[idx];
  const ctx = artCtxOf(bi, arts);
  if (artScore(a, ctx) > artScore(w, ctx)) {
    addSpirit(Math.round(50 * Math.pow(1.6, w.q)));
    arts[idx] = a; return true;
  }
  addSpirit(Math.round(40 * Math.pow(1.5, a.q)));
  return false;
}

/* ---- 技能 ---- */
let SPEED_NERF = true;   // true = v5.9 减半后(源码值); false = 减半前(概率×2 对照)
function skillValOf(skills, id) {
  const d = SKILL_DEFS.find(x => x.id === id);
  const lv = Math.min(SKILL_MAX, Math.max(1, (skills[id] || { lv: 1 }).lv | 0));
  const t = (lv - 1) / (SKILL_MAX - 1), o = { lv };
  for (const k in d.from) o[k] = d.from[k] + (d.to[k] - d.from[k]) * t;
  if (!SPEED_NERF && (d.id === "jifeng" || d.id === "suodi")) o.chance *= 2;
  return o;
}
function skExpAll(skills, n) {
  for (const d of SKILL_DEFS) {
    const s = skills[d.id] || (skills[d.id] = { lv: 1, exp: 0 });
    if (s.lv >= SKILL_MAX) continue;
    s.exp += n;
    while (s.lv < SKILL_MAX && s.exp >= skillExpNeed(s.lv)) { s.exp -= skillExpNeed(s.lv); s.lv++; }
  }
}
function critRoll(PST, target, bonus) {
  const res = (target && target.critRes) || 0;
  let kind = 0;
  if (rnd() * 100 < Math.max(0, (PST.crit || 0) + (bonus || 0) - res)) kind = 2;
  else if (rnd() * 100 < Math.max(0, (PST.critB || 0) - res)) kind = 1;
  const cmul = kind === 2 ? 2 : kind === 1 ? 1.5 : 1;
  return { kind, mult: kind ? cmul * (1 + (PST.critD || 0) / 100) : 1 };
}

/* ============================================================
 * 一轮兽潮(120s 小怪段 + BOSS 30s) —— 状态机步进
 * 返回: { result: 'clear'|'timeup'|'dead'|'bosstimeout', wall, kills, drops, keeps, melt, bossT }
 * ============================================================ */
function roundSim(bi, PST0, arts, skills, opt) {
  const DT = opt.dt || 0.05;
  const POOL_KEYS = [1, 2, 15, 19, 23, 27, 31, 35, 39, 43, 47, 51];   // poolFor: 各大境界起始段 lv
  const pool = MOB_POOLS[POOL_KEYS[bi]];
  let PST = PST0;
  let spawned = 0, kills = 0, drops = 0, keeps = 0, melt = 0;
  let wall = 0, trialT = 120, bossT = 30, bossPhase = false, bossStart = 0;
  /* 实体 */
  let sm = 1, smT = 0, dodgeBuf = 0;
  let atkT = 0.2, anim = -1, sanlian = false, hitDone = null, animSub = 0;
  let bigAnim = -1, bigHit = false, bigCd = 0;         // 主动技
  let nextCrit = 0;
  let foe = null, foeGap = D_WALK, eAtkT = 0.6;
  let eagleT = 1.0, foxT = 4.0, casting = 0, castType = null, atkBuf = 0, atkBufT = 0;
  let php = PST.hp;

  const addSpirit = (v) => { melt += v; };
  const refreshPST = () => { PST = makePlayer(bi, arts); php = Math.min(php, PST.hp); };
  const rollSpeed = () => {
    /* 源码: 先 roll 高档(缩地), 中了低档让位; applySpeedBuff 倍率取 max 时长重置 */
    const hi = skillValOf(skills, "suodi");
    if (rnd() * 100 < hi.chance) {
      if (3.5 >= sm) sm = 3.5; smT = 8; dodgeBuf = Math.max(dodgeBuf, hi.dodge); return;
    }
    const lo = skillValOf(skills, "jifeng");
    if (rnd() * 100 < lo.chance) {
      if (2.5 >= sm) sm = 2.5; smT = 8; dodgeBuf = Math.max(dodgeBuf, lo.dodge);
    }
  };
  const spawnNext = () => {
    if (spawned >= 121) return;
    const idx = spawned;
    const e = idx < 120 ? pool.waves[Math.min(11, (idx / 10) | 0)] : pool.boss;
    const hpAdj = e === pool.boss ? e.hp * (opt.bossK || 1) : e.hp;
    foe = { hp: hpAdj, maxHp: hpAdj, atk: e.atk, def: e.def, dodge: e.dodge, pen: e.pen, crit: e.crit, critRes: e.critRes, isBoss: idx >= 120 };
    foeGap = D_WALK;
    eAtkT = 0.6;
    spawned++;
    if (foe.isBoss) { bossPhase = true; bossStart = wall; }
  };
  const onKill = (isBoss) => {
    kills++;
    skExpAll(skills, isBoss ? 30 : 2);
    /* 追猎: 击杀后概率衔尾(下一次出手立即, 该击暴击率大增) */
    const zl = skillValOf(skills, "zhuilie");
    if (rnd() * 100 < zl.chance) { nextCrit = zl.crit; atkT = 0; }
    /* 掉落: BOSS 必掉, 小怪 3.5% */
    if (isBoss || rnd() < EQUIP_CHANCE) {
      drops++;
      const a = makeArt(bi, arts.length);
      if (keepArtQuiet(a, arts, bi, addSpirit)) keeps++; else melt += 0;
      refreshPST();
    }
    /* 灵石 */
    melt += Math.max(1, Math.round((30 + 5 * (bi + 1)) * rr(0.6, 1.4) * (isBoss ? 8 : 1)));
  };
  /* playerStrike 源码 1:1(seg=1 主段/2 三连二剑/3 三连补刀) */
  const strike = (seg) => {
    if (!foe || foe.hp <= 0) return;
    rollSpeed();                                          // 身法 roll: 命中判定前, miss 也 roll
    if (rnd() * 100 < (foe.dodge || 0)) return;           // 怪闪避 → 落空
    let base = seg === 3 ? 1 : seg === 2 ? rr(0.5, 0.65) : rr(1.0, 1.25);
    let pen = PST.pen || 0;
    const pj = skillValOf(skills, "pojia");
    if (rnd() * 100 < pj.chance) pen = Math.min(90, pen + pj.pen);
    const zs = skillValOf(skills, "zhansha");
    if (foe.hp / foe.maxHp * 100 < zs.threshold) base *= 2;
    let r;
    if (seg === 3) r = { kind: 1, mult: 1.5 * (1 + (PST.critD || 0) / 100) };   // 补刀必会心(至少×1.5)
    else r = critRoll(PST, foe, nextCrit), nextCrit = 0;
    const sl = seg === 3 ? skillValOf(skills, "sanlian") : null;
    const mult = base * (sl ? (sl.dmg || 0) / 100 : 1) * r.mult;
    foe.hp -= calcDmg(PST.atk, mult, foe.def, pen);
    if (foe.hp <= 0) { killFoe(seg); return; }
    /* 剑气斩: 主段命中后追加一段 */
    if (seg === 1) {
      const jq = skillValOf(skills, "jianqi");
      if (rnd() * 100 < jq.chance) foe.hp -= calcDmg(PST.atk, base * (jq.dmg || 0) / 100, foe.def, pen);
      if (foe.hp <= 0) { killFoe(seg); return; }
      const slv = skillValOf(skills, "sanlian");
      if (rnd() * 100 < slv.chance) sanlian = true;
    }
  };
  const killFoe = (seg) => {
    const wasBoss = foe.isBoss;
    onKill(wasBoss);
    if (wasBoss) return;
    /* 主段击杀 → 收招吃满间隔; 追猎衔尾时 atkT=0 */
    anim = -1; animSub = 0;
    if (!(nextCrit > 0 && atkT <= 0)) atkT = Math.max(atkT, 1 / PST.aspd);
    if (extra_pend) { /* placeholder */ }
    spawnNext();
  };
  let extra_pend = false;

  spawnNext();
  let guard = 0;
  while (true) {
    if (guard++ > 200000) return { result: "timeup", wall, kills, drops, keeps, melt, bossUse: 0 };
    const gdt = DT * sm;
    wall += DT;
    /* 计时(真实墙钟) */
    if (bossPhase) { bossT -= DT; if (bossT <= 0) return { result: "bosstimeout", wall, kills, drops, keeps, melt, bossUse: 30 }; }
    else { trialT -= DT; if (trialT <= 0) return { result: "timeup", wall, kills, drops, keeps, melt, bossUse: 0 }; }
    /* 倍速 */
    if (smT > 0) { smT -= gdt; if (smT <= 0) { sm = 1; dodgeBuf = 0; } }
    /* 灵狐(吃倍速, 用户口径) */
    if (casting > 0) {
      casting -= gdt;
      if (casting <= 0) {
        if (castType === "heal") php = Math.min(PST.hp, php + Math.round(PST.hp * 0.2));
        else { atkBuf = 0.3; atkBufT = 6; }
        foxT = 8;
      }
    } else { foxT -= gdt; if (foxT <= 0) { casting = 1.2; castType = rnd() < 0.6 ? "heal" : "atk"; } }
    if (atkBufT > 0) { atkBufT -= gdt; if (atkBufT <= 0) atkBuf = 0; }

    if (foeGap > 0) {
      /* 接近: 相向而行 */
      foeGap -= (P_SPD + (foe.isBoss ? BOSS_SPD : E_SPD)) * gdt;
      atkT -= gdt; bigCd -= gdt;
      eagleT -= gdt;
      if (eagleT <= 0) {                                  // 鹰可攻击接近中的怪(追踪弹幕)
        eagleT = 2;
        foe.hp -= calcDmg(PST.atk, 0.8, foe.def, PST.pen);
        if (foe.hp <= 0) { const wasBoss = foe.isBoss; onKill(wasBoss); if (wasBoss) break; spawnNext(); continue; }
      }
      if (foeGap <= 0) { foeGap = 0; if (atkT < 0) atkT = 0; }
      continue;
    }

    /* ---- 贴身战斗 ---- */
    /* 玩家 */
    bigCd -= gdt;
    if (bigAnim >= 0) {                                   // 主动技动画(1s, 不吃攻速)
      bigAnim += gdt * SKILL_BIG.fps;
      if (!bigHit && bigAnim >= SKILL_BIG.hitFrame) {
        bigHit = true;
        const r = critRoll(PST, foe, 0);
        foe.hp -= calcDmg(PST.atk * (1 + atkBuf), SKILL_BIG.damageMult * rr(0.9, 1.1) * r.mult, foe.def, PST.pen);
        if (foe.hp <= 0) { const wasBoss = foe.isBoss; anim = -1; bigAnim = -1; onKill(wasBoss); if (wasBoss) break; spawnNext(); continue; }
      }
      if (bigAnim >= SKILL_BIG.count) { bigAnim = -1; bigCd = SKILL_BIG.cooldown; }
    } else if (anim >= 0) {                               // 普攻动画
      const prev = anim;
      anim += gdt * 24 * PST.aspd / 1.1;
      for (const fr of [12, 18, 22]) {
        if (hitDone[fr]) continue;
        if (anim >= fr) {
          hitDone[fr] = true;
          strike(fr === 12 ? 1 : fr === 18 ? 2 : 3);
          if (!foe || foe.hp <= 0) break;
        }
      }
      if (foe && foe.hp <= 0) { /* killFoe 已处理 */ }
      if (!foe) continue;                                 // 击杀后 spawnNext 已换怪
      if (anim >= 24) { anim = -1; hitDone = { 12: false, 18: false, 22: false }; atkT = 1 / PST.aspd; }
    } else {                                              // idle → 开打
      atkT -= gdt;
      if (atkT <= 0 && foe.hp > 0) {
        if (rnd() < SKILL_BIG.triggerChance && bigCd <= 0) {
          bigAnim = 0; bigHit = false;
        } else { anim = 0; sanlian = false; hitDone = { 12: false, 18: false, 22: false }; }
      }
    }
    /* 怪攻击 */
    eAtkT -= gdt;
    if (eAtkT <= 0 && foe.hp > 0) {
      eAtkT = 1 / rr(0.8, 1.3);
      if (rnd() * 100 >= (PST.dodge || 0) + dodgeBuf) {
        let dmg = calcDmg(foe.atk, rr(0.85, 1.15), PST.def, foe.pen || 0);
        if (rnd() * 100 < (foe.crit || 0)) dmg = Math.round(dmg * 1.8);
        php -= dmg;
        if (php <= 0) return { result: "dead", wall, kills, drops, keeps, melt, bossUse: bossPhase ? wall - bossStart : 0 };
      }
    }
    /* 鹰 */
    eagleT -= gdt;
    if (eagleT <= 0 && foe.hp > 0) {
      eagleT = 2;
      foe.hp -= calcDmg(PST.atk, 0.8, foe.def, PST.pen);
      if (foe.hp <= 0) {
        const wasBoss = foe.isBoss;
        onKill(wasBoss);
        if (wasBoss) break;
        anim = -1; bigAnim = -1;
        spawnNext();
        continue;
      }
    }
    /* 通关 */
    if (foe && foe.isBoss && foe.hp <= 0) break;
  }
  return { result: "clear", wall, kills: kills, drops, keeps, melt, bossUse: bossPhase ? wall - bossStart : 0 };
}

/* ============================================================
 * 单次完整模拟: 凡人→天仙逐境界打到通关
 * ============================================================ */
function simulate(opt = {}) {
  QNERF = !!opt.qnerf;
  FORCE_FULLRED = !!opt.forceFullRed;
  const arts = [], skills = {};
  for (const d of SKILL_DEFS) skills[d.id] = { lv: opt.maxSkill ? SKILL_MAX : 1, exp: 0 };
  const out = [];
  let grandWall = 0, grandDrops = 0, grandKeeps = 0, grandMelt = 0;
  const qTotal = [0, 0, 0, 0, 0, 0];
  for (let bi = 0; bi < 12; bi++) {
    let PST = makePlayer(bi, arts);
    let round = 0, wallRealm = 0, dropsR = 0, keepsR = 0, meltR = 0, firstKills = -1, clearKills = 0, bossUse = 0;
    let done = false;
    const killSamples = [];
    if (FORCE_FULLRED) { arts.length = 0; arts.push(...bestFullRed(bi)); }
    while (!done && round < 300) {
      const r = roundSim(bi, PST, arts, skills, opt);
      round++; wallRealm += r.wall; dropsR += r.drops; keepsR += r.keeps; meltR += r.melt;
      killSamples.push(r.kills);
      if (firstKills < 0) firstKills = r.kills;
      if (r.result === "clear") { done = true; clearKills = r.kills; bossUse = r.bossUse; }
      PST = makePlayer(bi, arts);                        // 重开: 面板随装备刷新
    }
    grandWall += wallRealm; grandDrops += dropsR; grandKeeps += keepsR; grandMelt += meltR;
    const curve = [1, 3, 5, 10, 20, 40, 80].map(n => killSamples[Math.min(n - 1, killSamples.length - 1)]);
    out.push({
      bi, name: BIGS[bi].n, rounds: round, wallH: wallRealm / 3600,
      firstKills, clearKills, bossUse, curve,
      drops: dropsR, keeps: keepsR, meltSpirit: meltR,
      failed: !done,
      pst: (() => { const p = makePlayer(bi, arts); return { atk: p.atk, hp: p.hp, def: p.def, aspd: +p.aspd.toFixed(2), crit: p.crit || 0, pen: p.pen || 0 }; })(),
      skills: { jifeng: skillValOf(skills, "jifeng").lv, suodi: skillValOf(skills, "suodi").lv },
      qAtExit: arts.map(a => a.q).join(","),
    });
    if (!done) break;
  }
  return { out, grandWallH: grandWall / 3600, grandDrops, grandKeeps, grandMelt };
}

const median = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[(a.length / 2) | 0]; };
const p90 = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, ((a.length * 0.9) | 0))]; };

/* ---- 主入口 ---- */
if (require.main === module) {
  const N = +(process.argv[2] || 20);
  const DT = +(process.argv[3] || 0.05);
  SPEED_NERF = process.argv[4] !== "old";
  const TAG = SPEED_NERF ? "v5.9减半后" : "减半前对照";
  console.error(`蒙特卡洛 N=${N} dt=${DT} ...`);
  const t0 = Date.now();
  const all = [];
  for (let i = 0; i < N; i++) { all.push(simulate({ dt: DT })); if (i % 5 === 4) console.error(`  ${i + 1}/${N} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); }
  /* 汇总: 按境界 */
  console.log(`\n=== 各境界(${TAG}, 均值/中位/P90) ===`);
  console.log("境界 | 轮数(中位) | 通关耗时h(中位) | 通关耗时h(均值) | 首轮120s击杀(中位) | 通关轮120s击杀(中位) | BOSS斩杀s(中位) | 掉装(均值) | 穿戴(均值) | 熔灵石(均值)");
  for (let bi = 0; bi < 12; bi++) {
    const rs = all.map(s => s.out[bi]).filter(Boolean);
    if (!rs.length) break;
    const m = (f) => median(rs.map(f));
    const avg = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
    console.log(
      `${BIGS[bi].n} | ${m(r => r.rounds)} | ${m(r => r.wallH).toFixed(2)} | ${avg(r => r.wallH).toFixed(2)} | ` +
      `${m(r => r.firstKills)} | ${m(r => r.clearKills)} | ${m(r => r.bossUse).toFixed(1)} | ` +
      `${avg(r => r.drops).toFixed(0)} | ${avg(r => r.keeps).toFixed(0)} | ${avg(r => r.meltSpirit).toFixed(0)}`
    );
  }
  const walls = all.map(s => s.grandWallH);
  console.log(`\n全程(凡人→天仙通关): 中位 ${median(walls).toFixed(1)}h · 均值 ${(walls.reduce((a, b) => a + b, 0) / N).toFixed(1)}h · P90 ${p90(walls).toFixed(1)}h`);
  console.log("\n=== 120s 击杀成长曲线(轮1→轮3→轮5→轮10→轮20→轮40→轮80, 中位) ===");
  for (let bi = 0; bi < 12; bi++) {
    const rs = all.map(s => s.out[bi]).filter(Boolean);
    if (!rs.length) break;
    const cv = [1, 3, 5, 10, 20, 40, 80].map((n, i) => median(rs.map(r => (r.curve || [])[i])));
    console.log(`${BIGS[bi].n}: ${cv.join(" → ")}`);
  }
  const drops = all.map(s => s.grandDrops), keeps = all.map(s => s.grandKeeps), melt = all.map(s => s.grandMelt);
  console.log(`全程掉装: 均值 ${(drops.reduce((a, b) => a + b, 0) / N).toFixed(0)} 件 · 穿戴 ${((keeps.reduce((a, b) => a + b, 0)) / N).toFixed(0)} 件 · 熔炼灵石 ${((melt.reduce((a, b) => a + b, 0)) / N).toFixed(0)}`);
  console.error(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
module.exports = { simulate };
