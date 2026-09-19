/**
 * src/06-v6ui.js —— v6 挂机重构：DOM 层
 *
 * ── 分工 ──────────────────────────────────────────────────────────
 *   00-*.js    纯数学（无状态）
 *   05-v6.js   状态 + 结算逻辑（无 DOM）
 *   本文件     DOM 渲染 + 事件绑定 ← 只做「读状态 → 写 DOM」和「事件 → 调 05」
 *
 * 渲染节流：DOM 写入按 6 帧/秒节流（RENDER_MS），但推进逻辑按每帧跑，
 * 否则 60fps 下每帧写 10 个节点会造成移动端掉帧。
 *
 * ── 与旧系统的关系 ────────────────────────────────────────────────
 * v6 状态挂在 window.__V6，与旧 state 并行存在，互不干扰。
 * 旧系统（打坐/聚灵阵/云游/丹方）暂不删除，只把入口从 UI 摘掉 ——
 * 这样万一新玩法要回滚，旧代码还在（回滚只需恢复 index.html 的按钮区）。
 */

import * as N from './00-num.js';
import * as E from './00-equip.js';
import * as R from './00-rebirth.js';   // v7.1：起始关 startStageFor
import * as RM from './00-realm.js';
import * as V from './05-v6.js';

/* ─────────────────────────────────────────────────────────────
 *  状态句柄
 * ───────────────────────────────────────────────────────────── */

/** v6 运行时状态（全局唯一实例） */
let S6 = null;

/** 各装备槽独立升级档位（1/10/100/1000/10000）；旧共用档位已拆成每槽一个下拉 */
const STEPS = { atk: 1, hp: 1, def: 1, aspd: 1 };

/** 上一次 DOM 渲染时间戳 */
let lastRender = 0;

/** 自驱动定时器句柄 */
let _timer = 0;

/** 渲染节流间隔（毫秒）。6 帧/秒对挂机游戏足够，且省电。 */
const RENDER_MS = 160;

/** 推进逻辑的两次 tick 之间的最大允许时长（防切后台后一次跳太多） */
const MAX_TICK_MS = 500;

/** 自驱动间隔（毫秒）。200ms = 5 次/秒，挂机游戏足够，且比 rAF 省电。 */
const DRIVE_MS = 200;

/** 取状态 */
export function state6() { return S6; }

/* ─────────────────────────────────────────────────────────────
 *  初始化
 * ───────────────────────────────────────────────────────────── */

/**
 * 初始化 v6 系统。
 * @param {object} [legacy] 旧 state（用于迁移宠物倍速等资产）
 */
export function initV6(legacy) {
  if (S6) return S6;
  S6 = V.fromLegacy(legacy || (typeof window !== 'undefined' ? window.state : null));
  S6.lastTick = Date.now();
  render6(true);
  startDriver();
  bindDeathHook(0);
  return S6;
}

/**
 * 启动自驱动定时器。
 *
 * ── 为什么 v6 要自带定时器，而不只挂在旧主循环上 ──────────────────
 * 旧主循环（40-app 的 main）启动链路是：
 *   boot() → bootGate()（云存档门禁，要联网）
 *          → 门禁失败则 splashFail() 并 return —— 主循环根本不会跑
 * 也就是说「没网就完全不动」。v6 是挂机玩法，把自己绑在这条链路上等于
 * 联不上服务器就彻底不推进，这是不可接受的。
 *
 * 因此 v6 自带 setInterval 驱动，与旧主循环【并行】：
 *   · 旧链路正常 → 两边都调 tick6，靠 lastTick 差值去重，不会双重加速
 *     （tick6 用「距上次 tick 的真实毫秒数」，谁先调到就消耗这段时间）
 *   · 旧链路被门禁卡住 → v6 照常推进，游戏至少是活的
 *
 * 用 setInterval 而非 rAF：页面隐藏时 rAF 会被浏览器冻结，而挂机游戏
 * 恰恰要求后台也在跑（甚至要比前台更积极，因为要记离线）。
 */
export function startDriver() {
  if (typeof window === 'undefined') return;      // Node 测试环境跳过
  if (_timer) return;
  _timer = setInterval(function () { try { tick6(); } catch (e) { /* 单次异常不打断驱动 */ } }, DRIVE_MS);
}

/** 停止自驱动（测试/调试用） */
export function stopDriver() {
  if (_timer) { clearInterval(_timer); _timer = 0; }
}

/** 是否有 v6 状态（供外部判断是否已初始化） */
export function isReady() { return !!S6; }

/* ─────────────────────────────────────────────────────────────
 *  主循环（由外层 rAF/interval 调用）
 * ───────────────────────────────────────────────────────────── */

/**
 * 推进并渲染。
 * @param {number} [now] 当前时间戳（默认 Date.now()）
 * @returns {{advanced:number, stuck:boolean}|null}
 */
export function tick6(now) {
  if (!S6) return null;
  now = now || Date.now();
  const prev = S6.lastTick || now;
  let dt = (now - prev) / 1000;
  S6.lastTick = now;

  /* 切后台/掉帧保护：单次最多按 MAX_TICK_MS 推进，
   * 更长的空白交给「离线结算」处理（避免在线 tick 一次性跳过大量关卡） */
  if (!isFinite(dt) || dt < 0) dt = 0;
  if (dt * 1000 > MAX_TICK_MS) dt = MAX_TICK_MS / 1000;
  if (dt <= 0) return null;

  const before = S6.stage;
  const res = V.tickV6(S6, dt);
  if (S6.stage > before) V.grantSpirit(S6, before, S6.stage);

  if (now - lastRender >= RENDER_MS) {
    lastRender = now;
    render6();
  }
  return res;
}

/* ─────────────────────────────────────────────────────────────
 *  渲染
 * ───────────────────────────────────────────────────────────── */

function el(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

function setText(id, txt) {
  const e = el(id);
  if (e && e.textContent !== txt) e.textContent = txt;
}

/**
 * 全量渲染（可强制）。
 * @param {boolean} force 强制刷新（忽略节流）
 */
export function render6(force) {
  if (!S6) return;
  const st = V.stageText(S6);

  /* ── 关卡条 ── */
  setText('sbStage', String(st.stage));
  setText('sbMob', st.mobName);
  setText('sbBest', String(st.best));

  /* ── 灵石（复用旧 HUD 的 #spirit 节点，避免两个数字打架）── */
  const spiritTxt = N.fmt(S6.spirit);
  setText('spirit', spiritTxt);
  setText('battleSpirit', spiritTxt);

  /* ── 4 个升级按钮（v7.6c: 按钮只显示等级, 槽名在按钮上方小字, 费用靠 no/ready 变色表达）── */
  for (const slot of E.SLOTS) {
    const info = V.slotText(S6, slot.key);
    const cap = slot.key.charAt(0).toUpperCase() + slot.key.slice(1);
    setText('lv' + cap, info.maxed ? 'MAX' : 'Lv ' + info.lv);
    const btn = el('up' + cap);
    if (btn) {
      btn.classList.toggle('max', info.maxed);
      btn.classList.toggle('no', !info.maxed && !info.afford);
      btn.classList.toggle('ready', !info.maxed && info.afford);
    }
  }

  /* ── 重生按钮（聚灵阵图标皮肤, #abRebirth）── */
  const rb = V.rebirthText(S6);
  setText('rbGain', rb.gainText + ' 修为点');
  const rbtn = el('abRebirth');
  if (rbtn) {
    rbtn.classList.toggle('off', !rb.can);
    rbtn.classList.toggle('hot', rb.can && st.stuck);
  }

  /* ── 突破状态提示（自动突破, 非操作按钮, #abBreak / #brkHint）──
   * 转生 ≠ 突破: 是否破境在转生时自动结算, 这里只提示下一次重生会不会破境。 */
  const brk = el('abBreak');
  if (brk) {
    if (rb.willBreak) {
      setText('brkHint', '破境 → ' + rb.realmNextName);
      brk.classList.add('hot');
    } else {
      setText('brkHint', '还差 ' + rb.toNextText);
      brk.classList.remove('hot');
    }
  }

  /* ── 战斗 HUD 的倍速显示（旧节点，复用）──
   * v7.1：把宠物跳关也挂在同一行，两者同属「Buff 宠物」给的永久资产，
   * 玩家看到的是一句话：「×3.5 倍速 ／ 跳 2」= 第三乘区已开到 ×3。 */
  const spd = el('battleSpeed');
  if (spd) {
    const sk = V.normV6(S6).skip || 0;
    const on = S6.gameSpeed > 1 || sk > 0;
    spd.style.display = on ? '' : 'none';
    if (on) {
      const parts = [];
      if (S6.gameSpeed > 1) parts.push('×' + (+S6.gameSpeed.toFixed(2)) + ' 倍速');
      if (sk > 0) parts.push('跳 ' + sk + ' 关');
      setText('battleSpeed', parts.join(' ／ '));
    }
  }

  /* ── 战斗状态文案 ── */
  const bs = el('battleState');
  if (bs) {
    const txt = st.stuck ? '推不动了' : '推进中';
    if (bs.textContent !== txt) bs.textContent = txt;
  }

  /* ⚠️ v7.9（用户明确要求，勿恢复）：这里原本每帧刷新资源栏上的「修为 X/秒」。
   *   删掉的理由不是排版，而是【这个数压根不存在】——
   *   修为只在转生结算时按本轮最高关一次性入账（见 previewRebirth），
   *   在线过程中任何"每秒多少修为"都是拿当前速率去外插出来的假读数，
   *   玩家据此判断「该继续推还是该转生」必然是错的。
   *   修为收益的唯一出口是转生面板。
   *   #rateText 节点也已在 index.html 中一并删除。 */
}

/* ─────────────────────────────────────────────────────────────
 *  事件：升级
 * ───────────────────────────────────────────────────────────── */

/** 点击某一格的升级按钮 */
export function upEquip(key) {
  if (!S6) return;
  const r = V.upgradeSlot(S6, key, STEPS[key] || 1);
  render6(true);
  if (!r.ok) {
    const msg = r.reason === 'not_enough' ? '灵石不足'
      : r.reason === 'max_level' ? '已满级'
        : '无法升级';
    toast(msg);
  }
}

/** 设置某装备槽的升级档位（每槽独立下拉, ×1/×10/×100/×1000/×1万） */
export function setStep(key, val) {
  const n = parseInt(val, 10);
  STEPS[key] = n > 0 ? n : 1;
}

/** 取当前档位（调试/测试用；不传 key 返回整表） */
export function getStep(key) { return key ? (STEPS[key] || 1) : STEPS; }

/* ─────────────────────────────────────────────────────────────
 *  事件：转生
 * ───────────────────────────────────────────────────────────── */

/** 点击「转世重开」→ 弹结算面板 */
export function doRebirthUI() {
  if (!S6) return;
  const rb = V.rebirthText(S6);
  if (!rb.can) { toast('先推几关再转生'); return; }

  setText('rbMax', String(rb.maxStage));
  setText('rbPts', N.fmt(S6.totalPoints));
  setText('rbNew', rb.gainText);
  /* ⚠️ 境界用可读名（「炼气三层」），不要显示裸数字。
   *    转生 ≠ 突破：多数轮次只攒修为不跨境，所以文案要分两种。 */
  setText('rbRealm', rb.realmNowName);
  setText('rbRealmN', rb.willBreak ? rb.realmNextName + '（+' + rb.realmGain + '）' : rb.realmText);

  const p = el('rbPanel');
  if (p) p.classList.add('on');
}

/** 关闭结算面板 */
export function closeRebirth() {
  const p = el('rbPanel');
  if (p) p.classList.remove('on');
}

/** 确认转生 */
export function confirmRebirth() {
  if (!S6) return;
  const before = V.previewRebirth(S6).realmNowName;
  const r = V.applyRebirth(S6);
  closeRebirth();
  mirrorRealmToLegacy();
  render6(true);
  const nowName = RM.nameOf(r.realm);
  toast(r.realmGain > 0
    ? '突破！' + before + ' → ' + nowName
    : '转生：仍是 ' + nowName + '，修为已累计',
    r.realmGain > 0 ? 4200 : 3000);
}

/* ─────────────────────────────────────────────────────────────
 *  v8.1 死亡面板: 玩家被怪打死 → 冻结一切, 「转生 / 从头开始」二选一
 * ───────────────────────────────────────────────────────────── */

/** 战斗层死亡回调 → 冻结 v6 驱动(修为/关卡/灵石全停) + 弹面板 */
function showDeathPanel() {
  stopDriver();
  const p = el('deathPanel');
  if (p) p.classList.add('on');
}

/** 恢复: 时间基准重置(暂停时长不计入推进) → 重启驱动 → 战斗回满血重刷并解冻 */
function resumeFromDeath() {
  if (S6) S6.lastTick = Date.now();
  startDriver();
  const BA = (typeof window !== 'undefined') && window.BattleAPI;
  if (BA && typeof BA.respawn === 'function') BA.respawn();
}

/** 死亡面板·转生: 直接结算(修为点/境界/清装备灵石), 回【起始关】(v7.1: 最高关−1500) */
export function deathChooseRebirth() {
  const p = el('deathPanel');
  if (p) p.classList.remove('on');
  if (S6) {
    const before = V.previewRebirth(S6).realmNowName;
    const r = V.applyRebirth(S6);
    mirrorRealmToLegacy();
    render6(true);
    const nowName = RM.nameOf(r.realm);
    toast(r.realmGain > 0
      ? '转生突破！' + before + ' → ' + nowName
      : '转生：仍是 ' + nowName + '，修为已累计', 4200);
  }
  resumeFromDeath();
}

/**
 * 死亡面板·从头开始: 修为/境界/装备保留, 把关卡拉回【起始关】。
 *
 * ⚠️ v7.1：这里不能再写死 stage=1 —— 那会让「从头开始」在新中后期变成
 *    一次 12 分钟的纯重复劳动，正是起始关机制要消灭的东西。
 *    拉回起始关（历史最高关 − 1500）才是设计意图。
 */
export function deathChooseRestart() {
  const p = el('deathPanel');
  if (p) p.classList.remove('on');
  if (S6) { S6.stage = R.startStageFor(V.normV6(S6).bestStage); S6.carry = 0; render6(true); }
  toast('回到起始关', 2400);
  resumeFromDeath();
}

/** 等动态加载的 BattleAPI 就绪后注册死亡回调(40-app bindBattleHooks 同款轮询) */
function bindDeathHook(attempt) {
  if (typeof window === 'undefined') return;
  const BA = window.BattleAPI;
  if (BA && typeof BA.onPlayerDeath === 'function') { BA.onPlayerDeath(showDeathPanel); return; }
  if ((attempt || 0) > 50) return;
  setTimeout(function () { bindDeathHook((attempt || 0) + 1); }, 200);
}

/**
 * v6 阶段5: 把 v6 的境界镜像进 legacy 的 state.realmIdx。
 *
 * 为什么需要：
 *   用户要求「主线（剧情/修行录）跟境界挂钩」。主线的推进逻辑（40-app.js realmPlot /
 *   30-systems.js mainMoment / renderStory）都是按 state.realmIdx 取 BIGS/PLOT 下标，
 *   而 v6 的境界存在 S6.realm，两者【完全独立、互不同步】。
 *   这里做单向镜像：v6 是境界的唯一权威，legacy 侧只读跟随。
 *
 * 为什么用注入槽而不是直接 import：
 *   06-v6ui 位于依赖图最下游，legacy 侧（20-core/30-systems/40-app）在它上游。
 *   由 main.js 在启动时把 setter 注进来（同 bindV6Save 的思路），依赖方向保持单向。
 */
let _setLegacyRealm = null;
/** 由 main.js 注入 legacy 境界写入器 */
export function bindLegacyRealm(fn) {
  _setLegacyRealm = typeof fn === 'function' ? fn : null;
}
function mirrorRealmToLegacy() {
  if (_setLegacyRealm && S6) { try { _setLegacyRealm(S6.realm | 0); } catch (e) {} }
}

/** 转生/读档后调用一次，保证主线与 v6 境界对齐 */
export function syncRealmMirror() { mirrorRealmToLegacy(); }

/* ─────────────────────────────────────────────────────────────
 *  离线结算
 * ───────────────────────────────────────────────────────────── */

/**
 * 执行离线结算并展示结果。
 *
 * ⚠️ 展示口径必须是【玩家能感知的净收益】，不能报 stages。
 *   stages 是「每轮推进量的累加」，转生后关卡归 1，前一世推的关要重推，
 *   所以 24 小时挂机能累出 43 万关（全图才 30000 关），数字荒谬且无意义。
 *   玩家真正关心的是：境界涨了几层 / 最远推到过第几关 / 自动转生了几次。
 *
 * @param {number} seconds 离线秒数
 * @returns {object} 结算结果
 */
export function settleOffline6(seconds) {
  if (!S6) return null;
  const r = V.settleOffline(S6, seconds);
  render6(true);
  if (r.rounds > 0 || r.realmGain > 0 || r.stages > 0) {
    const mins = Math.floor(seconds / 60);
    const dur = mins >= 60
      ? Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分'
      : mins + ' 分钟';
    const parts = ['离线 ' + dur];
    parts.push('自动转世 ' + r.rounds + ' 次');
    if (r.realmGain > 0) {
      parts.push('境界 ' + RM.nameOf(r.realmFrom) + ' → ' + RM.nameOf(r.realmTo) + '（+' + r.realmGain + '）');
    } else {
      parts.push('境界仍是 ' + RM.nameOf(r.realmTo));
    }
    if (r.stages > 0) parts.push('最远推到第 ' + r.roundStage + ' 关');
    toast(parts.join('，'), 5200);
  }
  return r;
}

/* ─────────────────────────────────────────────────────────────
 *  轻提示（复用旧系统若有）
 * ───────────────────────────────────────────────────────────── */

function toast(msg, ms) {
  if (typeof window !== 'undefined' && typeof window.pushMsg === 'function') {
    try { window.pushMsg(msg); return; } catch (e) { /* 落到下面的兜底 */ }
  }
  /* 兜底：复用战斗 HUD 的 #battleState 短暂显示 */
  const e = el('battleState');
  if (!e) return;
  const old = e.textContent;
  e.textContent = msg;
  setTimeout(function () { if (e.textContent === msg) e.textContent = old; }, ms || 2400);
}

/* ─────────────────────────────────────────────────────────────
 *  存档
 * ───────────────────────────────────────────────────────────── */

/** 把 v6 状态写回旧 state（供 save() 一并落盘） */
export function saveV6() {
  if (!S6) return;
  V.toLegacy(typeof window !== 'undefined' ? window.state : null, S6);
}

/**
 * 从旧 state 载入 v6 状态（读档后调用）。
 * 读档后必须重置 lastTick，否则会把「关掉页面的这段时间」当成在线 tick。
 */
export function loadV6(legacy) {
  S6 = V.fromLegacy(legacy || (typeof window !== 'undefined' ? window.state : null));
  S6.lastTick = Date.now();
  render6(true);
  return S6;
}

/** 测试/调试：直接替换状态 */
export function _set6(s) { S6 = s; }
