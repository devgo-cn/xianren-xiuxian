/**
 * src/00-num.js —— 大数层（重构版 v6）
 *
 * ── 为什么需要这一层 ────────────────────────────────────────────────
 * 设计文档《重构设计文档.md》§4 约束 3 明确指出：
 *   第 30000 关怪强度 = 1.006^30000 ≈ 1e77.9
 *   → 数值必须支持到 1e80 量级
 *
 * JS Number 的最大安全整数是 2^53-1 ≈ 9e15，超出后精度丢失。
 * 1e79 虽然仍在 Number 的表示范围内（最大约 1.8e308），但：
 *   · 1e79 + 1 === 1e79        （小数部分完全丢失）
 *   · 无法做精确的「+1 级装备」这类小增量运算
 *
 * 因此本层用「尾数 + 指数」的浮点结构（mantissa × 10^exp）自建大数，
 * 保证：加法不丢量级、乘法精确到 15 位有效数字、支持比较与格式化。
 *
 * ── 设计取舍 ──────────────────────────────────────────────────────
 * · 不做任意精度整数（不需要，游戏数值都是浮点量级）
 * · 尾数归一化到 [1, 10)，指数为整数
 * · 0 用 {m:0, e:0} 表示，特殊处理避免除零
 * · 与原生 Number 可自由互转（toNumber / from）
 */

const LOG10 = Math.log10;
const LOG10E = Math.log10(Math.E);

/** 大数结构：{ m: 尾数 ∈ [1,10) 或 0, e: 指数(整数) } */
export const ZERO = Object.freeze({ m: 0, e: 0 });
export const ONE = Object.freeze({ m: 1, e: 0 });

/* ─────────────────────────────────────────────────────────────
 *  构造
 * ───────────────────────────────────────────────────────────── */

/** 归一化：把任意 {m,e} 调整为 m∈[1,10) */
export function norm(m, e) {
  if (!isFinite(m) || m === 0) return { m: 0, e: 0 };
  if (!isFinite(e)) return { m: m > 0 ? Infinity : -Infinity, e: 0 };
  const sign = m < 0 ? -1 : 1;
  m = Math.abs(m);
  /* ⚠️ 不要用 Math.log10 提取指数：log10(1000) === 2.9999999999999996，
   * 会让 m 落到 [10,11) 区间；且 1e39 这类字面量本身就是 9.999999999999998e38。
   * 改用「先缩放再循环微调」，只用乘除与比较，无浮点对数误差。 */
  if (m >= 1 && m < 10) {
    /* 已在目标区间，仅需 e 为整数 */
    e = Math.round(e);
  } else {
    /* 用 Math.abs(m) 的十进制位数粗调，再靠两个 while 收敛 */
    const shift = Math.floor(Math.log10(m));
    m /= Math.pow(10, shift);
    e += shift;
  }
  while (m >= 10) { m /= 10; e += 1; }
  while (m < 1 && m > 0) { m *= 10; e -= 1; }
  /* 收敛后仍可能有 9.999999999999998 这类「差一个 ULP 到 10」的值：
   * 这类值在数学上等价于 10，会破坏归一化不变式，统一向上吸附。 */
  if (m > 9.9999999999) { m = 1; e += 1; }
  return { m: sign * m, e };
}

/** 从原生 Number 构造 */
export function from(x) {
  if (x === 0) return { m: 0, e: 0 };
  if (!isFinite(x)) return { m: x, e: 0 };
  return norm(x, 0);
}

/** 直接从尾数+指数构造 */
export function make(m, e) { return norm(m, e); }

/* ─────────────────────────────────────────────────────────────
 *  转换
 * ───────────────────────────────────────────────────────────── */

/** 转回原生 Number（可能精度丢失或溢出为 Infinity，仅用于小数值） */
export function toNumber(a) {
  if (!a) return 0;
  if (a.m === 0) return 0;
  return a.m * Math.pow(10, a.e);
}

/** 判断是否可用原生 Number 安全表示 */
export function isSmall(a) {
  return !a || a.m === 0 || Math.abs(a.e) < 15;
}

export function isZero(a) { return !a || a.m === 0; }
export function isNeg(a) { return !!a && a.m < 0; }
export function isPos(a) { return !!a && a.m > 0; }

/* ─────────────────────────────────────────────────────────────
 *  比较
 * ───────────────────────────────────────────────────────────── */

export function cmp(a, b) {
  const az = isZero(a), bz = isZero(b);
  if (az && bz) return 0;
  if (az) return isNeg(b) ? 1 : -1;
  if (bz) return isPos(a) ? 1 : -1;
  /* 异号 */
  if (isNeg(a) !== isNeg(b)) return isNeg(a) ? -1 : 1;
  const sign = isNeg(a) ? -1 : 1;
  if (a.e !== b.e) return (a.e > b.e ? 1 : -1) * sign;
  if (a.m !== b.m) return (a.m > b.m ? 1 : -1) * sign;
  return 0;
}

export const gt = (a, b) => cmp(a, b) > 0;
export const gte = (a, b) => cmp(a, b) >= 0;
export const lt = (a, b) => cmp(a, b) < 0;
export const lte = (a, b) => cmp(a, b) <= 0;
export const eq = (a, b) => cmp(a, b) === 0;

export function max(a, b) { return cmp(a, b) >= 0 ? a : b; }
export function min(a, b) { return cmp(a, b) <= 0 ? a : b; }

/* ─────────────────────────────────────────────────────────────
 *  四则运算
 * ───────────────────────────────────────────────────────────── */

/** 加法：a + b */
export function add(a, b) {
  if (isZero(a)) return { m: b.m, e: b.e };
  if (isZero(b)) return { m: a.m, e: a.e };
  /* 让 a 为量级较大者 */
  if (cmp(a, b) < 0) { const t = a; a = b; b = t; }
  const d = a.e - b.e;
  /* 相差超过 16 个数量级，小项完全淹没（Number 精度极限） */
  if (d > 16) return { m: a.m, e: a.e };
  const bScaled = b.m * Math.pow(10, -d);
  return norm(a.m + bScaled, a.e);
}

/** 减法：a - b */
export function sub(a, b) {
  return add(a, { m: -b.m, e: b.e });
}

/** 乘法：a × b */
export function mul(a, b) {
  if (isZero(a) || isZero(b)) return { m: 0, e: 0 };
  return norm(a.m * b.m, a.e + b.e);
}

/** 除法：a ÷ b */
export function div(a, b) {
  if (isZero(b)) return { m: Infinity, e: 0 };
  if (isZero(a)) return { m: 0, e: 0 };
  return norm(a.m / b.m, a.e - b.e);
}

/** 幂：a^p （p 为原生 Number） */
export function pow(a, p) {
  if (isZero(a)) return p === 0 ? { m: 1, e: 0 } : { m: 0, e: 0 };
  const logA = LOG10(Math.abs(a.m)) + a.e;      // log10(a)
  const logR = logA * p;
  const e = Math.floor(logR);
  const m = Math.pow(10, logR - e);
  if (a.m < 0 && Number.isInteger(p) && Math.abs(p % 2) === 1) return { m: -m, e };
  return { m, e };
}

/** a 的原生 Number 倍率：a × k */
export function mulNum(a, k) {
  if (k === 0 || isZero(a)) return { m: 0, e: 0 };
  if (!isFinite(k)) return { m: k, e: 0 };
  return norm(a.m * k, a.e);
}

/** a ÷ k */
export function divNum(a, k) { return mulNum(a, 1 / k); }

/* ─────────────────────────────────────────────────────────────
 *  对数（关卡推算的核心）
 * ───────────────────────────────────────────────────────────── */

/** log10(a) —— 返回原生 Number */
export function log10(a) {
  if (isZero(a) || isNeg(a)) return -Infinity;
  return LOG10(a.m) + a.e;
}

/** ln(a) */
export function ln(a) {
  const l = log10(a);
  return l === -Infinity ? -Infinity : l / LOG10E;
}

/* ─────────────────────────────────────────────────────────────
 *  格式化（科学计数显示）
 * ───────────────────────────────────────────────────────────── */

/**
 * 中文「万进位」大数单位。
 *
 * 每级 ×10⁴：万 → 亿 → 兆 → 京 → …… 这是中文母语玩家唯一不需要换算的读数方式
 * （"416万"是一眼可得的量级，"4.16e6"要心算两次），题材上也贴修行体系。
 *
 * ⚠️ v7.10：本表统一了全游戏的数字口径。此前存在两套互不兼容的实现——
 *   N.fmt 在 e≥6 直接吐 `4.16e6`，而 50-battle.js 的 fmtNum 却走 万/亿，
 *   于是同一个灵石数在两个位置显示成两个样子。现在两者都归到这张表。
 */
const CN_UNITS = [
  '万', '亿', '兆', '京', '垓', '秭', '穰', '沟', '涧', '正',
  '载', '极', '恒河沙', '阿僧祗', '那由他', '不可思议', '无量', '大数',
];

/**
 * 尾数定档：让读数既不挤成一坨也不拖着无意义的小数尾巴。
 *   ≥100 → 取整（"416万"）
 *   ≥10  → 一位小数（"41.6万"）
 *   <10  → 两位小数（"4.16万"）
 */
function trimMant(v) {
  const d = v >= 100 ? 0 : (v >= 10 ? 1 : 2);
  const s = v.toFixed(d);
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}

/**
 * 格式化为显示字符串
 *
 * 阈值策略（v7.10）：
 *   |x| < 1e4   → 直接数字（如 "3,250" / "1000"）
 *   1e4 及以上  → 中文万进单位（如 "416万" / "1.23恒河沙"）
 *   超出单位表  → 回退科学计数（正常玩法够不到，仅防御性兜底）
 *
 * @param {object} a 大数
 * @param {number} digits 有效数字位数（仅科学计数兜底用）
 */
export function fmt(a, digits = 3) {
  if (isZero(a)) return "0";
  if (!isFinite(a.m)) return a.m > 0 ? "∞" : "-∞";
  const sign = a.m < 0 ? "-" : "";
  const abs = Math.abs(a.m);

  /* ⚠️ 用 log10 判阈值而不是 i.e —— {m,e} 是否归一化并无保证，
   * 旧实现对 e===3 直接判「万」，导致 {m:1,e:3}(=1000) 被显示成 "1万"。 */
  const l10 = log10({ m: abs, e: a.e });
  if (!isFinite(l10)) return sign + String(abs);

  /* 一万以下：原样显示，保留到分 */
  if (l10 < 4) {
    const v = abs * Math.pow(10, a.e);
    return sign + String(Math.round(v * 100) / 100);
  }

  /* 中文单位：ui = 单位下标，每级覆盖 10⁴ */
  const ui = Math.floor(l10 / 4) - 1;
  if (ui >= 0 && ui < CN_UNITS.length) {
    return sign + trimMant(Math.pow(10, l10 - (ui + 1) * 4)) + CN_UNITS[ui];
  }
  /* 兜底：超出单位表时才科学计数 */
  return sign + trim(abs, digits) + "e" + a.e;
}

function trim(v, d = 3) {
  const s = v.toFixed(Math.max(0, d - 1));
  return s.replace(/\.?0+$/, "");
}

/** 精确量级字符串（调试用）：始终科学计数 */
export function sci(a, digits = 4) {
  if (isZero(a)) return "0";
  if (!isFinite(a.m)) return String(a.m);
  return (a.m < 0 ? "-" : "") + Math.abs(a.m).toFixed(digits - 1) + "e" + a.e;
}

/* ─────────────────────────────────────────────────────────────
 *  便捷导出：常量
 * ───────────────────────────────────────────────────────────── */

export const HUNDRED = { m: 1, e: 2 };
export const THOUSAND = { m: 1, e: 3 };
export const MILLION = { m: 1, e: 6 };
