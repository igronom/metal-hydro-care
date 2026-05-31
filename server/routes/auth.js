const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заповніть всі поля' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль мінімум 6 символів' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length > 0)
      return res.status(409).json({ error: 'Email вже зареєстровано' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1,$2,$3) RETURNING id, name, email, created_at',
      [name, email, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: 'Введіть email і пароль' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];

    if (!user)
      return res.status(401).json({ error: 'Невірний email або пароль' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Невірний email або пароль' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, created_at: user.created_at } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Користувача не знайдено' });

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// PUT /api/auth/update — оновити ім'я, email, пароль
router.put('/update', auth, async (req, res) => {
  const { name, email, currentPassword, newPassword } = req.body;

  if (!name || !email)
    return res.status(400).json({ error: 'Ім\'я і email обов\'язкові' });

  try {
    // Перевірити що email не зайнятий іншим користувачем
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE email=$1 AND id!=$2',
      [email, req.user.id]
    );
    if (emailCheck.rows.length > 0)
      return res.status(409).json({ error: 'Цей email вже використовується' });

    // Якщо міняємо пароль — перевірити поточний
    let newHash = null;
    if (newPassword) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Введіть поточний пароль' });
      if (newPassword.length < 6)
        return res.status(400).json({ error: 'Новий пароль мінімум 6 символів' });

      const userRes = await pool.query('SELECT password FROM users WHERE id=$1', [req.user.id]);
      const valid = await bcrypt.compare(currentPassword, userRes.rows[0].password);
      if (!valid)
        return res.status(401).json({ error: 'Поточний пароль невірний' });

      newHash = await bcrypt.hash(newPassword, 12);
    }

    // Оновити дані
    let result;
    if (newHash) {
      result = await pool.query(
        'UPDATE users SET name=$1, email=$2, password=$3 WHERE id=$4 RETURNING id, name, email, created_at',
        [name, email, newHash, req.user.id]
      );
    } else {
      result = await pool.query(
        'UPDATE users SET name=$1, email=$2 WHERE id=$3 RETURNING id, name, email, created_at',
        [name, email, req.user.id]
      );
    }

    const user = result.rows[0];

    // Видати новий токен з оновленими даними
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// DELETE /api/auth/delete — видалити акаунт
router.delete('/delete', auth, async (req, res) => {
  try {
    // Каскадне видалення — всі профілі видаляться автоматично (ON DELETE CASCADE)
    await pool.query('DELETE FROM users WHERE id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

module.exports = router;
