/**
 * 玩法系统（云游/丹房/装备/巡猎/里程碑/心跳）
 *
 * 拓扑层 L5~L7，34 个顶层声明。
 * 由 tools/split2.js 从 game.js 自动切分（纯搬迁，语句源码逐字保留，逻辑零改动）。
 * 重建: node tools/split2.js <repo> <out>
 */
import { $, AURA_COLORS, AURA_FPS, MAIN_STORY, PLOT, SKILL_DEFS, __set_settling, _dsp, _floatPrev, _settling, cld, state } from './00-pure.js';
import { __set_auraAcc, __set_auraT, _auraAcc, _auraColor, _auraCtx, _auraP, _auraT, cldUI, pickNoRepeat, pushMsg } from './10-base.js';
import { _cloudSettleRun, bigIdx, realm, renderSkills, showChapter, skillVal } from './20-core.js';

async function cldPush() {
  /* v1.8.0: 服务端只有一种写操作 —— 结算。
   * 普通 PUT 会推进结算锚却不发那段时间的收益, 等于把那段收益吃掉;
   * 所以"上传进度"也一律走 settle: 结算本身就是最好的上传。 */
  const r = await cloudSettle();
  return !!r;
}

function cloudPushNow() {
  if (!window.fetch) return;
  if (!cld.ready) { cld.dirty = true; return; }   // 尚未完成首次同步, 先标记等 pull 后再传
  cldUI("sync");
  cldPush().then(ok => { if (ok) { cld.dirty = false; cldUI("on"); } });   // v2.5: 上传成功清脏, 避免周期兜底反复空传
}

function updateHUD() {
  /* ⚠️ v6 阶段5: 旧系统 HUD 全部下线。
   *   旧元素(#arrNum/#brkNum/#arrayLv/#btnBreak/.actions 聚灵阵+突破按钮)已在 a70db3e 的
   *   §9 清理中从 index.html 删除, 而 #arrFill/#btnArray 也已不存在 —— 那些分支永远是死代码。
   *
   *   ⚠️ #spirit 也【不再由本函数写】：灵石已归 v6 管（大数对象 {m,e}），
   *   由 06-v6ui.js 用 N.fmt(S6.spirit) 统一刷新。此前两边都写同一个节点，
   *   旧侧喂的是缓动值 _dsp.spirit（追的是 legacy state.spirit，类型/节奏都跟不上 v6），
   *   实测显示会在真实数字与 "∞" 之间来回跳。
   *
   *   ⚠️ #rateText（修为/秒）已在 v7.9 连同 DOM 节点一起删除，本函数不再有机会写它。
   *   保留这条注释是为了防止有人照旧代码把它装回来：修为收益只有转生结算才成立，
   *   在线秒数任何时候都是凭空外插。修为的唯一出口是转生面板。
   *
   *   现在本函数只剩：把缓动基准同步到 state，供 _dsp 的平滑逻辑使用。 */
  _floatPrev.spirit = state.spirit;
  _floatPrev.exp = state.exp;
}

function openStory() {
  const m = $("storyModal");
  if (!m) return;
  renderStory();
  m.classList.add("show");
}

function renderStory() {
  const body = $("storyBody");
  const chips = $("storyChips");
  if (!body || !chips) return;
  const bi = Math.min(bigIdx(), PLOT.length - 1);
  const walked = PLOT.slice(0, bi + 1).map(x => x[0].big).join(" → ");
  let sum = $("storySum");
  if (!sum) {
    sum = document.createElement("div");
    sum.className = "story-sum"; sum.id = "storySum";
    chips.parentNode.insertBefore(sum, chips);
  }
  sum.innerHTML = `已历仙途：<b>${walked}</b>` +
    (state.realmIdx >= TOTAL_SEGS - 1 ? "（仙途漫漫 · 已臻极巅）" : "");
  // 只显示有记载的大境章
  const order = PLOT.slice(0, bi + 1).map(v => v[0].big);
  const journalSet = new Set(state.journal.map(j => j.big));
  const chapters = order.filter(b => journalSet.has(b));
  chips.innerHTML = "";
  if (!chapters.length) {
    body.innerHTML = `<div class="empty-hint">尚无记载。<br>仙途伊始，一切从你打坐感应灵气开始。</div>`;
    return;
  }
  chapters.forEach(name => {
    const c = document.createElement("div");
    c.className = "chip";
    c.textContent = name;
    c.onclick = () => showChapter(name);
    chips.appendChild(c);
  });
  // 默认打开当前大境章, 否则最后一章
  const last = state.journal[state.journal.length - 1];
  showChapter(chapters.includes(realm().big) ? realm().big : (last && last.big) || chapters[0]);
}

function auraColorNow() { return AURA_COLORS[Math.min(bigIdx(), AURA_COLORS.length - 1)]; }

/* 灵气粒子层。
 *   tickAura(dt)                    —— 独立模式：画到 #aura 自己的 canvas
 *   tickAura(dt, { ctx, W, H })     —— 舞台模式（v3.2）：画到统一舞台的 ctx，尺寸由舞台给
 *
 * 两种模式共用同一套粒子状态与时序；区别只在"画到哪、按谁的尺寸算"。
 * ⚠️ dt 一律是【原始 dt】，本层不吃身法倍速。 */
function tickAura(dt, target) {
  const tctx = target && target.ctx ? target.ctx : _auraCtx;
  if (!tctx) return;
  __set_auraAcc(_auraAcc + (dt));
  if (_auraAcc < 1 / AURA_FPS) return;          // 限帧 30fps: 不足一帧间隔直接跳过(粒子位置用累计 realDt 补偿, 不丢物理)
  const realDt = _auraAcc; __set_auraAcc(0);
  __set_auraT(_auraT + (realDt));
  const W = (target && target.W) || innerWidth;
  const H = (target && target.H) || innerHeight;
  const c = auraColorNow();
  for (let i = 0; i < 3; i++) _auraColor[i] += (c[i] - _auraColor[i]) * Math.min(1, realDt * 1.5);
  const [r,g,b] = _auraColor.map(v => Math.round(v));
  if (target) {
    /* 舞台模式：不清屏 —— 背景/战斗已经画在同一块画布上，clearRect 会把它们抹掉。
     * 直接叠加绘制，退出时统一复位混合模式。 */
  } else {
    tctx.clearRect(0, 0, W, H);
  }
  /* 【合并后最关键的一处】原先本层靠 CSS mix-blend-mode:screen 与下层做「滤色」，
   * 那是画布级合成 —— 效果是 `1-(1-a)(1-b)`，永远比原色【更亮】、不会变浓。
   *
   * 合并成一张画布后，混合必须在绘制期完成。这里必须用 'screen' 而不是 'lighter'：
   *   lighter (加法)  a+b      —— 叠得越多越"曝"，大面积会糊成一片
   *   screen  (滤色)  1-(1-a)(1-b) —— 与 CSS 的 screen 语义一致，柔和不糊
   *
   * ⚠️ v3.2 首版这里用了 'lighter' 并配了 1.75× 的 alpha 补偿，是错的：
   *    绿色（凡人境灵气色 103,201,171）在加法混合下会盖住背景与纸月，
   *    表现为"几处大区域不停闪烁的绿光"。改回 screen 后不再需要任何补偿。 */
  tctx.globalCompositeOperation = "screen";
  const blobs = [[.25,.3,.5],[.7,.25,.42],[.5,.7,.55],[.82,.72,.4]];
  for (let i = 0; i < blobs.length; i++) {
    const [bx,by,bz] = blobs[i];
    const cx = (bx + Math.sin(_auraT*0.06 + i)*0.05)*W, cy = (by + Math.cos(_auraT*0.05 + i*1.3)*0.05)*H, rad = bz*Math.min(W,H)*0.6;
    const grd = tctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grd.addColorStop(0, `rgba(${r},${g},${b},.07)`); grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    tctx.fillStyle = grd; tctx.beginPath(); tctx.arc(cx, cy, rad, 0, 7); tctx.fill();
  }
  for (const p of _auraP) {
    p.y -= p.s*realDt; p.x += Math.sin(_auraT*0.6 + p.ph)*6*realDt;
    if (p.y < -10) { p.y = H + 10; p.x = Math.random()*W; }
    const a = p.a * (0.5 + 0.5*Math.sin(_auraT*1.2 + p.ph));
    tctx.fillStyle = `rgba(${r},${g},${b},${a*0.5})`;
    tctx.beginPath(); tctx.arc(p.x, p.y, p.r, 0, 7); tctx.fill();
  }
  tctx.globalCompositeOperation = "source-over";
}

function mainMoment() {
  /* ⚠️ v6 阶段5: 主线剧情保留（用户要求：主线跟境界挂钩），但不再发修为。
   *   修为/境界已由 v6 推关驱动，旧 state.exp 不再是成长来源 ——
   *   这里只负责把大境界对应的主线文案推给玩家，纯叙事，无副作用。 */
  const bi = Math.min(bigIdx(), MAIN_STORY.length - 1);
  const pool = MAIN_STORY[bi];
  if (!pool || !pool.length) return;
  pushMsg("main", `<span class="b">主线</span>｜${pickNoRepeat(pool, "m" + bi)}`);
}

async function cloudSettle() {
  if (!window.fetch || !cld.id || _settling) return null;
  __set_settling(true);
  try { return await _cloudSettleRun(); } finally { __set_settling(false); }
}



function skillAddExpAll(n) { /* ⚠️ v6: 技能恒定无经验 —— 保留空函数只为兼容旧调用点不报错 */ }

/* ⚠️ v6 契约变更（战斗层 50-battle.js 直接消费）：
 *   · 技能【无等级】—— 删掉 max / lv / exp / addExp / addExpAll / total，因为恒定值没有成长轴。
 *   · val(id) 返回 SKILL_DEFS 里的常量对象，字段随 kind 而异：
 *       kind:"damage" → { chance, dmg[, pen|n|crit|threshold] }  —— 攻击时按概率触发
 *       kind:"buff"   → { cd, dur, dodge, hasted }               —— 按 CD 独立触发（不是攻击触发）
 *   · 技能不入存档：恒定值没有存的必要。 */
window.SkillAPI = { defs: SKILL_DEFS, val: skillVal };

function openSkills() {
  renderSkills();
  const m = $("skillModal"); if (m) m.classList.add("show");
}

window.openSkills = openSkills;

export {
  auraColorNow,
  cldPush,
  cloudPushNow,
  cloudSettle,
  mainMoment,
  openSkills,
  openStory,
  renderStory,
  skillAddExpAll,
  tickAura,
  updateHUD,
};
