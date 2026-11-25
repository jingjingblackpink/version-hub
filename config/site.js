/**
 * 站点配置（账号 + 全局设置）
 * ------------------------------------------------------------------
 * 说明：这里用 .js 而不是 .json，是为了让网页在「双击本地文件」
 * (file:// 协议) 打开时也能正常读取 —— 浏览器禁止 file:// 下的
 * fetch 请求，但 <script src> 不受限制。部署到 GitHub Pages 后同
 * 样适用，无需改动。
 *
 * 想加账号（如 002 / 002）：在 accounts 数组里照格式加一行即可。
 * ⚠️ 前端鉴权属于「软隔离」，仅用于内部台账，勿存放机密数据。
 */
window.__SITE_CONFIG__ = {
  /* ---------- 账号与角色 ---------- */
  accounts: [
    { user: 'admin', pass: 'admin', role: 'admin',  label: '管理员' },
    { user: '001',   pass: '001',   role: 'client', label: '客户端用户' }
    // { user: '002', pass: '002', role: 'client', label: '客户端用户2' }
  ],

  /* ---------- 站点信息 ---------- */
  site: {
    name: '泉心泉意 · 软件版本中心',
    subtitle: 'Software Version Hub',
    footer: '数据存储于 GitHub 仓库 · 由 GitHub Pages 托管',
    loginNotice: '内部使用站点，请勿外传账号信息。'
  },

  /* ---------- 项目模式 ---------- */
  // multiProject = true（默认）：录入表单显示「项目名称」并必填，
  //   客户端按项目名称分组展示 —— 同名项目的版本自动合并到一个项目组里，
  //   组内每个版本单独一行。
  // multiProject = false：隐藏项目字段，全部记录归入下面的默认项目，
  //   客户端只显示一个分组。数据结构两种模式完全一致，可随时切换。
  project: {
    multiProject: true,
    defaultId: 'jinshuyu',
    defaultName: '金属浴智能温控系统',
    defaultCategory: '嵌入式固件',
    defaultOwner: ''
  },

  /* ---------- 行为开关 ---------- */
  options: {
    rememberDays: 7,          // 「记住我」保持登录的天数
    sessionHours: 8,          // 未勾选「记住我」时的登录有效时长（小时）
    maxFailTimes: 5,          // 连续输错次数上限
    lockSeconds: 30,          // 达到上限后的锁定时长（秒）
    summaryLength: 60,        // 客户端「版本说明」摘要字数
    clientShowArchived: false,// 客户端默认是否显示已归档版本
    requireBaiduPan: false,   // true 时下载链接必须是 pan.baidu.com 域名
    showSha256: true,         // 是否显示 SHA256 字段
    showMirror: false,        // 是否显示「镜像下载地址」字段
    showScreenVersion: true,  // 是否显示「串口屏版本」字段（无串口屏的项目可关掉）
    useDateTime: true,        // true = 上传时间精确到秒（datetime-local）；false = 仅日期
    allowAdminPreviewClient: true // 允许 admin 账号访问客户端页面预览
  },

  /* ---------- GitHub 直推（M5 阶段启用） ---------- */
  github: {
    enabled: false,           // 本地阶段为 false，保存走「导出文件」模式
    owner: 'jingjingblackpink',  // 你的 GitHub 用户名
    repo: 'version-hub',      // 仓库名
    branch: 'main',
    dataPath: 'data/versions.json'
  }
};
