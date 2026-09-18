/**
 * src/00-stage.js —— 关卡系统（重构版 v6）
 *
 * ── 职责 ──────────────────────────────────────────────────────────
 * 用公式生成 30000 关的怪物数据，替代旧版 MOB_POOLS 手填表。
 * 所有数值以「设计文档《重构设计文档.md》」为唯一权威。
 *
 * ── 核心公式（设计文档 §3.1）─────────────────────────────────────
 *   H(s) = g^s · H₀
 *   g  = 1.006      怪每关 ×1.006
 *   H₀ = 10         第 1 关怪血量
 *   s  ∈ [1, 30000]
 *
 *   → 第 30000 关怪强度 ≈ 1e77.9（故本文件所有数值走大数层）
 *
 * ── 怪物资源绑定 ──────────────────────────────────────────────────
 * 关数远多于怪物资源（80 个骨骼怪 / 30000 关），因此按「循环轮换」绑定：
 *   第 s 关使用 怪物列表[(s-1) % 80]
 * 这让每只怪在不同关卡反复出现，但数值由关卡决定（同一只怪在 100 关
 * 和 20000 关的强度天差地别）。这是需求方「80 个怪铺开几千关」的落地方式。
 */

import * as N from './00-num.js';

/* ─────────────────────────────────────────────────────────────
 *  参数（唯一权威，勿在别处复制）
 * ───────────────────────────────────────────────────────────── */
export const STAGE_CFG = {
  S_MAX: 30000,        // 关卡总数
  G: 1.006,            // 怪每关增长率

  /* 第 1 关怪血量。
   *
   * ⚠️ 标定依据（勿随意改）：
   *   设计文档 §6 的目标是「第 1 轮玩家推到 385 关左右」。
   *   由 H(s) = H0·g^(s-1)，玩家初始面板 BASE0 = 10：
   *     s = 1 + log(BASE0/H0) / log(g)   （见 maxStageFor）
   *   反解 H0 = BASE0 / g^(s-1)：
   *     目标 s=385 → H0 = 10 / 1.006^384 ≈ 1.0055
   *
   *   实测校验（H0=1.0055 时）：
   *     s = 1 + log(10/1.0055)/log(1.006) ≈ 385 ✓
   *
   *   ⚠️ 注意 maxStageFor 用的是 (s-1) 偏移（与 stageHp 的 g^(s-1) 对齐），
   *   标定时务必按同一条公式反解，否则会差出一整个对数周期
   *   （曾误取 H0=0.1，导致第 1 轮推出 770 关，实测已复现）。 */
  H0: 1.0055,
  A0: undefined,       // 见下方派生

  /* 攻防比：怪的攻击 / 血量 */
  ATK_RATIO: 1.0,

  /* 怪的攻速（次/秒）—— 用于玩家生存判定，不参与推关速率（约束2） */
  MOB_ASPD: 1.0,
};

/* A0 由 H0 派生（保持攻血同比例成长） */
STAGE_CFG.A0 = STAGE_CFG.H0 * STAGE_CFG.ATK_RATIO;

const LOG10_G = Math.log10(STAGE_CFG.G);

/* ─────────────────────────────────────────────────────────────
 *  关卡数值（大数）
 * ───────────────────────────────────────────────────────────── */

/**
 * 第 s 关怪的血量（大数）
 * H(s) = H₀ · g^(s-1)
 */
export function stageHp(s) {
  const k = Math.max(0, Math.floor(s) - 1);
  return N.mulNum(N.pow(N.from(STAGE_CFG.G), k), STAGE_CFG.H0);
}

/** 第 s 关怪的攻击（大数） */
export function stageAtk(s) {
  const k = Math.max(0, Math.floor(s) - 1);
  return N.mulNum(
    N.pow(N.from(STAGE_CFG.G), k),
    STAGE_CFG.H0 * STAGE_CFG.ATK_RATIO
  );
}

/* ─────────────────────────────────────────────────────────────
 *  反解：玩家强度 → 能推到第几关
 * ───────────────────────────────────────────────────────────── */

/**
 * 给定玩家面板 P，返回能推到的最高关卡（连续解）。
 *
 *   P ≥ H₀ · g^(s-1)   →   s ≤ 1 + log(P/H₀) / log(g)
 *
 * @param {object} P 玩家面板（大数）
 * @returns {number} 关卡序号（未取整，调用方自行 floor）
 */
export function maxStageFor(P) {
  if (N.isZero(P)) return 0;
  const ratio = N.div(P, N.from(STAGE_CFG.H0));
  const l = N.log10(ratio);
  if (l === -Infinity) return 0;
  return 1 + l / LOG10_G;
}

/**
 * 给定玩家面板，判断能否通过第 s 关。
 * @returns {boolean}
 */
export function canClear(P, s) {
  if (s > STAGE_CFG.S_MAX) return false;
  return N.gte(P, stageHp(s));
}

/* ─────────────────────────────────────────────────────────────
 *  怪物资源绑定
 * ───────────────────────────────────────────────────────────── */

/** 骨骼怪清单（与 assets/db/monsters/ 目录一致，去掉 index.json） */
export const MOB_SLUGS = [
  'ancient_automaton', 'animated_drill_dwarf', 'arcane_golem', 'axe_goblin', 'bee',
  'black_ant_queen', 'bonemask_shadow_creature', 'clockwork_king', 'clockwork_skull',
  'colossal_crow', 'continental_turtle_rukkha', 'crab_king_karkinos', 'cultist_mage',
  'dagger_goblin', 'daidarabotchi', 'darkness_titan_ilnoct', 'dark_queen_shaccadyoggoth',
  'dragon_huanglong', 'dryad_queen_rafflesia', 'dryad_yggdrasil', 'eldritch_overmind',
  'forest_turtle', 'fox', 'ghost', 'giant_kitsune', 'goblin_machine_gun',
  'goddess_aphrodite', 'god_warrior_dagon', 'god_warrior_isis', 'god_warrior_osiris',
  'god_warrior_skoll', 'grand_sorceress_duesa', 'gun_mimic', 'hades', 'hellhound_garm',
  'ice_titan_demeres', 'insect_queen', 'jiangshi', 'jubokko', 'king_archial',
  'legendary_knight_michael', 'legendary_knight_regulus', 'legendary_knight_remment',
  'librarium_animated_legendary_knight_pizarro', 'librarium_animated_mechadragon_ladon',
  'librarium_animated_skull_knight_xoer', 'light_titan_alfadriel', 'living_armor',
  'living_hoard_midas', 'mageshroom', 'magical_girl_goblin', 'mecha_rattlesnake',
  'mechascorpion', 'mermaid_warrior_undeen', 'mimic', 'mythical_knight_goldnharl',
  'parrot_king', 'poseidon', 'radulac_the_voidvod', 'runic_stone_golem_goliath',
  'scorpion', 'sea_calamity_urmica', 'sea_dragon_leviathan', 'shaccadyoggoth',
  'slime_flynn', 'son_of_valhalla', 'spirit_fighter', 'sun_goddess', 'sword_goblin',
  'tantalus', 'thanatos', 'the_fallen', 'the_horde', 'thunder_titan_dynamo',
  'unicorn', 'witch_baba', 'wolf', 'zeograth', 'zodiac_cancer',
];

/** 第 s 关使用的怪物 slug（循环轮换） */
export function mobFor(s) {
  const i = (Math.max(1, Math.floor(s)) - 1) % MOB_SLUGS.length;
  return MOB_SLUGS[i];
}

/* ─────────────────────────────────────────────────────────────
 *  关卡数据结构（渲染/战斗用）
 * ───────────────────────────────────────────────────────────── */

/**
 * 取第 s 关的完整描述。
 * @param {number} s
 * @returns {{stage:number, slug:string, hp:object, atk:object, isBoss:boolean}}
 */
export function stageInfo(s) {
  s = Math.max(1, Math.min(STAGE_CFG.S_MAX, Math.floor(s)));
  return {
    stage: s,
    slug: mobFor(s),
    hp: stageHp(s),
    atk: stageAtk(s),
    isBoss: false,          // 设计文档 §1：不要 BOSS
  };
}

/* ─────────────────────────────────────────────────────────────
 *  便捷：关卡进度描述
 * ───────────────────────────────────────────────────────────── */

/** 关卡区间（用于 UI 显示「第 1 / 30000 关」） */
export function stageLabel(s) {
  return `第 ${Math.floor(s)} / ${STAGE_CFG.S_MAX} 关`;
}

/** 是否已通关全图 */
export function isCleared(s) {
  return s >= STAGE_CFG.S_MAX;
}
