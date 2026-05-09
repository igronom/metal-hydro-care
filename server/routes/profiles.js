const express = require('express');
const { pool } = require('../db');
const auth = require('../middleware/auth');
const { calculateAllD, rSquared, buildProfile } = require('../math');

const router = express.Router();
const METALS = ['Fe','Mn','Cu','Zn','Cd','Pb'];

// GET /api/profiles — всі профілі користувача
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
        json_object_agg(c.metal, c.value) FILTER (WHERE c.metal IS NOT NULL) AS c0,
        json_object_agg(d.metal, d.d_value) FILTER (WHERE d.metal IS NOT NULL) AS diffusion
       FROM profiles p
       LEFT JOIN concentrations_c0 c ON c.profile_id = p.id
       LEFT JOIN diffusion_coefficients d ON d.profile_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// GET /api/profiles/:id — один профіль з усіма пробами
router.get('/:id', auth, async (req, res) => {
  try {
    const profileRes = await pool.query(
      'SELECT * FROM profiles WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!profileRes.rows.length)
      return res.status(404).json({ error: 'Профіль не знайдено' });

    const profile = profileRes.rows[0];

    // C0
    const c0Res = await pool.query(
      'SELECT metal, value FROM concentrations_c0 WHERE profile_id=$1',
      [profile.id]
    );
    profile.c0 = Object.fromEntries(c0Res.rows.map(r => [r.metal, parseFloat(r.value)]));

    // Проби
    const probesRes = await pool.query(
      'SELECT * FROM probes WHERE profile_id=$1 ORDER BY time_days, depth_cm',
      [profile.id]
    );
    for (const probe of probesRes.rows) {
      const valRes = await pool.query(
        'SELECT metal, value FROM probe_values WHERE probe_id=$1',
        [probe.id]
      );
      probe.values = Object.fromEntries(valRes.rows.map(r => [r.metal, parseFloat(r.value)]));
    }
    profile.probes = probesRes.rows;

    // D коефіцієнти
    const dRes = await pool.query(
      'SELECT metal, d_value, rmse, r_squared FROM diffusion_coefficients WHERE profile_id=$1',
      [profile.id]
    );
    profile.diffusion = Object.fromEntries(
      dRes.rows.map(r => [r.metal, {
        D:        parseFloat(r.d_value),
        rmse:     r.rmse     ? parseFloat(r.rmse)      : null,
        rSquared: r.r_squared ? parseFloat(r.r_squared) : null
      }])
    );

    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// POST /api/profiles — створити профіль
router.post('/', auth, async (req, res) => {
  const { name, river, latitude, longitude, sample_date,
          depth_from, depth_to, horizons, depth_step, c0, probes } = req.body;

  if (!name || !river || !sample_date)
    return res.status(400).json({ error: "Заповніть обов'язкові поля" });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Створити профіль
    const profRes = await client.query(
      `INSERT INTO profiles
        (user_id, name, river, latitude, longitude, sample_date, depth_from, depth_to, horizons, depth_step)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, name, river, latitude, longitude, sample_date,
       depth_from||0, depth_to||20, horizons||10, depth_step||2]
    );
    const profile = profRes.rows[0];

    // 2. Зберегти C0
    if (c0) {
      for (const metal of METALS) {
        if (c0[metal] !== undefined) {
          await client.query(
            'INSERT INTO concentrations_c0 (profile_id, metal, value) VALUES ($1,$2,$3)',
            [profile.id, metal, c0[metal]]
          );
        }
      }
    }

    // 3. Зберегти проби
    if (probes && probes.length) {
      for (const probe of probes) {
        const probeRes = await client.query(
          'INSERT INTO probes (profile_id, depth_cm, time_days) VALUES ($1,$2,$3) RETURNING id',
          [profile.id, probe.depth_cm, probe.time_days]
        );
        const probeId = probeRes.rows[0].id;
        for (const metal of METALS) {
          if (probe.values?.[metal] !== undefined) {
            await client.query(
              'INSERT INTO probe_values (probe_id, metal, value) VALUES ($1,$2,$3)',
              [probeId, metal, probe.values[metal]]
            );
          }
        }
      }
    }

    await client.query('COMMIT');

    // 4. Автоматично розрахувати D після збереження
    if (c0 && probes && probes.length >= 1) {
      await calculateAndSaveD(profile.id, c0, probes, pool);
    }

    res.status(201).json({ ...profile, id: profile.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Помилка збереження' });
  } finally {
    client.release();
  }
});

// GET /api/profiles/:id/profile — числовий профіль C(z) для металу при часі t
router.get('/:id/profile', auth, async (req, res) => {
  const { metal, t } = req.query;
  if (!metal || !t)
    return res.status(400).json({ error: 'Потрібні параметри metal і t' });

  try {
    // Перевірити доступ
    const profileRes = await pool.query(
      'SELECT id FROM profiles WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!profileRes.rows.length)
      return res.status(404).json({ error: 'Профіль не знайдено' });

    const profileId = parseInt(req.params.id);
    const tVal = parseFloat(t);

    // Отримати C0 для металу
    const c0Res = await pool.query(
      'SELECT value FROM concentrations_c0 WHERE profile_id=$1 AND metal=$2',
      [profileId, metal]
    );
    if (!c0Res.rows.length)
      return res.status(404).json({ error: `C0 для ${metal} не знайдено` });
    const C0 = parseFloat(c0Res.rows[0].value);

    // Отримати D для металу
    const dRes = await pool.query(
      'SELECT d_value FROM diffusion_coefficients WHERE profile_id=$1 AND metal=$2',
      [profileId, metal]
    );
    if (!dRes.rows.length)
      return res.status(404).json({ error: `D для ${metal} не розраховано` });
    const D = parseFloat(dRes.rows[0].d_value);

    // Параметри сітки
    const profileMeta = await pool.query(
      'SELECT depth_to, depth_step FROM profiles WHERE id=$1',
      [profileId]
    );
    const zMax = parseFloat(profileMeta.rows[0].depth_to) || 20;

    // Числовий розв'язок
    const points = buildProfile(C0, D, tVal, zMax, DZ, DT);

    res.json({ metal, t: tVal, C0, D, points });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка розрахунку: ' + err.message });
  }
});

// POST /api/profiles/:id/calculate — розрахувати D для профілю
router.post('/:id/calculate', auth, async (req, res) => {
  try {
    // Перевірити що профіль належить користувачу
    const profileRes = await pool.query(
      'SELECT id FROM profiles WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!profileRes.rows.length)
      return res.status(404).json({ error: 'Профіль не знайдено' });

    const profileId = parseInt(req.params.id);

    // Завантажити C0
    const c0Res = await pool.query(
      'SELECT metal, value FROM concentrations_c0 WHERE profile_id=$1',
      [profileId]
    );
    const c0 = Object.fromEntries(c0Res.rows.map(r => [r.metal, parseFloat(r.value)]));

    // Завантажити проби
    const probesRes = await pool.query(
      'SELECT p.*, json_object_agg(pv.metal, pv.value) AS values FROM probes p JOIN probe_values pv ON pv.probe_id = p.id WHERE p.profile_id=$1 GROUP BY p.id',
      [profileId]
    );
    const probes = probesRes.rows.map(p => ({
      depth_cm:  parseFloat(p.depth_cm),
      time_days: parseFloat(p.time_days),
      values:    Object.fromEntries(Object.entries(p.values).map(([k,v]) => [k, parseFloat(v)]))
    }));

    if (probes.length < 1)
      return res.status(400).json({ error: 'Недостатньо проб для розрахунку' });

    // Розрахувати D
    const results = await calculateAndSaveD(profileId, c0, probes, pool);

    res.json({
      message: 'Коефіцієнти дифузії розраховано',
      results
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка розрахунку: ' + err.message });
  }
});

// PUT /api/profiles/:id — оновити профіль
router.put('/:id', auth, async (req, res) => {
  const { name, river, latitude, longitude, sample_date,
          depth_from, depth_to, horizons, depth_step, c0, probes } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE profiles SET name=$1, river=$2, latitude=$3, longitude=$4,
       sample_date=$5, depth_from=$6, depth_to=$7, horizons=$8, depth_step=$9,
       updated_at=NOW()
       WHERE id=$10 AND user_id=$11 RETURNING *`,
      [name, river, latitude, longitude, sample_date,
       depth_from||0, depth_to||20, horizons||10, depth_step||2,
       req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Профіль не знайдено' });
    }
    const profile = result.rows[0];

    // Оновити C0
    if (c0) {
      await client.query('DELETE FROM concentrations_c0 WHERE profile_id=$1', [profile.id]);
      for (const metal of METALS) {
        if (c0[metal] !== undefined) {
          await client.query(
            'INSERT INTO concentrations_c0 (profile_id, metal, value) VALUES ($1,$2,$3)',
            [profile.id, metal, c0[metal]]
          );
        }
      }
    }

    // Оновити проби
    if (probes && probes.length) {
      await client.query('DELETE FROM probes WHERE profile_id=$1', [profile.id]);
      for (const probe of probes) {
        const probeRes = await client.query(
          'INSERT INTO probes (profile_id, depth_cm, time_days) VALUES ($1,$2,$3) RETURNING id',
          [profile.id, probe.depth_cm, probe.time_days]
        );
        const probeId = probeRes.rows[0].id;
        for (const metal of METALS) {
          if (probe.values?.[metal] !== undefined) {
            await client.query(
              'INSERT INTO probe_values (probe_id, metal, value) VALUES ($1,$2,$3)',
              [probeId, metal, probe.values[metal]]
            );
          }
        }
      }
    }

    await client.query('COMMIT');

    // Перерахувати D
    if (c0 && probes && probes.length >= 1) {
      await calculateAndSaveD(profile.id, c0, probes, pool);
    }

    res.json(profile);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  } finally {
    client.release();
  }
});

// DELETE /api/profiles/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM profiles WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ─────────────────────────────────────────────
// Внутрішня функція: розрахунок і збереження D
// ─────────────────────────────────────────────
// Параметри числової сітки (мають відповідати math.js)
const DZ = 0.05; // крок по глибині, см
const DT = 0.01; // крок по часу, доби

async function calculateAndSaveD(profileId, c0, probes, db) {
  // Передаємо dz і dt — числова схема замість erfc
  const dResults = calculateAllD(c0, probes, ['Fe','Mn','Cu','Zn','Cd','Pb'], DZ, DT);

  for (const [metal, result] of Object.entries(dResults)) {
    if (result.skipped || !result.D) continue;

    // Підготувати проби для R²
    const metalProbes = probes
      .filter(p => p.values?.[metal] !== undefined && p.values[metal] !== null)
      .map(p => ({
        depth_cm:  parseFloat(p.depth_cm),
        time_days: parseFloat(p.time_days),
        value:     parseFloat(p.values[metal])
      }))
      .filter(p => p.depth_cm > 0 && p.time_days > 0);

    // R² теж через числовий розв'язок
    const r2 = rSquared(parseFloat(c0[metal]), result.D, metalProbes, DZ, DT);
    const r2Clamped = r2 !== null ? Math.max(-999, Math.min(999, r2)) : null;

    await db.query(
      `INSERT INTO diffusion_coefficients (profile_id, metal, d_value, rmse, r_squared)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (profile_id, metal)
       DO UPDATE SET d_value=$3, rmse=$4, r_squared=$5`,
      [profileId, metal, result.D, result.rmse, r2Clamped]
    );
  }

  return dResults;
}

module.exports = router;
