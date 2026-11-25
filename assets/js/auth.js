/**
 * auth.js —— 登录校验、会话管理、页面守卫
 *
 * ⚠️ 前端「软隔离」：账号密码存在于静态文件中，无法抵御查看源码者。
 *    仅用于内部台账的身份区分，请勿在本站存放机密数据。
 */
(function (global) {
  'use strict';
  var VH = (global.VH = global.VH || {});

  var SESSION_KEY = 'vh.session';
  var FAIL_KEY = 'vh.loginFails';

  var auth = (VH.auth = {});

  function cfg() { return VH.cfg(); }
  function opt(key, dft) {
    var o = cfg().options || {};
    return o[key] == null ? dft : o[key];
  }

  /* ---------------- 会话读写 ---------------- */
  auth.save = function (session) {
    VH.storage.set(SESSION_KEY, session);
  };

  auth.current = function () {
    var s = VH.storage.get(SESSION_KEY, null);
    if (!s || !s.user) return null;
    if (s.expireAt && Date.now() > s.expireAt) {
      VH.storage.remove(SESSION_KEY);
      return null;
    }
    return s;
  };

  auth.logout = function (redirectTo) {
    VH.storage.remove(SESSION_KEY);
    global.location.href = redirectTo || 'index.html';
  };

  /* ---------------- 失败锁定 ---------------- */
  function getFails() {
    return VH.storage.get(FAIL_KEY, { count: 0, lockUntil: 0 });
  }

  auth.lockRemaining = function () {
    var f = getFails();
    if (!f.lockUntil) return 0;
    var left = Math.ceil((f.lockUntil - Date.now()) / 1000);
    return left > 0 ? left : 0;
  };

  function recordFail() {
    var f = getFails();
    f.count = (f.count || 0) + 1;
    var max = opt('maxFailTimes', 5);
    if (f.count >= max) {
      f.lockUntil = Date.now() + opt('lockSeconds', 30) * 1000;
      f.count = 0;
    }
    VH.storage.set(FAIL_KEY, f);
    return f;
  }

  function clearFails() {
    VH.storage.remove(FAIL_KEY);
  }

  /* ---------------- 登录 ---------------- */
  /**
   * @returns {{ok:boolean, message?:string, role?:string, lock?:number}}
   */
  auth.login = function (username, password, remember) {
    var lockLeft = auth.lockRemaining();
    if (lockLeft > 0) {
      return { ok: false, lock: lockLeft, message: '尝试次数过多，请 ' + lockLeft + ' 秒后再试' };
    }

    var user = String(username || '').trim();
    var pass = String(password || '');
    if (!user || !pass) {
      return { ok: false, message: '请输入账号和密码' };
    }

    var accounts = cfg().accounts || [];
    var hit = null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].user === user && accounts[i].pass === pass) { hit = accounts[i]; break; }
    }

    if (!hit) {
      var f = recordFail();
      var msg = '账号或密码错误';
      if (f.lockUntil) msg = '错误次数过多，已临时锁定 ' + opt('lockSeconds', 30) + ' 秒';
      return { ok: false, message: msg };
    }

    clearFails();
    var hours = remember ? opt('rememberDays', 7) * 24 : opt('sessionHours', 8);
    var session = {
      user: hit.user,
      role: hit.role,
      label: hit.label || hit.role,
      loginAt: Date.now(),
      expireAt: Date.now() + hours * 3600 * 1000
    };
    auth.save(session);
    return { ok: true, role: hit.role };
  };

  /* ---------------- 页面守卫 ---------------- */
  /**
   * 校验当前页访问权限；不通过则跳转。
   * @param {string[]} allowRoles 允许的角色，如 ['admin'] 或 ['admin','client']
   */
  auth.require = function (allowRoles) {
    var roles = Array.isArray(allowRoles) ? allowRoles : [allowRoles];
    var s = auth.current();

    if (!s) {
      var back = global.location.pathname.split('/').pop() || 'index.html';
      global.location.replace('index.html?redirect=' + encodeURIComponent(back));
      return null;
    }
    if (roles.indexOf(s.role) < 0) {
      VH.toast && VH.toast('当前账号无权访问该页面，正在跳转…', 'error');
      setTimeout(function () {
        global.location.replace(s.role === 'admin' ? 'admin.html' : 'client.html');
      }, 700);
      return null;
    }
    return s;
  };

  /** 登录后应跳转的页面 */
  auth.homeOf = function (role) {
    return role === 'admin' ? 'admin.html' : 'client.html';
  };

  /** 读取 URL 上的 ?redirect= 参数（仅允许站内 .html，防开放重定向） */
  auth.redirectTarget = function (fallback) {
    try {
      var q = global.location.search.match(/[?&]redirect=([^&]+)/);
      if (!q) return fallback;
      var name = decodeURIComponent(q[1]);
      return /^[a-zA-Z0-9_-]+\.html$/.test(name) ? name : fallback;
    } catch (e) {
      return fallback;
    }
  };
})(window);
