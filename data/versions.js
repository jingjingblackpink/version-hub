/**
 * ⚠️ 本文件是 data/versions.json 的「本地镜像」，内容必须保持一致。
 *
 * 为什么需要它：
 *   浏览器在 file:// 协议（双击打开网页）下禁止 fetch 读取本地 JSON，
 *   但允许 <script src> 加载 JS。因此本地预览时数据从这个文件读取；
 *   部署到 GitHub Pages（http/https）后，程序优先 fetch versions.json，
 *   本文件仅作为兜底。
 *
 * 维护方式：
 *   在后台管理页点击「导出数据文件」，会自动同时生成
 *   versions.json 与 versions.js，两个文件一起覆盖到仓库即可。
 */
window.__SITE_DATA__ = {
  "meta": {
    "schemaVersion": 1,
    "updatedAt": "2026-11-24T10:30:00+08:00",
    "updatedBy": "admin",
    "siteName": "泉心泉意 · 软件版本中心"
  },
  "projects": [
    {
      "id": "jinshuyu",
      "name": "金属浴智能温控系统",
      "category": "嵌入式固件",
      "owner": "",
      "archived": false,
      "releases": [
        {
          "id": "rel_sample_v120",
          "version": "v1.2.0",
          "screenVersion": "DGUS v2.3.1",
          "date": "2026-11-24T10:30:00",
          "channel": "stable",
          "status": "normal",
          "tags": ["STM32F407", "FreeRTOS", "AD7124"],
          "readme": "## 本次更新\n\n- 新增 **PID 自整定** 功能，长按设置键 3 秒触发\n- 修复 DGUS 串口屏偶发卡死问题（看门狗喂狗时序调整）\n- FRAM 存储增加 CRC 校验，掉电数据更可靠\n\n## 烧录说明\n\n1. 使用 ST-Link 连接 SWD 接口\n2. 打开 STM32CubeProgrammer，选择 `jinshuyu_v1.2.0.bin`\n3. 起始地址 `0x08000000`，勾选 Verify programming\n4. 烧录完成后断电重启\n\n## 已知问题\n\n- 环境温度低于 5℃ 时，升温曲线前段略有超调，v1.3.0 优化",
          "changelog": [
            "新增 PID 自整定功能",
            "修复 DGUS 串口屏偶发卡死",
            "FRAM 存储增加 CRC 校验"
          ],
          "download": {
            "type": "baidupan",
            "url": "https://pan.baidu.com/s/1SampleLinkReplaceMe",
            "password": "ab12",
            "fileName": "jinshuyu_v1.2.0.bin",
            "fileSize": "486 KB",
            "sha256": "",
            "mirror": ""
          },
          "internalNote": "示例数据，正式使用前请在后台删除或修改。"
        },
        {
          "id": "rel_sample_v110",
          "version": "v1.1.0",
          "screenVersion": "DGUS v2.2.0",
          "date": "2026-09-02T15:20:00",
          "channel": "stable",
          "status": "archived",
          "tags": ["STM32F407", "FreeRTOS"],
          "readme": "## 本次更新\n\n- 首版正式发布\n- 支持 4 通道 AD7124 温度采集\n- 支持 DGUS 串口屏交互\n\n## 备注\n\n该版本已被 v1.2.0 取代，建议升级。",
          "changelog": ["首版正式发布"],
          "download": {
            "type": "baidupan",
            "url": "https://pan.baidu.com/s/1SampleLinkOldVer",
            "password": "cd34",
            "fileName": "jinshuyu_v1.1.0.bin",
            "fileSize": "470 KB",
            "sha256": "",
            "mirror": ""
          },
          "internalNote": ""
        }
      ]
    }
  ]
};
