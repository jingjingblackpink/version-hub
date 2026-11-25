/**
 * admin.js —— 后台管理页
 *
 * 数据流：表单 → store（内存 + localStorage 草稿）→ 列表渲染
 * 发布方式（v1.0 / 方案 A）：导出 versions.json + versions.js → 上传覆盖仓库
 * 发布方式（M5 / 方案 B）：GitHub API 直推，当前为占位提示
 */
(function (global) {
  'use strict';
  var VH = global.VH;
  var $ = VH.$;

  var BASE_TITLE = '后台管理 · 软件版本中心';
  var OVERRIDE_KEY = 'vh.cfg.override';
  // 设置结构版本号：结构或默认值发生变更时递增，
  // 让浏览器里遗留的旧设置自动失效，避免覆盖新的默认配置
  var OVERRIDE_SCHEMA = 2;

  var db = null;
  var editingId = null;
  var formDirty = false;   // 表单是否有未保存的输入
  var listFilters = { keyword: '', channel: '', status: '', project: '' };

  /* =========================================================
     初始化
     ========================================================= */

  function init() {
    applyOverrides();
    VH.initTheme();
    VH.warnIfNotPersistent();

    var session = VH.auth.require(['admin']);
    if (!session) return;

    var cfg = VH.cfg();
    $('#site-name').textContent = (cfg.site || {}).name || '软件版本中心';
    document.title = BASE_TITLE = '后台管理 · ' + ((cfg.site || {}).name || '软件版本中心');

    bindStaticEvents();
    initSelects();
    applyUiFlags();
    resetForm();

    VH.store.load({ forceReload: true })
      .then(function (data) {
        db = data;
        renderAll();
      })
      .catch(function (err) {
        VH.toast('数据加载失败：' + err.message, 'error');
      });
  }

  /** 把本机保存的设置覆盖到全局配置 */
  function applyOverrides() {
    var ov = VH.storage.get(OVERRIDE_KEY, null);
    if (!ov || typeof ov !== 'object') return;
    // 旧版本设置（schema 不匹配）直接丢弃，防止历史临时设置压住新的默认值
    if (ov.__schema !== OVERRIDE_SCHEMA) {
      VH.storage.remove(OVERRIDE_KEY);
      return;
    }
    deepMerge(global.__SITE_CONFIG__ || (global.__SITE_CONFIG__ = {}), ov);
  }

  function deepMerge(target, src) {
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object') target[k] = {};
        deepMerge(target[k], v);
      } else {
        target[k] = v;
      }
    });
    return target;
  }

  function opts() { return VH.cfg().options || {}; }
  function projCfg() { return VH.cfg().project || {}; }
  function isMulti() { return !!projCfg().multiProject; }
  function useTime() { return opts().useDateTime !== false; }

  /** 当前时间作为表单默认值（按配置决定是否带时分秒） */
  function nowForInput() {
    return useTime() ? VH.nowLocalDateTime() : VH.today();
  }

  /** 把存储值转成 input 能接受的格式；切换 type 后旧值不会被浏览器丢弃 */
  function toInputValue(v) {
    if (!v) return nowForInput();
    var s = String(v).trim().replace(' ', 'T');
    if (!useTime()) return s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';   // 老的纯日期数据补零点
    return VH.dateKey(s);   // 顺带抹掉浏览器可能带上的 .000 毫秒
  }

  /** 入库前归一：纯日期保持纯日期，带时间则补足到秒 */
  function normalizeInputDate(raw) {
    raw = String(raw || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return VH.dateKey(raw);
  }

  /** 串口屏版本单元格：空值显示占位符，避免误认为漏填 */
  function screenCellHtml(v) {
    return v
      ? '<span class="screen-ver">' + VH.escapeHtml(v) + '</span>'
      : '<span class="screen-none">—</span>';
  }

  /** 表格日期单元格：日期 + 时间双行显示 */
  function dateCellHtml(v) {
    var p = VH.splitDateValue(v);
    return '<span class="d">' + VH.escapeHtml(p.date) + '</span>' +
      (p.time ? '<span class="t">' + VH.escapeHtml(p.time) + '</span>' : '');
  }

  function initSelects() {
    $('#f-channel').innerHTML = VH.optionsHtml(VH.CHANNELS, 'stable');
    $('#f-status').innerHTML = VH.optionsHtml(VH.STATUSES, 'normal');
    $('#l-channel').innerHTML = '<option value="">全部通道</option>' + VH.optionsHtml(VH.CHANNELS, '');
    $('#l-status').innerHTML = '<option value="">全部状态</option>' + VH.optionsHtml(VH.STATUSES, '');
  }

  /** 根据配置显示/隐藏相关字段 */
  function applyUiFlags() {
    var o = opts();
    $('#field-project').classList.toggle('hide', !isMulti());
    $('#l-project').classList.toggle('hide', !isMulti());
    $('#field-sha').classList.toggle('hide', o.showSha256 === false);
    $('#field-mirror').classList.toggle('hide', !o.showMirror);
    // 串口屏版本：这里只管表单字段；表格列由 adminColumns() 统一增删，
    // 避免「表头显隐」与「单元格显隐」两处逻辑走偏导致错位
    $('#field-screen').classList.toggle('hide', o.showScreenVersion === false);

    // 上传时间：精确到秒（datetime-local）或仅日期（date）
    var dateEl = $('#f-date');
    if (o.useDateTime === false) {
      dateEl.type = 'date';
      dateEl.removeAttribute('step');
      $('#f-date-label').textContent = '上传日期';
      $('#date-hint').textContent = '默认今天，可手动修改；不能晚于今天';
    } else {
      dateEl.type = 'datetime-local';
      dateEl.setAttribute('step', '1');   // step=1 才会显示「秒」
      $('#f-date-label').textContent = '上传日期时间';
      $('#date-hint').textContent = '默认填入当前时间（精确到秒），可手动修改；不能晚于此刻';
    }
    // 切换 type 会清空不匹配的 value，这里补回默认值
    if (!dateEl.value) dateEl.value = nowForInput();

    if (isMulti()) {
      var p = VH.store.findProject(projCfg().defaultId) || (db && db.projects && db.projects[0]);
      // 仅在为空时预填：避免每次重绘都把用户正在输入的项目名覆盖掉
      if (!$('#f-project').value) {
        $('#f-project').value = p ? p.name : (projCfg().defaultName || '');
      }
      $('#project-list').innerHTML = ((db && db.projects) || []).map(function (x) {
        return '<option value="' + VH.escapeHtml(x.name) + '">';
      }).join('');
      $('#l-project').innerHTML = '<option value="">全部项目</option>' + ((db && db.projects) || []).map(function (x) {
        return '<option value="' + VH.escapeHtml(x.id) + '">' + VH.escapeHtml(x.name) + '</option>';
      }).join('');
    }
  }

  /* =========================================================
     渲染
     ========================================================= */

  function renderAll() {
    renderBanner();
    renderStatus();
    renderStats();
    renderList();
    applyUiFlags();
    // 数据变化后，若不在编辑态且用户未手动输入，刷新「建议的下一个版本号」
    if (!editingId && !formDirty) {
      var suggested = suggestNextVersion();
      var cur = $('#f-version').value.trim();
      if (!cur || /^v?\d+(\.\d+)*$/.test(cur)) $('#f-version').value = suggested;
    }
    updateVersionHint();
  }

  function renderStatus() {
    var el = $('#data-status');
    var dirty = VH.store.isDirty();
    el.textContent = dirty ? '● 有未发布修改' : '已发布状态';
    el.className = 'badge ' + (dirty ? 'badge-beta' : 'badge-stable');
    VH.markTitleDirty(dirty, BASE_TITLE);
  }

  function renderBanner() {
    var html = '';
    var isFile = global.location.protocol === 'file:';

    if (isFile) {
      html += '<div class="alert alert-info" style="margin-bottom:12px"><span>💻</span><div>' +
        '<div class="alert-title">本地开发模式（file://）</div>' +
        '所有修改保存在<strong>本机浏览器草稿</strong>中，刷新不会丢失。' +
        '要发布到网站：点右上「导出 → 导出发布文件」，把得到的 <code>versions.json</code> 和 <code>versions.js</code> ' +
        '一起覆盖到仓库的 <code>data/</code> 目录即可。</div></div>';
    } else if (VH.store.isDirty()) {
      html += '<div class="alert alert-warn" style="margin-bottom:12px"><span>⚠️</span><div>' +
        '<div class="alert-title">本机存在未发布的修改</div>' +
        '其他人访问网站仍看到旧数据。请点「导出 → 导出发布文件」并覆盖仓库中的两个数据文件。</div></div>';
    }
    $('#banner-area').innerHTML = html;

    var meta = (db && db.meta) || {};
    $('#meta-tip').textContent = meta.updatedAt
      ? '数据最后更新：' + VH.formatDateTime(meta.updatedAt) + (meta.updatedBy ? '（by ' + meta.updatedBy + '）' : '')
      : '';
    $('#dirty-tip').innerHTML = VH.store.isDirty()
      ? '<strong style="color:var(--warn)">● 草稿未发布</strong> — 记得导出上传'
      : '✓ 与仓库数据一致';
  }

  function renderStats() {
    var st = VH.store.stats(db);
    var latest = latestRelease();
    var cards = [];
    if (isMulti()) cards.push(card('项目数', st.projects, ''));
    cards.push(card('版本总数', st.releases, '稳定版 ' + st.stable + ' · 测试/实验 ' + st.beta, true));
    cards.push(card('最新版本', latest ? latest.version : '—', latest ? VH.formatDateValue(latest.date) : '暂无数据'));
    cards.push(card('已归档/废弃', st.archived, st.archived ? '客户端默认隐藏' : '无'));
    cards.push(card('缺下载链接', countMissingLink(), countMissingLink() ? '需要补全' : '全部已填写'));

    $('#stat-row').innerHTML = cards.join('');

    function card(label, value, sub, accent) {
      return '<div class="stat-card' + (accent ? ' accent' : '') + '">' +
        '<div class="stat-label">' + label + '</div>' +
        '<div class="stat-value">' + VH.escapeHtml(String(value)) + '</div>' +
        '<div class="stat-sub">' + VH.escapeHtml(sub || '') + '</div></div>';
    }
  }

  function countMissingLink() {
    return VH.store.flatReleases(db).filter(function (r) {
      return !(r.release.download && r.release.download.url);
    }).length;
  }

  function latestRelease() {
    var rows = VH.store.flatReleases(db);
    return rows.length ? rows[0].release : null;
  }

  /* ---------- 列表 ---------- */

  function renderList() {
    var rows = VH.store.flatReleases(db);
    var total = rows.length;
    var kw = listFilters.keyword.toLowerCase();
    // 表头与数据行共用同一份列定义，保证永远对齐（即使 0 行也要渲染表头）
    var cols = adminColumns();
    renderHead(cols);

    rows = rows.filter(function (r) {
      var rel = r.release;
      if (listFilters.channel && rel.channel !== listFilters.channel) return false;
      if (listFilters.status && rel.status !== listFilters.status) return false;
      if (isMulti() && listFilters.project && r.project.id !== listFilters.project) return false;
      if (kw) {
        var d = rel.download || {};
        var hay = [rel.version, rel.screenVersion, rel.date, VH.formatDateValue(rel.date), rel.readme, (rel.tags || []).join(' '),
          d.fileName, d.url, d.password, r.project.name].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });

    $('#list-count').textContent = '共 ' + total + ' 条' + (rows.length !== total ? '，筛出 ' + rows.length + ' 条' : '');

    var tbody = $('#admin-tbody');
    if (!rows.length) {
      tbody.innerHTML = '';
      var box = $('#admin-empty');
      box.classList.remove('hide');
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>' +
        '<div class="empty-title">' + (total ? '没有匹配的记录' : '还没有任何版本') + '</div>' +
        '<div class="empty-desc">' + (total
          ? '调整搜索关键词或筛选条件试试。'
          : '在左侧表单填写第一条版本信息，或点「导入 → 导入 CSV」批量导入历史台账。') +
        '</div></div>';
      return;
    }
    $('#admin-empty').classList.add('hide');

    tbody.innerHTML = rows.map(function (r) {
      var rel = r.release;
      var isEditing = rel.id === editingId;

      return '<tr class="' + (isEditing ? 'row-editing ' : '') + (rel.status !== 'normal' ? 'row-archived' : '') + '" data-id="' + rel.id + '">' +
        cols.map(function (c) { return adminCell(c.key, r); }).join('') +
      '</tr>';
    }).join('');
  }

  /**
   * ★ 列定义（唯一真源）
   * 表头 <th> 与单元格 <td> 都由这份数组生成，从结构上杜绝
   * 「HTML 写死的表头」与「JS 生成的列」不同步导致的错位。
   * 以后增删列 / 控制显隐，只改这一处即可。
   */
  function adminColumns() {
    var cols = [];
    if (isMulti()) cols.push({ key: 'project', label: '项目', id: 'th-project' });
    cols.push({ key: 'version', label: '版本号', style: 'width:112px' });
    if (opts().showScreenVersion !== false) {
      cols.push({ key: 'screen', label: '串口屏', style: 'width:112px', id: 'th-screen' });
    }
    cols.push({ key: 'date', label: '上传时间', style: 'width:132px' });
    cols.push({ key: 'channel', label: '通道', style: 'width:78px' });
    cols.push({ key: 'status', label: '状态', style: 'width:78px' });
    cols.push({ key: 'file', label: '文件 / 链接', cls: 'col-file' });
    cols.push({ key: 'actions', label: '操作', cls: 'col-actions', style: 'width:196px' });
    return cols;
  }

  /** 由列定义渲染表头 */
  function renderHead(cols) {
    $('#admin-thead').innerHTML = '<tr>' + cols.map(function (c) {
      return '<th' +
        (c.cls ? ' class="' + c.cls + '"' : '') +
        (c.id ? ' id="' + c.id + '"' : '') +
        (c.style ? ' style="' + c.style + '"' : '') +
        '>' + VH.escapeHtml(c.label) + '</th>';
    }).join('') + '</tr>';
  }

  /** 由列 key 渲染单元格，与 adminColumns() 一一对应 */
  function adminCell(key, r) {
    var rel = r.release;
    var d = rel.download || {};
    switch (key) {
      case 'project':
        return '<td>' + VH.escapeHtml(r.project.name) + '</td>';
      case 'version':
        return '<td class="col-version">' + VH.escapeHtml(rel.version) + '</td>';
      case 'screen':
        return '<td class="col-screen">' + screenCellHtml(rel.screenVersion) + '</td>';
      case 'date':
        return '<td class="col-date">' + dateCellHtml(rel.date) + '</td>';
      case 'channel':
        return '<td><span class="badge badge-' + rel.channel + '">' + VH.channelLabel(rel.channel) + '</span></td>';
      case 'status':
        return '<td>' + statusBadge(rel.status) + '</td>';
      case 'file':
        return '<td class="col-file">' +
          (d.url
            ? '<span class="link-ok">🔗</span> ' + VH.escapeHtml(d.fileName || '已配置网盘链接') +
              (d.password ? ' <span class="tag">码 ' + VH.escapeHtml(d.password) + '</span>' : '')
            : '<span class="link-missing">✕ 未配置下载链接</span>') +
        '</td>';
      case 'actions':
        return '<td class="col-actions"><div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-act="edit" data-id="' + rel.id + '">编辑</button>' +
          '<button type="button" class="btn btn-sm" data-act="dup" data-id="' + rel.id + '" title="以此版本为模板新建">复制</button>' +
          '<button type="button" class="btn btn-sm" data-act="archive" data-id="' + rel.id + '">' +
            (rel.status === 'normal' ? '归档' : '恢复') + '</button>' +
          '<button type="button" class="btn btn-sm btn-danger" data-act="del" data-id="' + rel.id + '">删除</button>' +
        '</div></td>';
      default:
        return '';
    }
  }

  function statusBadge(s) {
    if (s === 'archived') return '<span class="badge badge-muted">已归档</span>';
    if (s === 'deprecated') return '<span class="badge badge-danger">已废弃</span>';
    return '<span class="badge badge-stable">正常</span>';
  }

  /* =========================================================
     表单
     ========================================================= */

  function resetForm() {
    editingId = null;
    formDirty = false;
    $('#release-form').reset();
    $('#f-date').value = nowForInput();
    $('#f-channel').value = 'stable';
    $('#f-status').value = 'normal';
    $('#f-version').value = suggestNextVersion();
    if (isMulti()) {
      var p = VH.store.findProject(projCfg().defaultId) || (db && db.projects && db.projects[0]);
      $('#f-project').value = p ? p.name : (projCfg().defaultName || '');
    }
    $('#form-mode-text').textContent = '新增版本';
    $('#form-mode-icon').textContent = '✏️';
    $('#form-mode-badge').classList.add('hide');
    $('#btn-cancel-edit').classList.add('hide');
    $('#btn-save').innerHTML = '💾 保存版本';
    $('#readme-preview').classList.add('hide');
    clearErrors();
    updateVersionHint();
    renderList();
  }

  function suggestNextVersion() {
    var latest = latestRelease();
    if (!latest) return 'v1.0.0';
    return bumpVersion(latest.version);
  }

  function bumpVersion(v) {
    var raw = String(v || '').trim();
    var prefix = /^[vV]/.test(raw) ? raw.charAt(0) : '';
    var body = raw.replace(/^[vV]/, '');
    var parts = body.split('.');
    for (var i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {
        parts[i] = String(parseInt(parts[i], 10) + 1);
        return prefix + parts.join('.');
      }
    }
    return prefix + (body ? body + '.1' : '1.0.0');
  }

  function updateVersionHint() {
    var latest = latestRelease();
    $('#version-hint').textContent = latest
      ? '当前最新版本：' + latest.version + '（' + VH.formatDateValue(latest.date) + '）　建议格式 v主.次.修订'
      : '还没有版本记录，建议从 v1.0.0 开始';
  }

  function fillForm(rel) {
    var d = rel.download || {};
    $('#f-version').value = rel.version || '';
    $('#f-screen').value = rel.screenVersion || '';
    $('#f-date').value = toInputValue(rel.date);
    $('#f-channel').value = rel.channel || 'stable';
    $('#f-status').value = rel.status || 'normal';
    $('#f-tags').value = (rel.tags || []).join(';');
    $('#f-readme').value = rel.readme || '';
    $('#f-url').value = d.url || '';
    $('#f-password').value = d.password || '';
    $('#f-filename').value = d.fileName || '';
    $('#f-filesize').value = d.fileSize || '';
    $('#f-sha256').value = d.sha256 || '';
    $('#f-mirror').value = d.mirror || '';
    $('#f-note').value = rel.internalNote || '';
    updatePreview();
  }

  function collectForm() {
    var tags = $('#f-tags').value.split(/[;；,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var readme = $('#f-readme').value;
    return {
      version: $('#f-version').value.trim(),
      screenVersion: $('#f-screen').value.trim(),
      date: normalizeInputDate($('#f-date').value),
      channel: $('#f-channel').value,
      status: $('#f-status').value,
      tags: tags,
      readme: readme,
      changelog: VH.deriveChangelog(readme),
      download: {
        type: 'baidupan',
        url: $('#f-url').value.trim(),
        password: $('#f-password').value.trim(),
        fileName: $('#f-filename').value.trim(),
        fileSize: $('#f-filesize').value.trim(),
        sha256: $('#f-sha256').value.trim(),
        mirror: $('#f-mirror').value.trim()
      },
      internalNote: $('#f-note').value
    };
  }

  /* ---------- 校验 ---------- */

  function clearErrors() {
    VH.$$('#release-form .field').forEach(function (f) { f.classList.remove('invalid'); });
  }
  function markInvalid(inputId) {
    var el = $(inputId);
    var field = el.closest('.field');
    if (field) field.classList.add('invalid');
    el.focus();
  }

  function validate(data) {
    clearErrors();

    if (!data.version) { markInvalid('#f-version'); VH.toast('请填写版本号', 'error'); return false; }

    // 同项目内版本号查重
    var projectName = isMulti() ? $('#f-project').value.trim() : projCfg().defaultName;
    var dup = VH.store.flatReleases(db).some(function (r) {
      if (r.release.id === editingId) return false;
      if (isMulti() && r.project.name !== projectName) return false;
      return r.release.version.toLowerCase() === data.version.toLowerCase();
    });
    if (dup) {
      markInvalid('#f-version');
      VH.toast('版本号 ' + data.version + ' 已存在，请更换', 'error');
      return false;
    }

    if (!data.date) { markInvalid('#f-date'); VH.toast('请选择上传日期时间', 'error'); return false; }
    if (VH.isFutureDateTime(data.date)) {
      markInvalid('#f-date');
      VH.toast('上传时间不能晚于当前时刻', 'error');
      return false;
    }

    if (isMulti() && !projectName) { markInvalid('#f-project'); VH.toast('请填写项目名称', 'error'); return false; }

    if (opts().requireBaiduPan && data.download.url && !VH.isBaiduPan(data.download.url)) {
      markInvalid('#f-url');
      VH.toast('已开启「强制百度网盘域名」，链接必须以 https://pan.baidu.com/ 开头', 'error');
      return false;
    }

    return true;
  }

  /* ---------- 保存 ---------- */

  function onSubmit(e) {
    e.preventDefault();
    var data = collectForm();
    if (!validate(data)) return;

    // 软提醒：链接 / 提取码缺失
    if (!data.download.url) {
      if (!VH.confirm('下载链接为空，客户端将显示「无下载链接」。确定继续保存吗？')) return;
    } else if (!data.download.password) {
      if (!VH.confirm('未填写提取码，客户可能需要手动询问。确定继续保存吗？')) return;
    }

    var projectName = isMulti() ? $('#f-project').value.trim() : (projCfg().defaultName || '默认项目');
    var projectId = isMulti() ? '' : (projCfg().defaultId || 'default');
    var isNew = !editingId;
    var keepId = editingId;

    try {
      db = VH.store.mutate(function (d) {
        var project;
        if (isMulti()) {
          project = null;
          d.projects.forEach(function (p) { if (p.name === projectName) project = p; });
          if (!project) {
            project = {
              id: 'p_' + Math.abs(hash(projectName)).toString(36),
              name: projectName, category: projCfg().defaultCategory || '',
              owner: projCfg().defaultOwner || '', archived: false, releases: []
            };
            d.projects.push(project);
          }
        } else {
          project = VH.store.ensureDefaultProject(d);
          project.name = projectName;
        }

        project.releases = project.releases || [];

        if (isNew) {
          data.id = VH.uid('rel');
          project.releases.push(data);
        } else {
          data.id = keepId;
          var found = false;
          d.projects.forEach(function (p) {
            (p.releases || []).forEach(function (r, i) {
              if (r.id === keepId) { p.releases[i] = data; found = true; }
            });
          });
          if (!found) project.releases.push(data);
        }
        return d;
      });
    } catch (err) {
      VH.toast('保存失败：' + err.message, 'error');
      return;
    }

    VH.toast(isNew ? '已新增 ' + data.version + '（本机草稿）' : '已更新 ' + data.version + '（本机草稿）', 'success');
    resetForm();
    renderAll();
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
  }

  /* ---------- 编辑 / 复制 / 删除 / 归档 ---------- */

  function editRelease(id) {
    var found = VH.store.findRelease(id);
    if (!found) return;
    editingId = id;
    formDirty = false;
    if (isMulti()) $('#f-project').value = found.project.name;
    fillForm(found.release);
    $('#form-mode-text').textContent = '编辑版本 ' + found.release.version;
    $('#form-mode-icon').textContent = '📝';
    $('#form-mode-badge').classList.remove('hide');
    $('#btn-cancel-edit').classList.remove('hide');
    $('#btn-save').innerHTML = '💾 保存修改';
    clearErrors();
    renderList();
    global.scrollTo({ top: 0, behavior: 'smooth' });
    $('#f-version').focus();
  }

  function duplicateRelease(id) {
    var found = VH.store.findRelease(id);
    if (!found) return;
    editingId = null;
    fillForm(found.release);
    $('#f-version').value = bumpVersion(found.release.version);
    $('#f-date').value = nowForInput();
    $('#f-status').value = 'normal';
    $('#f-note').value = '';
    $('#form-mode-text').textContent = '基于 ' + found.release.version + ' 新建';
    $('#form-mode-icon').textContent = '🧬';
    $('#form-mode-badge').classList.add('hide');
    $('#btn-cancel-edit').classList.remove('hide');
    $('#btn-save').innerHTML = '💾 保存版本';
    clearErrors();
    renderList();
    global.scrollTo({ top: 0, behavior: 'smooth' });
    VH.toast('已复制为模板，请修改版本号后保存', 'info');
    $('#f-version').select();
  }

  function toggleArchive(id) {
    var found = VH.store.findRelease(id);
    if (!found) return;
    var next = found.release.status === 'normal' ? 'archived' : 'normal';
    db = VH.store.mutate(function (d) {
      d.projects.forEach(function (p) {
        (p.releases || []).forEach(function (r) { if (r.id === id) r.status = next; });
      });
      return d;
    });
    VH.toast(next === 'archived' ? '已归档，客户端默认不再显示' : '已恢复为正常状态', 'success');
    renderAll();
  }

  function removeRelease(id) {
    var found = VH.store.findRelease(id);
    if (!found) return;
    if (!VH.confirm('确定删除 ' + found.project.name + ' 的 ' + found.release.version + ' 吗？\n\n删除后可通过「丢弃本机草稿」撤销（发布后不可撤销）。')) return;
    db = VH.store.mutate(function (d) {
      d.projects.forEach(function (p) {
        p.releases = (p.releases || []).filter(function (r) { return r.id !== id; });
      });
      return d;
    });
    if (editingId === id) resetForm();
    VH.toast('已删除 ' + found.release.version, 'success');
    renderAll();
  }

  /* =========================================================
     导入 / 导出
     ========================================================= */

  function exportBundle() {
    VH.store.exportBundle();
    VH.toast('已导出 versions.json 与 versions.js', 'success');
    setTimeout(openPublishGuide, 500);
  }

  function openPublishGuide() {
    var g = VH.cfg().github || {};
    var repoPath = (g.owner ? g.owner + '/' : '<你的用户名>/') + (g.repo || 'version-hub');
    showInfo('如何发布到网站？',
      '<div class="alert alert-info" style="margin-bottom:14px"><span>📤</span><div>' +
      '本站是纯静态网站，<strong>数据文件就是数据库</strong>。把导出的两个文件覆盖到仓库，网站自动更新。</div></div>' +
      '<ol class="guide-steps">' +
      '<li>点击右上「导出 → 导出发布文件」，浏览器会下载 <code>versions.json</code> 和 <code>versions.js</code></li>' +
      '<li>打开 GitHub 仓库 <code>' + VH.escapeHtml(repoPath) + '</code> 的 <code>data</code> 目录</li>' +
      '<li>点 <code>Add file → Upload files</code>，把两个文件拖进去，滚动到底部点 <code>Commit changes</code></li>' +
      '<li>等待 1~2 分钟 GitHub Pages 重新构建，刷新客户端页面即可看到最新数据</li>' +
      '</ol>' +
      '<div class="alert" style="margin-top:14px"><span>💡</span><div>' +
      '<div class="alert-title">小提示</div>' +
      '· 两个文件必须<strong>一起</strong>上传：<code>versions.json</code> 供线上使用，<code>versions.js</code> 供本地双击预览使用<br>' +
      '· 不想每次上传？M5 阶段将支持配置 Token 后「一键保存到 GitHub」<br>' +
      '· 上传前建议先导出一份 JSON 作为本地备份</div></div>' +
      '<div class="alert alert-warn" style="margin-top:12px"><span>⚠️</span><div>' +
      '当前页面的修改仅保存在<strong>本机浏览器草稿</strong>中。换电脑或清除浏览器数据前，请务必先导出备份。</div></div>'
    );
  }

  function doExportCsv() {
    VH.downloadCsv('versions_' + VH.today() + '.csv', VH.store.exportCsvText());
    VH.toast('CSV 已导出，可用 Excel 打开编辑', 'success');
  }

  function doCsvTemplate() {
    VH.downloadCsv('版本信息导入模板.csv', VH.csv.template());
    VH.toast('模板已下载，按列填写后从「导入 CSV」上传', 'success');
  }

  function onImportJson(file) {
    VH.readFileAsText(file).then(function (text) {
      var st = VH.store.importJsonText(text);
      db = VH.store.getDb();
      resetForm();
      renderAll();
      VH.toast('导入成功：' + st.projects + ' 个项目，' + st.releases + ' 个版本', 'success');
    }).catch(function (err) {
      VH.toast('导入失败：' + err.message, 'error');
    });
  }

  function onImportCsv(file) {
    VH.readFileAsText(file).then(function (text) {
      var res = VH.store.importCsvText(text);
      db = VH.store.getDb();
      resetForm();
      renderAll();
      VH.toast('CSV 导入成功：' + res.count + ' 条记录', 'success');
      if (res.warnings && res.warnings.length) {
        showInfo('导入完成（有 ' + res.warnings.length + ' 条提示）',
          '<p class="small muted">共导入 <strong>' + res.count + '</strong> 条记录。以下是处理过程中的提示：</p>' +
          '<ul class="guide-steps" style="max-height:300px;overflow:auto">' +
          res.warnings.slice(0, 60).map(function (w) { return '<li>' + VH.escapeHtml(w) + '</li>'; }).join('') +
          '</ul>' +
          (res.warnings.length > 60 ? '<p class="small muted">…仅显示前 60 条</p>' : ''));
      }
    }).catch(function (err) {
      VH.toast('CSV 导入失败：' + err.message, 'error');
    });
  }

  /* =========================================================
     设置
     ========================================================= */

  function openSettings() {
    var c = VH.cfg();
    $('#s-name').value = (c.site || {}).name || '';
    $('#s-subtitle').value = (c.site || {}).subtitle || '';
    $('#s-pname').value = (c.project || {}).defaultName || '';
    $('#s-pid').value = (c.project || {}).defaultId || '';
    $('#s-pcat').value = (c.project || {}).defaultCategory || '';
    $('#s-multi').checked = !!(c.project || {}).multiProject;
    $('#s-screen').checked = (c.options || {}).showScreenVersion !== false;
    $('#s-sha').checked = (c.options || {}).showSha256 !== false;
    $('#s-mirror').checked = !!(c.options || {}).showMirror;
    $('#s-baidu').checked = !!(c.options || {}).requireBaiduPan;
    openModal('modal-settings');
  }

  function saveSettings() {
    var oldName = projCfg().defaultName;
    var oldId = projCfg().defaultId;
    var newName = $('#s-pname').value.trim();
    var newId = $('#s-pid').value.trim().replace(/\s+/g, '');

    var ov = {
      __schema: OVERRIDE_SCHEMA,
      site: { name: $('#s-name').value.trim(), subtitle: $('#s-subtitle').value.trim() },
      project: {
        defaultName: newName,
        defaultId: newId || oldId,
        defaultCategory: $('#s-pcat').value.trim(),
        multiProject: $('#s-multi').checked
      },
      options: {
        showScreenVersion: $('#s-screen').checked,
        showSha256: $('#s-sha').checked,
        showMirror: $('#s-mirror').checked,
        requireBaiduPan: $('#s-baidu').checked
      }
    };

    VH.storage.set(OVERRIDE_KEY, ov);
    applyOverrides();

    // 站点名同步到数据 meta
    $('#site-name').textContent = ov.site.name || '软件版本中心';
    document.title = BASE_TITLE = '后台管理 · ' + (ov.site.name || '软件版本中心');

    // 默认项目改名 → 同步数据中的项目（仅单项目模式下自动改名）
    if (db && !isMulti() && db.projects.length) {
      var changed = (newName && newName !== oldName) || (newId && newId !== oldId);
      if (changed) {
        db = VH.store.mutate(function (d) {
          var p = d.projects[0];
          if (newName) p.name = newName;
          if (newId) p.id = newId;
          if (ov.project.defaultCategory) p.category = ov.project.defaultCategory;
          return d;
        });
      }
    }

    closeModal('modal-settings');
    resetForm();
    renderAll();
    VH.toast('设置已保存（本机生效；如需全站生效请同步修改 config/site.js）', 'success');
  }

  function discardDraft() {
    if (!VH.confirm('确定丢弃本机草稿吗？\n\n将恢复到仓库/文件中的数据，本机未发布的修改会全部丢失。')) return;
    VH.store.discardLocal().then(function (data) {
      db = data;
      resetForm();
      renderAll();
      VH.toast('已恢复到已发布数据', 'success');
    });
  }

  function clearAll() {
    if (!VH.confirm('⚠ 确定清空全部数据吗？\n\n这将删除所有项目与版本记录！\n强烈建议先点「导出」备份。\n\n（清空后仍可用「丢弃本机草稿」恢复）')) return;
    if (!VH.confirm('再次确认：真的要清空所有版本记录吗？')) return;
    db = VH.store.mutate(function (d) { d.projects = []; return d; });
    resetForm();
    renderAll();
    VH.toast('已清空全部数据（草稿状态，可撤销）', 'warn');
  }

  /* =========================================================
     弹窗 / 菜单
     ========================================================= */

  function openModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) { $('#' + id).hidden = true; }

  function showInfo(title, html) {
    $('#info-title').textContent = title;
    $('#info-body').innerHTML = html;
    openModal('modal-info');
  }

  function toggleMenu(menuId, btn) {
    var menu = $('#' + menuId);
    var willShow = menu.hidden;
    closeAllMenus();
    menu.hidden = !willShow;
  }
  function closeAllMenus() {
    VH.$$('.dropdown-menu').forEach(function (m) { m.hidden = true; });
  }

  function openGithubDialog() {
    var g = VH.cfg().github || {};
    showInfo('保存到 GitHub（M5 阶段功能）',
      '<div class="alert alert-warn" style="margin-bottom:14px"><span>🚧</span><div>' +
      '<div class="alert-title">一键直推功能尚未启用</div>' +
      '当前处于<strong>本地开发阶段（M1~M4）</strong>，数据保存采用「导出文件 + 手动上传」的方案 A 通路，' +
      '功能完整可正常使用。M5 阶段会加入 GitHub API 直推，届时这里会变成真正的一键保存。</div></div>' +
      '<div class="alert alert-info" style="margin-bottom:14px"><span>✅</span><div>' +
      '<div class="alert-title">现在怎么发布？</div>' +
      '点「导出 → 导出发布文件」下载两个文件，上传到仓库 <code>data/</code> 目录即可，约 1 分钟完成。</div></div>' +
      '<p class="small muted" style="margin-bottom:6px">M5 阶段将实现的直推配置（当前 <code>config/site.js</code> 中）：</p>' +
      '<table class="table" style="font-size:12.5px"><tbody>' +
      '<tr><td style="width:110px" class="muted">启用状态</td><td>' + (g.enabled ? '已启用' : '<strong>未启用</strong>（github.enabled = false）') + '</td></tr>' +
      '<tr><td class="muted">仓库</td><td class="mono">' + VH.escapeHtml((g.owner || '<未设置>') + '/' + (g.repo || '')) + '</td></tr>' +
      '<tr><td class="muted">分支</td><td class="mono">' + VH.escapeHtml(g.branch || 'main') + '</td></tr>' +
      '<tr><td class="muted">数据路径</td><td class="mono">' + VH.escapeHtml(g.dataPath || '') + '</td></tr>' +
      '</tbody></table>' +
      '<div class="row-wrap" style="margin-top:14px">' +
      '<button type="button" class="btn btn-primary btn-sm" id="go-export">立即导出发布文件</button>' +
      '<button type="button" class="btn btn-sm" id="go-guide">查看详细发布步骤</button></div>'
    );
    var b1 = $('#go-export'), b2 = $('#go-guide');
    if (b1) b1.addEventListener('click', function () { closeModal('modal-info'); exportBundle(); });
    if (b2) b2.addEventListener('click', function () { closeModal('modal-info'); openPublishGuide(); });
  }

  /* =========================================================
     Markdown 预览与插入
     ========================================================= */

  function updatePreview() {
    var box = $('#readme-preview');
    if (box.classList.contains('hide')) return;
    box.innerHTML = VH.markdown($('#f-readme').value);
  }

  function insertMd(kind) {
    var ta = $('#f-readme');
    var map = {
      h: '\n## 小标题\n',
      li: '\n- 更新项\n',
      ol: '\n1. 第一步\n2. 第二步\n',
      code: '`code`'
    };
    var snippet = map[kind] || '';
    var start = ta.selectionStart || ta.value.length;
    var end = ta.selectionEnd || start;
    ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
    ta.focus();
    var pos = start + snippet.length;
    ta.setSelectionRange(pos, pos);
    updatePreview();
  }

  /* =========================================================
     事件绑定
     ========================================================= */

  function bindStaticEvents() {
    $('#release-form').addEventListener('submit', onSubmit);
    $('#btn-reset').addEventListener('click', function () { resetForm(); VH.toast('表单已清空', 'info'); });
    $('#btn-cancel-edit').addEventListener('click', resetForm);
    $('#btn-new').addEventListener('click', function () {
      resetForm();
      $('#f-version').focus();
      global.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#btn-bump').addEventListener('click', function () {
      $('#f-version').value = bumpVersion(latestRelease() ? latestRelease().version : $('#f-version').value);
      $('#f-version').select();
    });

    // README 工具条
    $('#btn-preview').addEventListener('click', function () {
      var box = $('#readme-preview');
      var show = box.classList.contains('hide');
      box.classList.toggle('hide', !show);
      this.textContent = show ? '收起预览' : '预览';
      if (show) updatePreview();
    });
    $('#f-readme').addEventListener('input', VH.debounce(updatePreview, 300));
    VH.$$('.md-insert-btn').forEach(function (b) {
      b.addEventListener('click', function () { insertMd(b.getAttribute('data-md')); });
    });

    // 顶栏
    $('#btn-logout').addEventListener('click', function () { VH.auth.logout('index.html'); });
    $('#btn-client').addEventListener('click', function () { global.location.href = 'client.html'; });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-github').addEventListener('click', openGithubDialog);
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#btn-discard').addEventListener('click', discardDraft);
    $('#btn-clear-all').addEventListener('click', clearAll);

    // 导入导出菜单
    $('#btn-import-menu').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu('menu-import'); });
    $('#btn-export-menu').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu('menu-export'); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.dropdown')) closeAllMenus();
    });

    VH.$$('.dropdown-menu [data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeAllMenus();
        handleAction(btn.getAttribute('data-act'));
      });
    });

    // 弹窗关闭
    VH.$$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.getAttribute('data-close')); });
    });
    VH.$$('.modal-mask').forEach(function (mask) {
      mask.addEventListener('click', function (e) { if (e.target === mask) mask.hidden = true; });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeAllMenus(); VH.$$('.modal-mask').forEach(function (m) { m.hidden = true; }); }
      // Ctrl+S 保存表单
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        $('#release-form').requestSubmit
          ? $('#release-form').requestSubmit()
          : $('#btn-save').click();
      }
    });

    // 文件选择
    $('#file-json').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) onImportJson(e.target.files[0]);
      e.target.value = '';
    });
    $('#file-csv').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) onImportCsv(e.target.files[0]);
      e.target.value = '';
    });

    // 列表筛选
    $('#l-keyword').addEventListener('input', VH.debounce(function (e) {
      listFilters.keyword = e.target.value.trim();
      renderList();
    }, 200));
    $('#l-channel').addEventListener('change', function (e) { listFilters.channel = e.target.value; renderList(); });
    $('#l-status').addEventListener('change', function (e) { listFilters.status = e.target.value; renderList(); });
    $('#l-project').addEventListener('change', function (e) { listFilters.project = e.target.value; renderList(); });

    // 列表操作委托
    $('#admin-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      if (act === 'edit') editRelease(id);
      else if (act === 'dup') duplicateRelease(id);
      else if (act === 'archive') toggleArchive(id);
      else if (act === 'del') removeRelease(id);
    });

    // 表单有未保存输入时，离开页面前提示
    var formEl = $('#release-form');
    formEl.addEventListener('input', function () { formDirty = true; });
    formEl.addEventListener('change', function () { formDirty = true; });

    global.addEventListener('beforeunload', function (e) {
      if (formDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }

  function handleAction(act) {
    switch (act) {
      case 'import-json': $('#file-json').click(); break;
      case 'import-csv': $('#file-csv').click(); break;
      case 'csv-template': doCsvTemplate(); break;
      case 'export-bundle': exportBundle(); break;
      case 'export-json':
        VH.download('versions.json', VH.store.exportJsonText(), 'application/json');
        VH.toast('versions.json 已导出', 'success');
        break;
      case 'export-js':
        VH.download('versions.js', VH.store.exportJsText(), 'application/javascript');
        VH.toast('versions.js 已导出', 'success');
        break;
      case 'export-csv': doExportCsv(); break;
      case 'publish-guide': openPublishGuide(); break;
      default: break;
    }
  }

  /* ---------- 启动 ---------- */
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
