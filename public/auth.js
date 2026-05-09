// auth.js — підключити на кожній захищеній сторінці
// <script src="/auth.js"></script>

const Auth = {
  // Отримати токен
  getToken() {
    return localStorage.getItem('token');
  },

  // Отримати дані користувача
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('user'));``
    } catch { return null; }
  },

  // Перевірити авторизацію (редірект на /login.html якщо ні)
  require() {
    if (!this.getToken()) {
      window.location.replace('/login.html');
      return false;
    }
    return true;
  },

  // Вийти
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login.html');
  },

  // fetch з автоматичним Bearer токеном
  async fetch(url, options = {}) {
    const token = this.getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });

    // Якщо токен прострочений — редірект
    if (res.status === 401 || res.status === 403) {
      this.logout();
      return null;
    }

    return res;
  }
};
