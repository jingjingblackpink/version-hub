/**
 * utils.js —— 通用工具函数（无依赖，兼容 file:// 本地打开）
 * 全局命名空间：window.VH
 */
(function (global) {
  'use strict';
  var VH = (global.VH = global.VH || {});

  /* ---------------- DOM ---------------- */
  VH.$ = function (sel, root) { return (root || document).querySelector(sel); };
  VH.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  VH.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* ---------------- 日期 ---------------- */
  /** 补零到两位。接受数字或字符串：pad(5)→'05'，pad('05')→'05'，pad('00')→'00' */
  function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  VH.today = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  /**
   * 当前本地日期时间 YYYY-MM-DDTHH:mm:ss
   * 直接对应 <input type="datetime-local" step="1"> 的取值格式
   */
  VH.nowLocalDateTime = function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  };

  /** 原始值里是否带有「时分」部分（用于区分 老数据纯日期 / 新数据日期时间） */
  VH.hasTimePart = function (v) {
    return /[T ]\d{1,2}:\d{2}/.test(String(v || ''));
  };

  /**
   * 归一为可字典序比较的排序键 YYYY-MM-DDTHH:mm:ss
   * · 纯日期补 T00:00:00，保证「同一天内 无时间 < 有时间」排序正确
   * · 抹掉毫秒（浏览器 datetime-local 可能序列化成 ...T10:30:00.000）
   * · 补全缺失的秒、补齐个位数小时
   */
  VH.dateKey = function (v) {
    if (!v) return '';
    var s = String(v).trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00';
    var m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?/);
    if (m) return m[1] + 'T' + pad(m[2]) + ':' + pad(m[3]) + ':' + pad(m[4] || '00');
    return s;
  };

  /**
   * 显示用格式化：
   *   带时间 → 2026-11-24 10:30:00
   *   纯日期（老数据）→ 2026-11-24    ← 不补无意义的 00:00:00
   */
  VH.formatDateValue = function (v) {
    if (!v) return '—';
    var m = VH.dateKey(v).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return String(v);
    if (!VH.hasTimePart(v)) return m[1];
    return m[1] + ' ' + m[2] + ':' + m[3] + ':' + m[4];
  };

  /** 拆成日期 + 时间两段，供表格双行显示；无时间部分时 time 为空串 */
  VH.splitDateValue = function (v) {
    if (!v) return { date: '—', time: '' };
    var m = VH.dateKey(v).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (!m) return { date: String(v), time: '' };
    return { date: m[1], time: VH.hasTimePart(v) ? m[2] : '' };
  };

  /**
   * 是否晚于「此刻」。
   * · 纯日期（老数据 / date 控件）：只按「天」比较，今天不算未来
   * · 带时间（datetime-local）：精确到秒与当前时刻比较
   */
  VH.isFutureDateTime = function (v) {
    if (!v) return false;
    var s = String(v).trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s > VH.today();
    var d = new Date(s);
    if (isNaN(d.getTime())) return false;
    return d.getTime() > Date.now() + 1000;   // 1 秒容差，避开秒级抖动
  };

  /** 本地时区的 ISO 字符串，如 2026-11-24T10:30:00+08:00 */
  VH.nowIso = function () {
    var d = new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var a = Math.abs(off);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60)
    );
  };

  /** 把任意可解析时间显示为 YYYY-MM-DD HH:mm */
  VH.formatDateTime = function (v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    );
  };

  /** 相对时间，如「3 分钟前」 */
  VH.fromNow = function (v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 0) return VH.formatDateTime(v);
    var m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var day = Math.floor(h / 24);
    if (day < 30) return day + ' 天前';
    return VH.formatDateTime(v);
  };

  /** @deprecated 兼容旧调用，等价于 isFutureDateTime */
  VH.isFutureDate = VH.isFutureDateTime;

  /* ---------------- 枚举字典 ---------------- */
  VH.cfg = function () { return global.__SITE_CONFIG__ || {}; };
  VH.defaultProjectName = function () { return (VH.cfg().project || {}).defaultName || ''; };

  VH.CHANNELS = [
    { value: 'stable', label: '稳定版' },
    { value: 'beta', label: '测试版' },
    { value: 'lab', label: '实验版' }
  ];

  VH.STATUSES = [
    { value: 'normal', label: '正常' },
    { value: 'archived', label: '已归档' },
    { value: 'deprecated', label: '已废弃' }
  ];

  VH.labelOf = function (list, value, fallback) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].value === value) return list[i].label;
    }
    return fallback || value || '—';
  };

  VH.channelLabel = function (v) { return VH.labelOf(VH.CHANNELS, v, '稳定版'); };
  VH.statusLabel = function (v) { return VH.labelOf(VH.STATUSES, v, '正常'); };

  VH.optionsHtml = function (list, selected) {
    return list
      .map(function (o) {
        return '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>' + o.label + '</option>';
      })
      .join('');
  };

  /* ---------------- 版本号排序 ---------------- */
  /**
   * 语义化版本比较：
   *   v1.10.0 > v1.9.0        （数值段按数字比较，不是字符串）
   *   v1.0   < v1.0.1         （多出的数字段 = 更新）
   *   v2.0.0 > v2.0.0-beta    （多出的文字段 = 预发布，更旧）
   */
  VH.versionCompare = function (a, b) {
    function split(v) {
      return String(v == null ? '' : v)
        .replace(/^[vV]/, '')
        .split(/[.\-+_\s]+/)
        .filter(function (s) { return s !== ''; });
    }
    var pa = split(a), pb = split(b);
    var len = Math.max(pa.length, pb.length);

    for (var i = 0; i < len; i++) {
      var sx = i < pa.length ? pa[i] : '';
      var sy = i < pb.length ? pb[i] : '';
      if (sx === sy) continue;

      var xNum = /^\d+$/.test(sx);
      var yNum = /^\d+$/.test(sy);

      // 一方段数用尽
      if (sx === '') return yNum ? -1 : 1;
      if (sy === '') return xNum ? 1 : -1;

      // 双方都是数字 → 数值比较
      if (xNum && yNum) {
        var d = parseInt(sx, 10) - parseInt(sy, 10);
        if (d !== 0) return d;
        continue;
      }
      // 数字标识符优先于文字预发布标识符
      if (xNum) return 1;
      if (yNum) return -1;
      // 都是文字 → 字典序
      return sx < sy ? -1 : 1;
    }
    return 0;
  };

  /* ---------------- 交互反馈 ---------------- */
  VH.toast = function (msg, type) {
    var box = VH.$('#toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    var item = document.createElement('div');
    item.className = 'toast toast-' + (type || 'info');
    item.textContent = msg;
    box.appendChild(item);
    setTimeout(function () { item.classList.add('show'); }, 10);
    setTimeout(function () {
      item.classList.remove('show');
      setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 260);
    }, 2800);
  };

  VH.confirm = function (msg) { return global.confirm(msg); };

  VH.copyText = function (text) {
    return new Promise(function (resolve, reject) {
      function legacy() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          ok ? resolve() : reject(new Error('execCommand 失败'));
        } catch (e) { reject(e); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve).catch(legacy);
      } else {
        legacy();
      }
    });
  };

  /* ---------------- 文件读写 ---------------- */
  VH.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  };

  /** 导出 CSV 时带 BOM，Excel 打开不乱码 */
  VH.downloadCsv = function (filename, text) {
    var blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  };

  VH.readFileAsText = function (file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error || new Error('读取失败')); };
      fr.readAsText(file, 'utf-8');
    });
  };

  /* ---------------- 其他 ---------------- */
  VH.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  };

  VH.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 250);
    };
  };

  VH.deepClone = function (o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  };

  /**
   * 安全存储层
   * ------------------------------------------------------------------
   * file:// 协议下，Safari / 部分浏览器隐私模式会禁用 localStorage 并
   * 直接抛 SecurityError。这里做能力探测 + 内存降级，保证「双击本地
   * 打开」时页面绝不会因存储异常而白屏（代价：关闭页面后会话丢失）。
   */
  var memStore = {};
  var persistent = (function () {
    try {
      var k = '__vh_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  VH.storage = {
    /** localStorage 是否可用；false 时数据仅存于内存，刷新/关闭即失效 */
    isPersistent: function () { return persistent; },

    get: function (key, fallback) {
      try {
        var raw = persistent ? global.localStorage.getItem(key) : (key in memStore ? memStore[key] : null);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    set: function (key, value) {
      var raw;
      try { raw = JSON.stringify(value); }
      catch (e) { return false; }
      try {
        if (persistent) global.localStorage.setItem(key, raw);
        else memStore[key] = raw;
        return true;
      } catch (e) {
        // 配额溢出等情况 → 退回内存，保证不中断
        try { memStore[key] = raw; } catch (e2) { /* noop */ }
        VH.toast('本地存储写入失败，已暂存内存：' + e.message, 'warn');
        return false;
      }
    },

    remove: function (key) {
      try {
        if (persistent) global.localStorage.removeItem(key);
        delete memStore[key];
      } catch (e) {
        delete memStore[key];
      }
    }
  };

  /** 非持久化环境的一次性提示 */
  VH.warnIfNotPersistent = function () {
    if (persistent) return;
    VH.toast('当前浏览器禁用了本地存储：登录状态与草稿在关闭页面后会丢失', 'warn');
  };

  /** 生成 Markdown 摘要：去掉标记，取前 n 字 */
  VH.plainSummary = function (md, n) {
    if (!md) return '';
    var t = String(md)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[*_`~]/g, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var max = n || 60;
    return t.length > max ? t.slice(0, max) + '…' : t;
  };

  /** 从 README 中提取「- xxx」条目作为更新日志 */
  VH.deriveChangelog = function (md) {
    if (!md) return [];
    var out = [];
    String(md).split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*[-*+]\s+(.+)$/);
      if (m) {
        var txt = m[1].replace(/[*_`~]/g, '').trim();
        if (txt && out.length < 8) out.push(txt);
      }
    });
    return out;
  };

  VH.isBaiduPan = function (url) {
    return /^https?:\/\/(pan\.baidu\.com|yun\.baidu\.com)\//i.test(String(url || '').trim());
  };

  /** 主题：dark / light。科技感设计以深色为默认，可手动切到浅色 */
  VH.initTheme = function () {
    var saved = VH.storage.get('vh.theme', null);
    apply(saved);
    function apply(t) {
      if (!t) t = 'dark';   // 默认深色 HUD 主题
      document.documentElement.setAttribute('data-theme', t);
      var btn = VH.$('#theme-toggle');
      if (btn) btn.textContent = t === 'dark' ? '☀ 浅色' : '☾ 深色';
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t === 'dark' ? '#04060e' : '#eef3fb');
    }
    VH.toggleTheme = function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      VH.storage.set('vh.theme', cur);
      apply(cur);
    };
    var btn = VH.$('#theme-toggle');
    if (btn) btn.addEventListener('click', VH.toggleTheme);
  };

  /** 统一的页头填充（站点名等） */
  VH.fillSiteInfo = function (cfg) {
    var s = (cfg && cfg.site) || {};
    VH.$$('#site-name').forEach(function (e) { e.textContent = s.name || '软件版本中心'; });
    VH.$$('[data-site-name]').forEach(function (e) { e.textContent = s.name || '软件版本中心'; });
    VH.$$('[data-site-subtitle]').forEach(function (e) { e.textContent = s.subtitle || ''; });
    VH.$$('[data-site-footer]').forEach(function (e) { e.textContent = s.footer || ''; });
    var t = document.querySelector('title');
    if (t && t.getAttribute('data-base-title')) {
      t.setAttribute('data-base-title-full', (s.name || '') + ' · ' + t.getAttribute('data-base-title'));
    }
  };

  /** 有未保存修改时，在标签页标题前加 ● 提示 */
  VH.markTitleDirty = function (dirty, baseTitle) {
    document.title = (dirty ? '\u25cf ' : '') + baseTitle;
  };

})(window);
