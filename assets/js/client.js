/**
 * client.js —— 客户端只读页（按项目名称分组展示）
 *
 * 展示逻辑：
 *   项目名称相同的版本归入同一个「项目组」，组头显示项目名与统计，
 *   组内每个版本单独一行；不同项目依次排列，按「最近发布」优先。
 *
 * 安全：internalNote（仅管理员备注）默认不渲染；仅当登录角色为
 *       admin（后台预览）时才显示。
 */
(function (global) {
  'use strict';
  var VH = global.VH;
  var $ = VH.$;

  var session = null;
  var db = null;
  var expanded = {};          // releaseId -> true
  var filters = {
    keyword: '',
    channel: '',
    tag: '',
    project: '',
    view: 'all',
    showArchived: false
  };

  /* ================= 初始化 ================= */

  function init() {
    VH.initTheme();
    VH.warnIfNotPersistent();

    var cfg = VH.cfg();
    var allowRoles = ['client'];
    if ((cfg.options || {}).allowAdminPreviewClient !== false) allowRoles.push('admin');
    session = VH.auth.require(allowRoles);
    if (!session) return;

    fillChrome(cfg);
    bindEvents();
    reload(false);
  }

  function fillChrome(cfg) {
    var s = cfg.site || {};
    $('#site-name').textContent = s.name || '软件版本中心';
    VH.$$('[data-site-subtitle]').forEach(function (e) { e.textContent = (s.subtitle || '').toUpperCase(); });
    VH.$$('[data-site-footer]').forEach(function (e) { e.textContent = s.footer || ''; });
    document.title = '版本列表 · ' + (s.name || '软件版本中心');

    $('#user-chip').innerHTML =
      '当前：<strong>' + VH.escapeHtml(session.user) + '</strong> ' +
      '<span class="badge badge-' + (session.role === 'admin' ? 'admin' : 'client') + '">' +
      VH.escapeHtml(session.label || session.role) + '</span>';

    if (session.role === 'admin') $('#btn-admin').classList.remove('hide');

    $('#f-channel').innerHTML = '<option value="">全部通道</option>' + VH.optionsHtml(VH.CHANNELS, '');
    $('#f-archived').checked = !!(cfg.options || {}).clientShowArchived;
    filters.showArchived = $('#f-archived').checked;
  }

  function bindEvents() {
    $('#btn-logout').addEventListener('click', function () { VH.auth.logout('index.html'); });
    $('#btn-admin').addEventListener('click', function () { global.location.href = 'admin.html'; });
    $('#btn-refresh').addEventListener('click', function () { reload(true); });

    $('#f-keyword').addEventListener('input', VH.debounce(function (e) {
      filters.keyword = e.target.value.trim();
      renderTable();
    }, 200));

    $('#f-channel').addEventListener('change', function (e) { filters.channel = e.target.value; renderTable(); });
    $('#f-tag').addEventListener('change', function (e) { filters.tag = e.target.value; renderTable(); });
    $('#f-project').addEventListener('change', function (e) { filters.project = e.target.value; renderTable(); });
    $('#f-archived').addEventListener('change', function (e) { filters.showArchived = e.target.checked; renderTable(); });

    VH.$$('#seg-view button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        VH.$$('#seg-view button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        filters.view = btn.getAttribute('data-view');
        renderTable();
      });
    });

    // 事件委托挂在分组容器上，覆盖所有项目组的表格
    $('#groups').addEventListener('click', onTableClick);

    global.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== $('#f-keyword')) {
        e.preventDefault();
        $('#f-keyword').focus();
      }
    });
  }

  /* ================= 数据加载 ================= */

  function reload(force) {
    var btn = $('#btn-refresh');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    VH.store.load({ forceReload: !!force, ignoreDraft: false })
      .then(function (data) {
        db = data;
        renderBanner();
        renderStatus();
        renderSummary();
        renderTagOptions();
        renderProjectOptions();
        renderTable();
        if (force) VH.toast('数据已刷新', 'success');
      })
      .catch(function (err) {
        $('#groups').innerHTML = '';
        showEmpty('数据加载失败', String(err && err.message || err));
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '⟳ 刷新';
      });
  }

  function renderStatus() {
    var el = $('#data-status');
    var dirty = VH.store.isDirty();
    el.textContent = dirty ? '本地草稿数据' : (VH.store.getSource() === 'remote-json' ? '已同步仓库' : '本地文件数据');
    el.className = 'badge ' + (dirty ? 'badge-beta' : 'badge-muted');

    var meta = (db && db.meta) || {};
    $('#updated-at').textContent = meta.updatedAt
      ? '更新于 ' + VH.formatDateTime(meta.updatedAt) + '（' + VH.fromNow(meta.updatedAt) + '）'
      : '';
  }

  function renderBanner() {
    var box = $('#banner-area');
    var html = '';
    var isFile = global.location.protocol === 'file:';

    if (isFile) {
      html += '<div class="alert alert-info" style="margin-bottom:12px">' +
        '<span>ℹ️</span><div><div class="alert-title">本地预览模式</div>' +
        '当前通过双击本地文件打开（file://）。数据来自 <code>data/versions.js</code>；' +
        '部署到 GitHub Pages 后将自动改为读取 <code>data/versions.json</code>。</div></div>';
    }
    if (VH.store.isDirty()) {
      html += '<div class="alert alert-warn" style="margin-bottom:12px">' +
        '<span>⚠️</span><div><div class="alert-title">存在未发布的本地修改</div>' +
        '你看到的是本机后台编辑后的草稿数据，尚未提交到仓库，其他人访问网站看不到这些变化。' +
        '请到后台「导出数据文件」并覆盖仓库中的 <code>data/versions.json</code> 与 <code>data/versions.js</code>。</div></div>';
    }
    box.innerHTML = html;
  }

  /* ================= 概览 / 筛选项 ================= */

  function renderSummary() {
    var st = VH.store.stats(db);
    var items = [
      { label: '项目数', value: st.projects },
      { label: '版本总数', value: st.releases },
      { label: '稳定版', value: st.stable },
      { label: '测试/实验', value: st.beta }
    ];
    if (st.archived) items.push({ label: '已归档/废弃', value: st.archived });

    $('#summary-bar').innerHTML = items.map(function (i) {
      return '<div class="summary-item"><strong>' + i.value + '</strong><span>' + i.label + '</span></div>';
    }).join('');
  }

  function renderTagOptions() {
    var sel = $('#f-tag');
    var cur = filters.tag;
    var tags = VH.store.allTags(db);
    sel.innerHTML = '<option value="">全部标签</option>' + tags.map(function (t) {
      return '<option value="' + VH.escapeHtml(t) + '"' + (t === cur ? ' selected' : '') + '>' + VH.escapeHtml(t) + '</option>';
    }).join('');
  }

  function renderProjectOptions() {
    var sel = $('#f-project');
    var cur = filters.project;
    var projects = (db && db.projects) || [];
    sel.innerHTML = '<option value="">全部项目</option>' + projects.map(function (p) {
      return '<option value="' + VH.escapeHtml(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' +
        VH.escapeHtml(p.name) + '</option>';
    }).join('');
    // 只有一个项目时筛选器没有意义，隐藏以免干扰
    sel.classList.toggle('hide', projects.length < 2);
  }

  /* ================= 过滤 ================= */

  function getRows() {
    var rows = VH.store.flatReleases(db);

    // 「只看最新」：每个项目取排序后的第一条
    if (filters.view === 'latest') {
      var seen = {};
      rows = rows.filter(function (r) {
        if (seen[r.project.id]) return false;
        seen[r.project.id] = true;
        return true;
      });
    }

    var kw = filters.keyword.toLowerCase();

    return rows.filter(function (r) {
      var rel = r.release;

      if (!filters.showArchived && rel.status !== 'normal') return false;
      if (filters.channel && rel.channel !== filters.channel) return false;
      if (filters.tag && (rel.tags || []).indexOf(filters.tag) < 0) return false;
      if (filters.project && r.project.id !== filters.project) return false;

      if (kw) {
        var d = rel.download || {};
        var hay = [
          r.project.name, r.project.category,
          rel.version, rel.screenVersion, rel.date, VH.formatDateValue(rel.date),
          rel.readme, (rel.tags || []).join(' '),
          d.fileName, d.url, VH.channelLabel(rel.channel)
        ].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  /** 把扁平结果按项目归组，保持「最近发布的项目排在前面」 */
  function groupRows(rows) {
    var groups = [];
    var index = {};
    rows.forEach(function (row) {
      var pid = row.project.id;
      if (!index[pid]) {
        index[pid] = { project: row.project, rows: [] };
        groups.push(index[pid]);
      }
      index[pid].rows.push(row);
    });
    return groups;
  }

  /** 每个项目的最新版本 id 集合（用于「最新」徽标） */
  function latestIds() {
    var set = {};
    ((db && db.projects) || []).forEach(function (p) {
      if (p.releases && p.releases.length) set[p.releases[0].id] = true;
    });
    return set;
  }

  /* ================= 列定义（表头与单元格同源，杜绝错位） ================= */

  function clientColumns() {
    var cols = [{ key: 'caret', label: '', cls: 'col-caret', style: 'width:28px' }];
    cols.push({ key: 'version', label: '版本号', style: 'width:118px' });
    if (showScreenCol()) cols.push({ key: 'screen', label: '串口屏', style: 'width:112px', id: 'th-screen' });
    cols.push({ key: 'date', label: '上传时间', style: 'width:136px' });
    cols.push({ key: 'channel', label: '通道', style: 'width:84px' });
    cols.push({ key: 'summary', label: '版本说明' });
    cols.push({ key: 'actions', label: '下载', cls: 'right', style: 'width:186px' });
    return cols;
  }

  function showScreenCol() {
    return (VH.cfg().options || {}).showScreenVersion !== false;
  }

  function buildHeadHtml(cols) {
    return '<tr>' + cols.map(function (c) {
      return '<th' +
        (c.cls ? ' class="' + c.cls + '"' : '') +
        (c.id ? ' id="' + c.id + '"' : '') +
        (c.style ? ' style="' + c.style + '"' : '') +
        '>' + VH.escapeHtml(c.label) + '</th>';
    }).join('') + '</tr>';
  }

  /* ================= 渲染 ================= */

  function renderTable() {
    if (!db) return;

    var rows = getRows();
    var total = VH.store.flatReleases(db).length;
    var groups = groupRows(rows);
    var cols = clientColumns();
    var headHtml = buildHeadHtml(cols);
    var latest = latestIds();

    var shownProjects = ((db && db.projects) || []).length;
    $('#filter-count').textContent =
      '显示 ' + groups.length + ' 个项目 / ' + rows.length + ' 个版本' +
      (rows.length !== total ? '（共 ' + total + ' 个）' : '') +
      (shownProjects > groups.length && rows.length ? ' · 已筛掉 ' + (shownProjects - groups.length) + ' 个项目' : '');

    var container = $('#groups');

    if (!groups.length) {
      container.innerHTML = '';
      if (total === 0) {
        showEmpty('暂无版本数据', '管理员尚未录入任何版本信息。请登录后台（admin）新增第一条记录。');
      } else {
        showEmpty('没有匹配的版本', '试试清除搜索关键词，或勾选「显示已归档」 / 切换到「全部版本」视图。');
      }
      return;
    }
    $('#table-empty').classList.add('hide');

    container.innerHTML = groups.map(function (g, gi) {
      return groupHtml(g, gi, cols, headHtml, latest);
    }).join('');
  }

  /** 单个项目组：组头（项目名 + 统计） + 组内版本表格 */
  function groupHtml(g, gi, cols, headHtml, latest) {
    var p = g.project;
    var allReleases = p.releases || [];
    var newest = allReleases[0];
    var colspan = cols.length;

    var meta = [];
    if (p.category) meta.push('<span>📦 ' + VH.escapeHtml(p.category) + '</span>');
    if (p.owner) meta.push('<span>👤 ' + VH.escapeHtml(p.owner) + '</span>');
    if (newest) {
      meta.push('<span>🚀 最新 ' + VH.escapeHtml(newest.version) + ' · ' +
        VH.escapeHtml(VH.formatDateValue(newest.date)) + '</span>');
    }

    var body = g.rows.map(function (row) {
      var rel = row.release;
      var isOpen = !!expanded[rel.id];
      var isArchived = rel.status !== 'normal';

      return '<tr class="expandable' + (isOpen ? ' expanded' : '') + (isArchived ? ' row-archived' : '') +
          '" data-id="' + rel.id + '">' +
          cols.map(function (c) { return clientCell(c.key, row, latest); }).join('') +
        '</tr>' +
        '<tr class="detail-row' + (isOpen ? '' : ' hide') + '" data-detail="' + rel.id + '">' +
          '<td colspan="' + colspan + '">' + (isOpen ? detailHtml(row) : '') + '</td></tr>';
    }).join('');

    return '<section class="panel project-group" data-project="' + VH.escapeHtml(p.id) + '"' +
        ' style="animation-delay:' + Math.min(gi * 0.05, 0.3).toFixed(2) + 's">' +
      '<div class="group-head">' +
        '<div class="group-heading">' +
          '<h2 class="group-name">' + VH.escapeHtml(p.name) + '</h2>' +
          '<div class="group-meta">' + meta.join('') + '</div>' +
        '</div>' +
        '<div class="group-count" title="本项目版本数">' +
          '<strong>' + g.rows.length + '</strong><span>个版本</span>' +
          (g.rows.length !== allReleases.length
            ? '<em>· 全部 ' + allReleases.length + ' 个</em>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table version-table">' +
          '<thead>' + headHtml + '</thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>' +
    '</section>';
  }

  /** 由列 key 渲染单元格，与 clientColumns() 一一对应 */
  function clientCell(key, row, latest) {
    var rel = row.release;
    var d = rel.download || {};
    switch (key) {
      case 'caret':
        return '<td class="col-caret"><span class="caret">▶</span></td>';
      case 'version':
        return '<td class="col-version" data-label="版本号">' +
          VH.escapeHtml(rel.version) +
          (latest[rel.id] ? ' <span class="badge badge-latest">最新</span>' : '') +
          (rel.status === 'deprecated' ? ' <span class="badge badge-danger">已废弃</span>' : '') +
          (rel.status === 'archived' ? ' <span class="badge badge-muted">已归档</span>' : '') +
        '</td>';
      case 'screen':
        return '<td class="col-screen" data-label="串口屏">' + screenCellHtml(rel.screenVersion) + '</td>';
      case 'date':
        return '<td class="col-date" data-label="日期">' + dateCellHtml(rel.date) + '</td>';
      case 'channel':
        return '<td data-label="通道"><span class="badge badge-' + rel.channel + '">' + VH.channelLabel(rel.channel) + '</span></td>';
      case 'summary':
        return '<td class="col-summary" data-label="说明">' +
          (VH.escapeHtml(VH.plainSummary(rel.readme, (VH.cfg().options || {}).summaryLength || 60)) || '<span class="muted">（无说明）</span>') +
          ((rel.tags && rel.tags.length) ? '<div style="margin-top:4px">' + rel.tags.map(function (t) {
            return '<span class="tag">' + VH.escapeHtml(t) + '</span>';
          }).join('') + '</div>' : '') +
        '</td>';
      case 'actions':
        return '<td class="col-actions right" data-label="下载">' +
          (d.url
            ? '<a class="btn btn-sm btn-primary" href="' + VH.escapeHtml(d.url) + '" target="_blank" rel="noopener noreferrer" data-noexpand="1">⬇ 下载</a> ' +
              (d.password
                ? '<button type="button" class="btn btn-sm" data-copy="' + VH.escapeHtml(d.password) + '" data-noexpand="1" title="复制提取码 ' + VH.escapeHtml(d.password) + '">🔑 提取码</button>'
                : '')
            : '<span class="muted small">无下载链接</span>') +
        '</td>';
      default:
        return '';
    }
  }

  /** 串口屏版本单元格：空值显示占位符，避免误认为漏填 */
  function screenCellHtml(v) {
    return v
      ? '<span class="screen-ver">' + VH.escapeHtml(v) + '</span>'
      : '<span class="screen-none">—</span>';
  }

  /** 日期单元格：日期 + 时间双行显示（老的纯日期数据不显示时间行） */
  function dateCellHtml(v) {
    var p = VH.splitDateValue(v);
    return '<span class="d">' + VH.escapeHtml(p.date) + '</span>' +
      (p.time ? '<span class="t">' + VH.escapeHtml(p.time) + '</span>' : '');
  }

  function detailHtml(row) {
    var rel = row.release;
    var d = rel.download || {};
    var showNote = session && session.role === 'admin';

    var cells = [
      ['版本号', rel.version],
      ['串口屏版本', rel.screenVersion],
      ['上传时间', VH.formatDateValue(rel.date)],
      ['发布通道', VH.channelLabel(rel.channel)],
      ['状态', VH.statusLabel(rel.status)],
      ['文件大小', d.fileSize],
      ['文件名称', d.fileName]
    ];
    if ((VH.cfg().options || {}).showSha256 !== false && d.sha256) cells.push(['SHA256', d.sha256]);
    if (d.mirror) cells.push(['镜像地址', d.mirror]);

    var cellsHtml = cells.filter(function (c) { return c[1]; }).map(function (c) {
      return '<div class="detail-cell"><span class="k">' + c[0] + '</span><span class="v">' + VH.escapeHtml(c[1]) + '</span></div>';
    }).join('');

    var html = '<div class="detail-inner">';

    html += '<div class="download-box">' +
      '<span class="dl-icon">📦</span>' +
      '<div class="dl-info">' +
        '<div class="dl-title">' + VH.escapeHtml(d.fileName || (rel.version + ' 发布包')) + '</div>' +
        '<div class="dl-sub">' +
          (d.url ? '下载源：百度网盘' + (d.fileSize ? ' · 大小：' + VH.escapeHtml(d.fileSize) : '') : '管理员尚未填写下载链接') +
        '</div>' +
      '</div>' +
      (d.password
        ? '<span class="pwd-chip" title="提取码">🔑 ' + VH.escapeHtml(d.password) + '</span>' +
          '<button type="button" class="btn btn-sm" data-copy="' + VH.escapeHtml(d.password) + '">复制提取码</button>'
        : '') +
      (d.url
        ? '<a class="btn btn-sm btn-primary" href="' + VH.escapeHtml(d.url) + '" target="_blank" rel="noopener noreferrer">前往下载 ↗</a>'
        : '') +
    '</div>';

    if (cellsHtml) html += '<div class="detail-grid">' + cellsHtml + '</div>';

    if (rel.changelog && rel.changelog.length) {
      html += '<div style="margin-bottom:14px">' +
        '<div class="detail-section-title">更新日志</div>' +
        '<ul style="margin:0;padding-left:20px;font-size:13px;color:var(--text-2)">' +
        rel.changelog.map(function (c) { return '<li>' + VH.escapeHtml(c) + '</li>'; }).join('') +
        '</ul></div>';
    }

    html += '<div>' +
      '<div class="detail-section-title">README / 版本说明</div>' +
      (rel.readme
        ? '<div class="readme-box md">' + VH.markdown(rel.readme) + '</div>'
        : '<div class="readme-box muted small">该版本未填写说明文档。</div>') +
    '</div>';

    if (showNote && rel.internalNote) {
      html += '<div style="margin-top:14px"><div class="detail-section-title">' +
        '<span class="badge badge-admin">仅管理员可见</span> 内部备注</div>' +
        '<div class="readme-box small" style="border-left:3px solid var(--danger)">' +
        VH.escapeHtml(rel.internalNote) + '</div></div>';
    }

    html += '</div>';
    return html;
  }

  function showEmpty(title, desc) {
    var box = $('#table-empty');
    box.classList.remove('hide');
    box.innerHTML = '<div class="empty-state">' +
      '<div class="empty-icon">🗂</div>' +
      '<div class="empty-title">' + VH.escapeHtml(title) + '</div>' +
      '<div class="empty-desc">' + VH.escapeHtml(desc) + '</div>' +
      '</div>';
  }

  /* ================= 交互 ================= */

  function onTableClick(e) {
    var target = e.target;

    // 复制提取码
    var copyBtn = target.closest ? target.closest('[data-copy]') : null;
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      var pwd = copyBtn.getAttribute('data-copy');
      VH.copyText(pwd).then(function () {
        VH.toast('提取码 ' + pwd + ' 已复制到剪贴板', 'success');
      }).catch(function () {
        VH.toast('复制失败，请手动输入提取码：' + pwd, 'warn');
      });
      return;
    }

    // 链接等不触发展开
    if (target.getAttribute && target.getAttribute('data-noexpand')) return;
    if (target.closest && target.closest('a')) return;

    var tr = target.closest ? target.closest('tr.expandable') : null;
    if (!tr) return;

    var id = tr.getAttribute('data-id');
    // 在同一个项目组内查找详情行，避免跨组误选
    var scope = tr.closest('.project-group') || document;
    var detail = scope.querySelector('tr[data-detail="' + id + '"]');
    if (!detail) return;

    if (expanded[id]) {
      delete expanded[id];
      tr.classList.remove('expanded');
      detail.classList.add('hide');
      detail.querySelector('td').innerHTML = '';
    } else {
      expanded[id] = true;
      tr.classList.add('expanded');
      var row = findRow(id);
      detail.querySelector('td').innerHTML = row ? detailHtml(row) : '';
      detail.classList.remove('hide');
    }
  }

  function findRow(id) {
    var rows = VH.store.flatReleases(db);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].release.id === id) return rows[i];
    }
    return null;
  }

  /* ================= 启动 ================= */

  // Element.closest 兼容（老浏览器）
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (sel) {
      var el = this;
      while (el && el.nodeType === 1) {
        if (el.matches && el.matches(sel)) return el;
        el = el.parentElement;
      }
      return null;
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
