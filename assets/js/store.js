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
      case 'published': return '已提交仓库（Pages 构建中）';
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

  /* ================= 数据文件文本生成 ================= */

  function jsonBody(db) {
    return JSON.stringify(db || state.db || emptyDb(), null, 2);
  }

  /** versions.js 镜像（供 file:// 双击打开时读取） */
  function buildJsMirror(db) {
    return '/**\n' +
      ' * ⚠️ 本文件由程序自动生成，是 data/versions.json 的本地镜像。\n' +
      ' * 用途：让网页在 file:// 协议（双击本地打开）下也能读取数据；\n' +
      ' *       线上（GitHub Pages）优先 fetch data/versions.json。\n' +
      ' * 请勿手工编辑 —— 修改数据请在后台进行，再用「保存到 GitHub」或「导出发布文件」。\n' +
      ' */\n' +
      'window.__SITE_DATA__ = ' + jsonBody(db) + ';\n';
  }

  /* ================= 导出 ================= */

  store.exportJsonText = function () { return jsonBody() + '\n'; };

  store.exportJsText = function () { return buildJsMirror(); };

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

  /* ================= 发布状态 ================= */

  /**
   * 直推成功后调用：清除草稿标记，但保留内存中的数据。
   * 不立刻重新 fetch —— Pages CDN 需要 1~2 分钟才生效，
   * 马上重拉会读到旧内容，让人误以为刚发布的修改丢了。
   */
  store.markPublished = function () {
    VH.storage.remove(DRAFT_KEY);
    state.dirty = false;
    state.source = 'published';
    return state.db;
  };

  /* =========================================================
     GitHub 直推（方案 B）
     ---------------------------------------------------------
     用 Git Data API 做「原子发布」：
         ref → commits(取 tree) → trees → commits → 更新 ref
     一次 commit 同时更新 versions.json 与 versions.js，
     避免用两次 Contents API 造成「json 更新了、js 没更新」的中间态。

     更新 ref 时 force:false —— 若期间有人往仓库推过东西，
     GitHub 会直接拒绝，从而天然实现并发冲突检测，不会覆盖别人的改动。
     ========================================================= */

  var GH_TOKEN_KEY = 'vh.github.token';

  function ghConfig() {
    var g = VH.cfg().github || {};
    var paths = (g.dataPaths && g.dataPaths.length) ? g.dataPaths.slice() : ['data/versions.json', 'data/versions.js'];
    return {
      owner: g.owner || '',
      repo: g.repo || '',
      branch: g.branch || 'main',
      paths: paths,
      jsonPath: paths.filter(function (p) { return /\.json$/i.test(p); })[0] || 'data/versions.json',
      jsPath: paths.filter(function (p) { return /\.js$/i.test(p); })[0] || 'data/versions.js'
    };
  }

  function ghError(status, data, apiPath) {
    var msg = (data && (data.message || data.error)) || ('HTTP ' + status);
    var e = new Error(msg);
    e.status = status;
    e.ghPath = apiPath || '';
    if (status === 401 || status === 403) {
      e.kind = 'auth';
      e.hint = 'Token 无效、已过期或权限不足。请到「⚙ 设置 → GitHub 直推」重新配置：' +
        'Fine-grained token · 仅授权本仓库 · 权限只给 Contents: Read and write';
    } else if (status === 404) {
      e.kind = 'notfound';
      e.hint = '仓库、分支或文件不存在。请检查 config/site.js 中的 github.owner / repo / branch';
    } else if (status === 409 || status === 422) {
      e.kind = 'conflict';
      e.hint = '仓库在你编辑期间被别人更新过（或分支开了保护规则）。' +
        '请点顶栏「⟳ 刷新」重新加载最新数据，合并后再发布，以免覆盖别人的改动。';
    }
    return e;
  }

  function ghNetworkError(cause) {
    var e = new Error('网络请求失败：' + ((cause && cause.message) || cause));
    e.kind = 'network';
    e.hint = '国内访问 api.github.com 可能不稳定。请重试，或改用「导出发布文件」手动上传。';
    return e;
  }

  function ghRequest(apiPath, method, body) {
    var c = ghConfig();
    var token = VH.storage.get(GH_TOKEN_KEY, '');
    if (!token) {
      var noTok = new Error('尚未配置 GitHub Token');
      noTok.kind = 'notoken';
      noTok.hint = '请到「⚙ 设置 → GitHub 直推」填入 Fine-grained Personal Access Token';
      return Promise.reject(noTok);
    }
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('当前环境不支持 fetch，无法直推；请改用「导出发布文件」'));
    }
    var url = 'https://api.github.com/repos/' +
      encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + apiPath;

    // fetch 在某些环境下可能同步抛错，这里兜住，保证永远返回 Promise
    var pending;
    try {
      pending = global.fetch(url, {
        method: method || 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (syncErr) {
      return Promise.reject(ghNetworkError(syncErr));
    }

    return Promise.resolve(pending).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) throw ghError(res.status, data, apiPath);
        return data;
      });
    }, function (netErr) {
      // 必须 throw：若只 return，Promise 会变成 resolved，调用方的 catch 收不到
      throw ghNetworkError(netErr);
    });
  }

  store.github = {
    TOKEN_KEY: GH_TOKEN_KEY,
    config: ghConfig,

    hasToken: function () { return !!VH.storage.get(GH_TOKEN_KEY, ''); },
    getToken: function () { return VH.storage.get(GH_TOKEN_KEY, ''); },
    setToken: function (t) { return VH.storage.set(GH_TOKEN_KEY, String(t || '').trim()); },
    clearToken: function () { VH.storage.remove(GH_TOKEN_KEY); },

    /** 掩码显示，避免 Token 完整出现在屏幕上 */
    maskToken: function (t) {
      t = String(t || '');
      if (t.length <= 18) return t.slice(0, 4) + '****';
      return t.slice(0, 14) + '…' + t.slice(-4);
    },

    /** 是否可一键直推：配置开启 + 已填 Token + owner/repo 齐全 */
    enabled: function () {
      var g = VH.cfg().github || {};
      var c = ghConfig();
      return !!g.enabled && store.github.hasToken() && !!c.owner && !!c.repo;
    },

    /** 校验 Token：能否读取仓库、是否有推送权限 */
    verify: function () {
      return ghRequest('', 'GET').then(function (repo) {
        var perm = (repo && repo.permissions) || {};
        var c = ghConfig();
        return {
          ok: true,
          fullName: (repo && repo.full_name) || (c.owner + '/' + c.repo),
          canPush: !!perm.push,
          isPrivate: !!(repo && repo.private),
          defaultBranch: (repo && repo.default_branch) || c.branch,
          pagesUrl: 'https://' + c.owner + '.github.io/' + c.repo + '/'
        };
      });
    },

    /**
     * 原子发布整份数据到仓库。
     * @param {object} db      要发布的数据（默认取当前内存数据）
     * @param {string} message 提交说明
     * @returns {Promise<{skipped:boolean, commit:?string, tree:string, files:string[], message?:string}>}
     */
    publish: function (db, message) {
      var c = ghConfig();
      if (!c.owner || !c.repo) {
        return Promise.reject(new Error('config/site.js 未配置 github.owner / github.repo'));
      }
      var target = db || state.db;
      if (!target) return Promise.reject(new Error('没有可发布的数据'));

      var files = {};
      files[c.jsonPath] = jsonBody(target) + '\n';
      files[c.jsPath] = buildJsMirror(target);
      var filePaths = Object.keys(files);

      return ghRequest('/git/ref/heads/' + encodeURIComponent(c.branch), 'GET')
        .then(function (ref) {
          if (!ref || !ref.object || !ref.object.sha) throw new Error('读不到分支引用，请确认分支名是否为 ' + c.branch);
          var baseCommit = ref.object.sha;
          return ghRequest('/git/commits/' + baseCommit, 'GET').then(function (commit) {
            if (!commit || !commit.tree) throw new Error('读不到基准提交');
            return { baseCommit: baseCommit, baseTree: commit.tree.sha };
          });
        })
        .then(function (base) {
          var entries = filePaths.map(function (p) {
            return { path: p, mode: '100644', type: 'blob', content: files[p] };
          });
          // base_tree 必传：否则新树只含这两个文件，会把仓库其他文件全删掉
          return ghRequest('/git/trees', 'POST', { base_tree: base.baseTree, tree: entries })
            .then(function (tree) { return { base: base, tree: tree }; });
        })
        .then(function (ctx) {
          // 内容完全没变 → 树哈希相同，跳过，不制造空提交
          if (ctx.tree && ctx.tree.sha === ctx.base.baseTree) {
            return { skipped: true, commit: null, tree: ctx.tree.sha, files: filePaths };
          }
          var msg = message ||
            ('chore(data): 更新版本数据 @ ' + VH.nowIso().slice(0, 16).replace('T', ' '));
          return ghRequest('/git/commits', 'POST', {
            message: msg,
            tree: ctx.tree.sha,
            parents: [ctx.base.baseCommit]
          }).then(function (commit) {
            return ghRequest('/git/refs/heads/' + encodeURIComponent(c.branch), 'PATCH', {
              sha: commit.sha,
              force: false
            }).then(function () {
              return {
                skipped: false,
                commit: commit.sha,
                tree: ctx.tree.sha,
                files: filePaths,
                message: msg
              };
            });
          });
        });
    }
  };
})(window);
