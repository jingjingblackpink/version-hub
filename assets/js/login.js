/**
 * login.js —— 登录页逻辑
 */
(function (global) {
  'use strict';
  var VH = global.VH;
  var $ = VH.$;

  var form = $('#login-form');
  var userInput = $('#username');
  var passInput = $('#password');
  var rememberBox = $('#remember');
  var errBox = $('#login-error');
  var lockTip = $('#lock-tip');
  var loginBtn = $('#login-btn');

  var lockTimer = null;

  /* ---------- 初始化 ---------- */
  function init() {
    VH.initTheme();
    VH.warnIfNotPersistent();

    var cfg = VH.cfg();
    VH.$$('[data-site-name]').forEach(function (e) { e.textContent = (cfg.site || {}).name || '软件版本中心'; });
    VH.$$('[data-site-subtitle]').forEach(function (e) { e.textContent = ((cfg.site || {}).subtitle || '').toUpperCase(); });
    VH.$$('[data-site-footer]').forEach(function (e) { e.textContent = (cfg.site || {}).footer || ''; });
    VH.$$('[data-site-login-notice]').forEach(function (e) { e.textContent = (cfg.site || {}).loginNotice || ''; });
    document.title = '登录 · ' + ((cfg.site || {}).name || '软件版本中心');

    // 已登录 → 直接跳转
    var session = VH.auth.current();
    if (session) {
      var target = VH.auth.redirectTarget(null) || VH.auth.homeOf(session.role);
      global.location.replace(target);
      return;
    }

    bindEvents();
    updateLockTip();

    // 若从受保护页被踢回，给出提示
    if (VH.auth.redirectTarget(null)) {
      showError('登录状态已失效，请重新登录。');
    }
    setTimeout(function () { userInput.focus(); }, 60);
  }

  function bindEvents() {
    form.addEventListener('submit', onSubmit);

    $('#toggle-pass').addEventListener('click', function () {
      var showing = passInput.type === 'text';
      passInput.type = showing ? 'password' : 'text';
      this.textContent = showing ? '显示' : '隐藏';
      passInput.focus();
    });

    VH.$$('[data-fill]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var who = btn.getAttribute('data-fill');
        userInput.value = who;
        passInput.value = who;
        hideError();
        passInput.focus();
      });
    });

    [userInput, passInput].forEach(function (el) {
      el.addEventListener('input', hideError);
    });
  }

  /* ---------- 提交 ---------- */
  function onSubmit(e) {
    e.preventDefault();

    var lockLeft = VH.auth.lockRemaining();
    if (lockLeft > 0) {
      showError('尝试次数过多，请 ' + lockLeft + ' 秒后再试。');
      updateLockTip();
      return;
    }

    var user = userInput.value.trim();
    var pass = passInput.value;

    if (!user || !pass) {
      showError('请输入账号和密码。');
      (user ? passInput : userInput).focus();
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = '登录中…';

    // 稍作延迟，让锁定/失败状态的 UI 反馈更自然
    setTimeout(function () {
      var res = VH.auth.login(user, pass, rememberBox.checked);

      loginBtn.disabled = false;
      loginBtn.textContent = '登 录';

      if (!res.ok) {
        showError(res.message || '登录失败');
        updateLockTip();
        passInput.select();
        return;
      }

      hideError();
      loginBtn.textContent = '✓ 登录成功';
      loginBtn.classList.remove('btn-primary');
      loginBtn.classList.add('btn-success');

      var target = VH.auth.redirectTarget(null) || VH.auth.homeOf(res.role);
      setTimeout(function () { global.location.href = target; }, 260);
    }, 180);
  }

  /* ---------- 错误提示 ---------- */
  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.add('show');
  }
  function hideError() {
    errBox.classList.remove('show');
  }

  /* ---------- 锁定倒计时 ---------- */
  function updateLockTip() {
    clearInterval(lockTimer);
    var left = VH.auth.lockRemaining();
    if (left <= 0) {
      lockTip.textContent = '';
      loginBtn.disabled = false;
      return;
    }
    loginBtn.disabled = true;
    lockTip.textContent = '已锁定 ' + left + 's';
    lockTimer = setInterval(function () {
      var l = VH.auth.lockRemaining();
      if (l <= 0) {
        clearInterval(lockTimer);
        lockTip.textContent = '';
        loginBtn.disabled = false;
        hideError();
      } else {
        lockTip.textContent = '已锁定 ' + l + 's';
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
