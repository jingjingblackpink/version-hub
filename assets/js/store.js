/**
 * store.js —— 数据层（DataProvider）
 *
 * 数据来源优先级：
 *   1) 浏览器本地草稿（后台编辑后自动保存，未发布前一直优先）
 *   2) fetch data/versions.json      —— http/https 环境（GitHub Pages）
 *   3) window.__SITE_DATA__          —— file:// 本地双击打开时的兜底
 *
 * v1.0 的「发布」= 导出 versions.json + versions.js 覆盖到仓库（方案 A）。
 * M5 阶段将新增 GitHub API 直推（方案 B），本文件已按 DataProvider
 * 抽象预留接口，届时只需追加一个 provider，页面代码无需改动。
 */
(function (global) {
  'use strict';
  var VH = (global.VH = global.VH || {});
  var store = (VH.store = {});

  var DRAFT_KEY = 'vh.data.draft';

  var state = {
    db: null,
    dirty: false,      // 是否存在未发布的本地修改
    source: 'none'     // local-draft | remote-json | embedded-js
  };

  /* ================= 结构规整 ================= */

  function emptyDb() {
    var site = VH.cfg().site || {};
    return {
      meta: {
        schemaVersion: 1,
        updatedAt: VH.nowIso(),
        updatedBy: '',
        siteName: site.name || ''
      },
      projects: []
    };
  }

  function normalize(db) {
    if (!db || typeof db !== 'object') db = emptyDb();
    db.meta = db.meta || {};
    db.meta.schemaVersion = db.meta.schemaVersion || 1;
    db.meta.updatedAt = db.meta.updatedAt || VH.nowIso();
    db.projects = Array.isArray(db.projects) ? db.projects : [];

    db.projects.forEach(function (p) {
      p.id = p.id || VH.uid('p');
      p.name = p.name || '未命名项目';
      p.releases = Array.isArray(p.releases) ? p.releases : [];
      p.releases.forEach(function (r) {
        r.id = r.id || VH.uid('rel');
        r.version = r.version || '';
        r.date = r.date || '';
        r.channel = r.channel || 'stable';
        r.status = r.status || 'normal';
        r.tags = Array.isArray(r.tags)
          ? r.tags
          : String(r.tags || '').split(/[;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
        r.readme = r.readme || '';
        r.screenVersion = r.screenVersion || '';   // 串口屏（DGUS）版本，可为空
        r.changelog = Array.isArray(r.changelog) ? r.changelog : VH.deriveChangelog(r.readme);
        r.internalNote = r.internalNote || '';
        r.download = r.download || {};
        r.download.type = r.download.type || 'baidupan';
        r.download.url = r.download.url || '';
        r.download.password = r.download.password || '';
        r.download.fileName = r.download.fileName || '';
        r.download.fileSize = r.download.fileSize || '';
        r.download.sha256 = r.download.sha256 || '';
        r.download.mirror = r.download.mirror || '';
      });
      sortReleases(p.releases);
    });
    return db;
  }

  function sortReleases(list) {
    list.sort(function (a, b) {
      var da = VH.dateKey(a.date), db = VH.dateKey(b.date);
      if (da && db && da !== db) return da < db ? 1 : -1;
      return VH.versionCompare(b.version, a.version);
    });
  }

  /* ================= 加载 ================= */

  function fetchJson(url) {
    return fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /**
   * 加载数据。
   * @param {object} [opts] { ignoreDraft:false, forceReload:false }
   * @returns {Promise<object>} db
   */
  store.load = function (opts) {
    opts = opts || {};

    if (!opts.forceReload && state.db && !opts.ignoreDraft) {
      return Promise.resolve(state.db);
    }

    // 1) 本地草稿优先
    if (!opts.ignoreDraft) {
      var draft = VH.storage.get(DRAFT_KEY, null);
      if (draft && draft.db) {
        state.db = normalize(draft.db);
        state.dirty = true;
        state.source = 'local-draft';
        return Promise.resolve(state.db);
      }
    }

    // 2) 远程 JSON（部署到 GitHub Pages 后）
    //    注意：必须包在 Promise 里，避免 fetch 缺失/异常时同步抛错
    var isHttp = /^https?:$/.test(global.location.protocol);
    var canFetch = typeof global.fetch === 'function';
    var chain = (isHttp && canFetch)
      ? Promise.resolve()
          .then(function () { return fetchJson('data/versions.json'); })
          .then(function (json) {
            state.db = normalize(json);
            state.dirty = false;
            state.source = 'remote-json';
            return state.db;
          })
      : Promise.reject(new Error(isHttp ? '当前环境无 fetch 能力' : 'file:// 环境跳过 fetch'));

    // 3) 内嵌 JS 兜底
    return chain.catch(function () {
      var embedded = global.__SITE_DATA__;
      if (embedded) {
        state.db = normalize(VH.deepClone(embedded));
        state.dirty = false;
        state.source = 'embedded-js';
        return state.db;
      }
      state.db = normalize(emptyDb());
      state.dirty = false;
      state.source = 'empty';
      return state.db;
    });
  };

  store.getDb = function () { return state.db; };
  store.isDirty = function () { return state.dirty; };
  store.getSource = function () { return state.source; };

  store.sourceLabel = function () {
    switch (state.source) {
      case 'local-draft': return '本地草稿（未发布）';
      case 'remote-json': return '已同步仓库数据';
      case 'embedded-js': return '本地文件数据';
      default: return '空数据';
    }
  };

  /* ================= 写入 ================= */

  function persist(db, byUser) {
    db.meta.updatedAt = VH.nowIso();
    db.meta.updatedBy = byUser || (VH.auth.current() || {}).user || '';
    var site = VH.cfg().site || {};
    db.meta.siteName = site.name || db.meta.siteName || '';
    state.db = db;
    state.dirty = true;
    state.source = 'local-draft';
    VH.storage.set(DRAFT_KEY, { db: db, savedAt: Date.now() });
    return db;
  }

  /** 用回调修改数据并落本地草稿；回调收到深拷贝，需返回该对象 */
  store.mutate = function (fn) {
    var db = VH.deepClone(state.db || emptyDb());
    var result = fn(db) || db;
    return persist(normalize(result));
  };

  /** 直接替换整库（导入时使用） */
  store.replace = function (db) {
    return persist(normalize(VH.deepClone(db)));
  };

  /** 丢弃本地草稿，回到仓库/文件中的数据 */
  store.discardLocal = function () {
    VH.storage.remove(DRAFT_KEY);
    state.db = null;
    state.dirty = false;
    return store.load({ ignoreDraft: true, forceReload: true });
  };

  /* ================= 查询辅助 ================= */

  /** 扁平化为 [{project, release}]，按日期倒序 */
  store.flatReleases = function (db) {
    db = db || state.db || emptyDb();
    var rows = [];
    db.projects.forEach(function (p) {
      (p.releases || []).forEach(function (r) {
        rows.push({ project: p, release: r });
      });
    });
    rows.sort(function (a, b) {
      var da = VH.dateKey(a.release.date), db2 = VH.dateKey(b.release.date);
      if (da !== db2) return da < db2 ? 1 : -1;
      return VH.versionCompare(b.release.version, a.release.version);
    });
    return rows;
  };

  store.findRelease = function (releaseId) {
    var db = state.db || emptyDb();
    for (var i = 0; i < db.projects.length; i++) {
      var p = db.projects[i];
      for (var j = 0; j < (p.releases || []).length; j++) {
        if (p.releases[j].id === releaseId) {
          return { project: p, release: p.releases[j], index: j, projectIndex: i };
        }
      }
    }
    return null;
  };

  store.findProject = function (idOrName) {
    var db = state.db || emptyDb();
    for (var i = 0; i < db.projects.length; i++) {
      if (db.projects[i].id === idOrName || db.projects[i].name === idOrName) return db.projects[i];
    }
    return null;
  };

  /** 确保默认项目存在（单项目模式） */
  store.ensureDefaultProject = function (db) {
    var c = VH.cfg().project || {};
    var id = c.defaultId || 'default';
    var found = null;
    db.projects.forEach(function (p) { if (p.id === id || p.name === c.defaultName) found = p; });
    if (!found) {
      found = {
        id: id,
        name: c.defaultName || '默认项目',
        category: c.defaultCategory || '',
        owner: c.defaultOwner || '',
        archived: false,
        releases: []
      };
      db.projects.push(found);
    }
    return found;
  };

  store.allTags = function (db) {
    var set = {};
    store.flatReleases(db || state.db).forEach(function (row) {
      (row.release.tags || []).forEach(function (t) { if (t) set[t] = true; });
    });
    return Object.keys(set).sort();
  };

  store.stats = function (db) {
    var rows = store.flatReleases(db || state.db);
    var s = { projects: (db || state.db || emptyDb()).projects.length, releases: rows.length, stable: 0, beta: 0, archived: 0 };
    rows.forEach(function (r) {
      if (r.release.channel === 'stable') s.stable++;
      else s.beta++;
      if (r.release.status !== 'normal') s.archived++;
    });
    return s;
  };

  /* ================= 导出 ================= */

  function jsonText(db) {
    return JSON.stringify(db || state.db, null, 2) + '\n';
  }

  store.exportJsonText = function () { return jsonText(); };

  store.exportJsText = function () {
    return (
      '/**\n' +
      ' * ⚠️ 本文件由后台「导出数据文件」自动生成，是 data/versions.json 的本地镜像。\n' +
      ' * 用途：让网页在 file:// （双击本地打开）时也能读取数据。\n' +
      ' * 请勿手工编辑 —— 修改数据请在后台进行，然后重新导出覆盖。\n' +
      ' */\n' +
      'window.__SITE_DATA__ = ' + jsonText() + ';\n'
    );
  };

  store.exportCsvText = function () {
    return VH.csv.fromDb(state.db || emptyDb());
  };

  /** 一次性导出 json + js（发布到仓库用） */
  store.exportBundle = function () {
    VH.download('versions.json', store.exportJsonText(), 'application/json');
    setTimeout(function () {
      VH.download('versions.js', store.exportJsText(), 'application/javascript');
    }, 350);
  };

  /* ================= 导入 ================= */

  store.importJsonText = function (text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
      throw new Error('格式不正确：缺少 projects 数组');
    }
    store.replace(data);
    return store.stats();
  };

  store.importCsvText = function (text) {
    var res = VH.csv.toDb(text, state.db);
    if (!res.count) throw new Error((res.warnings && res.warnings[0]) || '未解析到有效数据行');
    store.replace(res.db);
    return { count: res.count, warnings: res.warnings };
  };

  /* ================= GitHub 直推（M5 预留） ================= */

  store.github = {
    enabled: function () {
      var g = VH.cfg().github || {};
      return !!g.enabled && !!VH.storage.get('vh.github.token', '');
    },
    /** 占位：M5 阶段实现 GET sha → PUT contents */
    publish: function () {
      return Promise.reject(new Error('GitHub 直推尚未启用（M5 阶段），当前请使用「导出数据文件」后上传到仓库。'));
    }
  };
})(window);
