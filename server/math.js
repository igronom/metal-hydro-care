/**
 * math.js — Математичний модуль MetalHydroCare
 *
 * Модель: одновимірна дифузія важких металів у донних відкладеннях
 * Рівняння: ∂C/∂t = D · ∂²C/∂z²
 * Аналітичний розв'язок: C(z,t) = C₀ · erfc( z / (2·√(D·t)) )
 *
 * Одиниці:
 *   z — глибина, см
 *   t — час, доби
 *   C — концентрація, мг/кг
 *   D — коефіцієнт дифузії, см²/доба
 */

'use strict';

// ─────────────────────────────────────────────
// 1. ДОПОМІЖНІ МАТЕМАТИЧНІ ФУНКЦІЇ
// ─────────────────────────────────────────────

/**
 * Функція помилок erfc(x) — наближення Абрамовіца і Стегана
 * Точність: |похибка| < 1.5·10⁻⁷
 */
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (
    0.254829592 + t * (
      -0.284496736 + t * (
        1.421413741 + t * (
          -1.453152027 + t * 1.061405429
        )
      )
    )
  );
  const result = poly * Math.exp(-x * x);
  return x >= 0 ? result : 2 - result;
}

/**
 * Теоретична концентрація за моделлю дифузії
 * @param {number} C0  — нормована концентрація на поверхні (z=0), мг/кг
 * @param {number} D   — коефіцієнт дифузії, см²/доба
 * @param {number} z   — глибина, см
 * @param {number} t   — час, доби
 * @returns {number} концентрація C(z,t), мг/кг
 */
function theoreticalC(C0, D, z, t) {
  if (D <= 0 || t <= 0) return C0;
  if (z <= 0) return C0;
  return C0 * erfc(z / (2 * Math.sqrt(D * t)));
}

// ─────────────────────────────────────────────
// 2. ЗНАХОДЖЕННЯ КОЕФІЦІЄНТА ДИФУЗІЇ D
// ─────────────────────────────────────────────

/**
 * Функція похибки (сума квадратів відхилень)
 * між виміряними і теоретичними концентраціями
 *
 * @param {number}   C0     — нормована концентрація, мг/кг
 * @param {number}   D      — кандидат для коефіцієнта дифузії
 * @param {Array}    probes — масив { depth_cm, time_days, value }
 * @returns {number} SSE (sum of squared errors)
 */
function sumSquaredErrors(C0, D, probes) {
  let sse = 0;
  for (const p of probes) {
    const Ctheo = theoreticalC(C0, D, p.depth_cm, p.time_days);
    const diff  = p.value - Ctheo;
    sse += diff * diff;
  }
  return sse;
}

/**
 * Знаходження оптимального D методом золотого перетину
 * Мінімізує SSE на інтервалі [Dmin, Dmax]
 *
 * Золотий перетин обирає точки всередині інтервалу
 * пропорційно до φ = (√5−1)/2 ≈ 0.618 і звужує інтервал
 * поки точність не досягне tolerance.
 *
 * @param {number} C0        — нормована концентрація, мг/кг
 * @param {Array}  probes    — масив { depth_cm, time_days, value }
 * @param {number} Dmin      — мінімальна межа пошуку (за замовч. 0.001)
 * @param {number} Dmax      — максимальна межа пошуку (за замовч. 5.0)
 * @param {number} tolerance — точність зупинки (за замовч. 1e-7)
 * @returns {object} { D, sse, iterations }
 */
function findDiffusionCoefficient(C0, probes, Dmin = 0.001, Dmax = 5.0, tolerance = 1e-7) {
  // Перевірка вхідних даних
  if (!probes || probes.length < 1) {
    throw new Error('Потрібна хоча б одна проба для розрахунку D');
  }
  if (C0 <= 0) {
    throw new Error('C₀ має бути більше нуля');
  }

  const phi = (Math.sqrt(5) - 1) / 2; // ≈ 0.618
  let a = Dmin;
  let b = Dmax;
  let iterations = 0;
  const maxIter  = 1000;

  // Початкові внутрішні точки
  let x1 = b - phi * (b - a);
  let x2 = a + phi * (b - a);
  let f1 = sumSquaredErrors(C0, x1, probes);
  let f2 = sumSquaredErrors(C0, x2, probes);

  while ((b - a) > tolerance && iterations < maxIter) {
    if (f1 < f2) {
      // Мінімум лівіше x2 — звужуємо справа
      b  = x2;
      x2 = x1; f2 = f1;
      x1 = b - phi * (b - a);
      f1 = sumSquaredErrors(C0, x1, probes);
    } else {
      // Мінімум правіше x1 — звужуємо зліва
      a  = x1;
      x1 = x2; f1 = f2;
      x2 = a + phi * (b - a);
      f2 = sumSquaredErrors(C0, x2, probes);
    }
    iterations++;
  }

  const D   = (a + b) / 2;
  const sse = sumSquaredErrors(C0, D, probes);

  return { D, sse, iterations };
}

/**
 * Розрахунок D для всіх металів одночасно
 *
 * @param {object} C0map   — { Fe: 12.3, Mn: 5.6, ... }
 * @param {Array}  probes  — масив проб з probe.values = { Fe: ..., Mn: ... }
 * @param {Array}  metals  — список металів для розрахунку
 * @returns {object} { Fe: { D, sse, rmse, probeCount }, Mn: { ... }, ... }
 */
function calculateAllD(C0map, probes, metals = ['Fe','Mn','Cu','Zn','Cd','Pb']) {
  const results = {};

  for (const metal of metals) {
    const C0 = parseFloat(C0map[metal]);

    // Пропустити метал якщо C0 відсутній або нульовий
    if (!C0 || isNaN(C0) || C0 <= 0) {
      results[metal] = { D: null, sse: null, rmse: null, probeCount: 0, skipped: true };
      continue;
    }

    // Зібрати проби для цього металу (тільки де є значення)
    const metalProbes = probes
      .filter(p => p.values?.[metal] !== undefined && p.values[metal] !== null)
      .map(p => ({
        depth_cm:  parseFloat(p.depth_cm),
        time_days: parseFloat(p.time_days),
        value:     parseFloat(p.values[metal])
      }))
      .filter(p => !isNaN(p.depth_cm) && !isNaN(p.time_days) && !isNaN(p.value));

    if (metalProbes.length < 1) {
      results[metal] = { D: null, sse: null, rmse: null, probeCount: 0, skipped: true };
      continue;
    }

    try {
      const { D, sse, iterations } = findDiffusionCoefficient(C0, metalProbes);

      // RMSE — середньоквадратична похибка (зручніша для інтерпретації ніж SSE)
      const rmse = Math.sqrt(sse / metalProbes.length);

      results[metal] = {
        D:          parseFloat(D.toFixed(6)),
        sse:        parseFloat(sse.toFixed(6)),
        rmse:       parseFloat(rmse.toFixed(4)),
        probeCount: metalProbes.length,
        iterations,
        skipped:    false
      };
    } catch (err) {
      results[metal] = { D: null, error: err.message, skipped: true };
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// 3. ПОБУДОВА ПРОФІЛЮ C(z,t)
// ─────────────────────────────────────────────

/**
 * Генерація масиву точок для графіка C(z) при фіксованому t
 *
 * @param {number} C0      — нормована концентрація
 * @param {number} D       — коефіцієнт дифузії
 * @param {number} t       — час, доби
 * @param {number} zMax    — максимальна глибина, см
 * @param {number} nPoints — кількість точок
 * @returns {Array} [{ z, C }, ...]
 */
function buildProfile(C0, D, t, zMax = 20, nPoints = 100) {
  const points = [];
  const step   = zMax / (nPoints - 1);
  for (let i = 0; i < nPoints; i++) {
    const z = parseFloat((i * step).toFixed(4));
    const C = parseFloat(theoreticalC(C0, D, z, t).toFixed(6));
    points.push({ z, C });
  }
  return points;
}

/**
 * Генерація значень на конкретних глибинах (для таблиці горизонтів)
 *
 * @param {number} C0        — нормована концентрація
 * @param {number} D         — коефіцієнт дифузії
 * @param {number} t         — час, доби
 * @param {Array}  depthsArr — масив глибин [0, 2, 4, ...]
 * @returns {Array} концентрації відповідно до depthsArr
 */
function profileAtDepths(C0, D, t, depthsArr) {
  return depthsArr.map(z =>
    parseFloat(theoreticalC(C0, D, z, t).toFixed(6))
  );
}

// ─────────────────────────────────────────────
// 4. ЯКІСТЬ АПРОКСИМАЦІЇ
// ─────────────────────────────────────────────

/**
 * Коефіцієнт детермінації R² — показує наскільки добре
 * модель описує виміряні дані (1.0 = ідеально, <0.9 = погано)
 *
 * @param {number} C0     — нормована концентрація
 * @param {number} D      — знайдений коефіцієнт дифузії
 * @param {Array}  probes — масив { depth_cm, time_days, value }
 * @returns {number} R² ∈ [0, 1]
 */
function rSquared(C0, D, probes) {
  if (!probes.length) return null;

  const measured = probes.map(p => p.value);
  const meanC    = measured.reduce((s, v) => s + v, 0) / measured.length;

  let ssTot = 0; // загальна дисперсія
  let ssRes = 0; // залишкова дисперсія

  for (const p of probes) {
    const Ctheo = theoreticalC(C0, D, p.depth_cm, p.time_days);
    ssTot += (p.value - meanC) ** 2;
    ssRes += (p.value - Ctheo) ** 2;
  }

  if (ssTot === 0) return 1; // всі виміри однакові
  return parseFloat((1 - ssRes / ssTot).toFixed(4));
}

// ─────────────────────────────────────────────
// 5. ЕКСПОРТ
// ─────────────────────────────────────────────

module.exports = {
  // Основні формули
  erfc,
  theoreticalC,

  // Пошук D
  findDiffusionCoefficient,
  calculateAllD,

  // Профілі
  buildProfile,
  profileAtDepths,

  // Якість
  rSquared,
  sumSquaredErrors,
};
