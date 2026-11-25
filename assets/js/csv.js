/**
 * csv.js —— 轻量 CSV 解析 / 生成（无外部依赖）
 * 支持：引号包裹、字段内逗号与换行、"" 转义、CRLF、UTF-8 BOM
 */
(function (global) {
  'use strict';
  var VH = (global.VH = global.VH || {});
  var CSV = (VH.csv = {});

  /** 解析为二维数组 */
  CSV.parse = function (text) {
    text = String(text || '').replace(/^\ufeff/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var rows = [], row = [], field = '', inQ = false;

    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; }
          else { inQ = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += c; }
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // 去掉完全空白的行
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  };

  /** 二维数组转 CSV 文本（不含 BOM，下载时由 downloadCsv 追加） */
  CSV.stringify = function (rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        v = v == null ? '' : String(v);
        return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
  };

  /* ------------------------------------------------------------------
   * 与业务数据的互转
   * 列顺序即模板顺序，见方案文档附录 B
   * ------------------------------------------------------------------ */
  CSV.HEADERS = [
    '项目名称', '项目编号', '版本号', '串口屏版本', '上传日期', '发布通道', '状态',
    '标签', '版本说明', '更新日志', '下载链接', '提取码',
    '文件名', '文件大小', 'SHA256', '镜像链接', '备注(仅管理员)'
  ];

  CSV.CHANNEL_CN = { stable: '稳定版', beta: '测试版', lab: '实验版' };
  CSV.CHANNEL_EN = { '稳定版': 'stable', '测试版': 'beta', '实验版': 'lab', stable: 'stable', beta: 'beta', lab: 'lab' };
  CSV.STATUS_CN = { normal: '正常', archived: '已归档', deprecated: '已废弃' };
  CSV.STATUS_EN = { '正常': 'normal', '已归档': 'archived', '已废弃': 'deprecated', normal: 'normal', archived: 'archived', deprecated: 'deprecated' };

  /** db → CSV 文本（扁平表：每行一个版本） */
  CSV.fromDb = function (db) {
    var rows = [CSV.HEADERS.slice()];
    (db.projects || []).forEach(function (p) {
      (p.releases || []).forEach(function (r) {
        var d = r.download || {};
        rows.push([
          p.name || '',
          p.id || '',
          r.version || '',
          r.screenVersion || '',
          String(r.date || '').replace('T', ' '),   // 用空格分隔，Excel 识别为日期时间
          CSV.CHANNEL_CN[r.channel] || r.channel || '稳定版',
          CSV.STATUS_CN[r.status] || r.status || '正常',
          (r.tags || []).join(';'),
          r.readme || '',
          (r.changelog || []).join(';'),
          d.url || '',
          d.password || '',
          d.fileName || '',
          d.fileSize || '',
          d.sha256 || '',
          d.mirror || '',
          r.internalNote || ''
        ]);
      });
    });
    return CSV.stringify(rows);
  };

  /**
   * CSV 文本 → db
   * 兼容：表头顺序不同（按名称匹配）、缺少可选列、中英文通道/状态
   * 返回 { db, count, warnings[] }
   */
  CSV.toDb = function (text, baseDb) {
    var rows = CSV.parse(text);
    var warnings = [];
    if (!rows.length) return { db: baseDb, count: 0, warnings: ['文件为空'] };

    var header = rows[0].map(function (h) { return String(h).trim(); });
    var idx = function (name) {
      for (var i = 0; i < header.length; i++) {
        if (header[i] === name) return i;
      }
      // 模糊匹配（忽略括号说明）
      for (var j = 0; j < header.length; j++) {
        if (header[j].replace(/[（(].*?[)）]/g, '') === name.replace(/[（(].*?[)）]/g, '')) return j;
      }
      return -1;
    };

    var col = {};
    CSV.HEADERS.forEach(function (h) { col[h] = idx(h); });

    if (col['版本号'] < 0) {
      return { db: baseDb, count: 0, warnings: ['未找到「版本号」列，请检查 CSV 表头是否与模板一致'] };
    }

    var db = baseDb ? VH.deepClone(baseDb) : { meta: {}, projects: [] };
    db.projects = db.projects || [];

    var get = function (row, key) {
      var i = col[key];
      return i >= 0 && i < row.length ? String(row[i] == null ? '' : row[i]).trim() : '';
    };

    var count = 0;
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var version = get(row, '版本号');
      if (!version) { warnings.push('第 ' + (r + 1) + ' 行缺少版本号，已跳过'); continue; }

      var pName = get(row, '项目名称') || VH.defaultProjectName() || '未命名项目';
      var pId = get(row, '项目编号');
      if (!pId) {
        pId = (function () {
          var found = null;
          db.projects.forEach(function (p) { if (p.name === pName) found = p.id; });
          return found || ('p_' + Math.abs(hashCode(pName)).toString(36));
        })();
      }

      var project = null;
      db.projects.forEach(function (p) { if (p.id === pId || (!p.id && p.name === pName)) project = p; });
      if (!project) {
        project = {
          id: pId, name: pName, category: '', owner: '', archived: false, releases: []
        };
        db.projects.push(project);
      }
      project.releases = project.releases || [];

      var dateVal = normalizeDateTime(get(row, '上传日期'));
      if (!dateVal) warnings.push('第 ' + (r + 1) + ' 行日期无效，已置为今天');

      var channelRaw = get(row, '发布通道');
      var statusRaw = get(row, '状态');

      var release = {
        id: VH.uid('rel'),
        version: version,
        screenVersion: get(row, '串口屏版本'),
        date: dateVal || VH.nowLocalDateTime(),
        channel: CSV.CHANNEL_EN[channelRaw] || 'stable',
        status: CSV.STATUS_EN[statusRaw] || 'normal',
        tags: splitList(get(row, '标签')),
        readme: get(row, '版本说明'),
        changelog: splitList(get(row, '更新日志')),
        download: {
          type: 'baidupan',
          url: get(row, '下载链接'),
          password: get(row, '提取码'),
          fileName: get(row, '文件名'),
          fileSize: get(row, '文件大小'),
          sha256: get(row, 'SHA256'),
          mirror: get(row, '镜像链接')
        },
        internalNote: get(row, '备注(仅管理员)')
      };
      if (!release.changelog.length) release.changelog = VH.deriveChangelog(release.readme);

      // 同项目内版本号重复 → 覆盖，避免重复行
      var replaced = false;
      project.releases.forEach(function (old, i) {
        if (old.version === release.version) {
          release.id = old.id;
          project.releases[i] = release;
          replaced = true;
          warnings.push(pName + ' 的 ' + version + ' 已存在，导入时覆盖');
        }
      });
      if (!replaced) project.releases.push(release);
      count++;
    }

    return { db: db, count: count, warnings: warnings };
  };

  function splitList(s) {
    return String(s || '')
      .split(/[;；|]/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  /**
   * 归一化日期时间，支持：
   *   2026-11-24 / 2026/11/24 / 2026.11.24 / 2026年11月24日
   *   2026-11-24 10:30:00 / 2026-11-24T10:30 / 2026/11/24 10:30:05
   *   20261124 / 20261124103000
   *   Excel 序列号 45985 与 45985.4375（小数部分即时分秒）
   * 返回 'YYYY-MM-DDTHH:mm:ss'；不含时间部分时返回 'YYYY-MM-DD'（保留原语义）
   */
  function normalizeDateTime(s) {
    s = String(s || '').trim();
    if (!s) return '';

    // 日期 + 可选时间
    var m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (m) {
      var d = m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
      if (m[4] === undefined) return d;
      return d + 'T' + pad(m[4]) + ':' + pad(m[5] || '0') + ':' + pad(m[6] || '0');
    }

    // 紧凑数字格式
    if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    if (/^\d{14}$/.test(s)) {
      return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) +
        'T' + s.slice(8, 10) + ':' + s.slice(10, 12) + ':' + s.slice(12, 14);
    }

    // Excel 序列日期（小数 = 一天中的比例）
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      var num = parseFloat(s);
      var dt = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
      if (!isNaN(dt.getTime())) {
        var base = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
        if (num % 1 > 1e-6) {
          return base + 'T' + pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes()) + ':' + pad(dt.getUTCSeconds());
        }
        return base;
      }
    }

    // 兜底交给 Date 解析
    var parsed = new Date(s.replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) {
      var b = parsed.getFullYear() + '-' + pad(parsed.getMonth() + 1) + '-' + pad(parsed.getDate());
      if (/\d{1,2}:\d{2}/.test(s)) {
        return b + 'T' + pad(parsed.getHours()) + ':' + pad(parsed.getMinutes()) + ':' + pad(parsed.getSeconds());
      }
      return b;
    }
    return '';
  }

  /** 兼容旧名称 */
  var normalizeDate = normalizeDateTime;

  function pad(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return h;
  }

  /** 生成一份空白模板（含一行示例） */
  CSV.template = function () {
    var rows = [
      CSV.HEADERS.slice(),
      ['金属浴智能温控系统', 'jinshuyu', 'v1.0.0', 'DGUS v1.0.0', VH.nowLocalDateTime().replace('T', ' '), '稳定版', '正常',
        'STM32F407;FreeRTOS', '## 本次更新\n\n- 首版发布', '首版发布',
        'https://pan.baidu.com/s/1xxxxxx', 'ab12', 'firmware_v1.0.0.bin', '486 KB', '', '', '']
    ];
    return CSV.stringify(rows);
  };
})(window);
