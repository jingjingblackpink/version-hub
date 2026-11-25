/**
 * markdown.js —— 轻量 Markdown 渲染器（无外部依赖）
 *
 * 支持：# 标题、粗体/斜体、行内代码、``` 代码块、有序/无序列表、
 *       > 引用、--- 分隔线、[链接](url)、![图片](url)、| 表格 |、段落
 *
 * 安全：先做 HTML 转义再渲染，链接强制白名单协议，防止 XSS。
 */
(function (global) {
  'use strict';
  var VH = (global.VH = global.VH || {});

  var CODE_TOKEN = '\u0000CODE';

  function safeUrl(u) {
    var url = String(u || '').trim();
    if (/^(https?:|mailto:|ftp:)/i.test(url)) return url;
    if (url.charAt(0) === '/' || url.charAt(0) === '#') return url;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) return 'https://' + url;
    return '#';
  }

  function inline(s) {
    return s
      // 图片
      .replace(/!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g, function (m, alt, src) {
        return '<img alt="' + alt + '" src="' + safeUrl(src) + '" loading="lazy">';
      })
      // 链接
      .replace(/\[([^\]]+)\]\(\s*([^)\s]+)[^)]*\)/g, function (m, txt, href) {
        return '<a href="' + safeUrl(href) + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
      })
      // 行内代码（内容不再二次处理）
      .replace(/`([^`]+)`/g, function (m, code) { return '<code>' + code + '</code>'; })
      // 粗体
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      // 斜体
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      // 删除线
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      // 自动识别百度网盘链接
      .replace(/(^|[\s>(])(https?:\/\/pan\.baidu\.com\/[^\s<)"']+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }

  function renderTable(rows) {
    if (rows.length < 2) return null;
    var split = function (line) {
      return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
    };
    var head = split(rows[0]);
    var sep = split(rows[1]);
    var isSep = sep.every(function (c) { return /^:?-{2,}:?$/.test(c); });
    if (!isSep) return null;

    var align = sep.map(function (c) {
      if (/^:-+:$/.test(c)) return 'center';
      if (/-+:$/.test(c)) return 'right';
      return 'left';
    });

    var html = '<table class="md-table"><thead><tr>';
    head.forEach(function (h, i) {
      html += '<th style="text-align:' + (align[i] || 'left') + '">' + inline(h) + '</th>';
    });
    html += '</tr></thead><tbody>';
    for (var r = 2; r < rows.length; r++) {
      var cells = split(rows[r]);
      html += '<tr>';
      for (var c = 0; c < head.length; c++) {
        html += '<td style="text-align:' + (align[c] || 'left') + '">' + inline(cells[c] || '') + '</td>';
      }
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  VH.markdown = function (src) {
    if (!src) return '';
    var text = String(src).replace(/\r\n?/g, '\n');

    /* 1. 抽出代码块，避免内部被当作 Markdown 解析 */
    var blocks = [];
    text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      var body = code.replace(/\n$/, '');
      blocks.push(
        '<pre class="md-pre"' + (lang ? ' data-lang="' + VH.escapeHtml(lang) + '"' : '') + '><code>' +
        VH.escapeHtml(body) + '</code></pre>'
      );
      return '\n' + CODE_TOKEN + (blocks.length - 1) + '\n';
    });

    /* 2. 整体转义 */
    text = VH.escapeHtml(text);

    var lines = text.split('\n');
    var out = [];
    var para = [];
    var listType = null;   // 'ul' | 'ol'
    var listItems = [];
    var quote = [];
    var tableBuf = [];

    function flushPara() {
      if (!para.length) return;
      var joined = para.join('\n');
      // 段落内的手动换行转 <br>
      out.push('<p>' + inline(joined).replace(/\n/g, '<br>') + '</p>');
      para = [];
    }
    function flushList() {
      if (!listType) return;
      out.push('<' + listType + '>' + listItems.map(function (li) {
        return '<li>' + inline(li) + '</li>';
      }).join('') + '</' + listType + '>');
      listType = null;
      listItems = [];
    }
    function flushQuote() {
      if (!quote.length) return;
      out.push('<blockquote>' + quote.map(function (q) { return inline(q); }).join('<br>') + '</blockquote>');
      quote = [];
    }
    function flushTable() {
      if (!tableBuf.length) return;
      var html = renderTable(tableBuf);
      if (html) { out.push(html); }
      else { tableBuf.forEach(function (l) { out.push('<p>' + inline(l) + '</p>'); }); }
      tableBuf = [];
    }
    function flushAll() { flushPara(); flushList(); flushQuote(); flushTable(); }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // 代码块占位符
      var codeMatch = trimmed.match(new RegExp('^' + CODE_TOKEN + '(\\d+)$'));
      if (codeMatch) {
        flushAll();
        out.push(blocks[parseInt(codeMatch[1], 10)] || '');
        continue;
      }

      // 空行
      if (trimmed === '') { flushAll(); continue; }

      // 表格
      if (/^\|.*\|\s*$/.test(trimmed) || (/^\|/.test(trimmed) && tableBuf.length)) {
        flushPara(); flushList(); flushQuote();
        tableBuf.push(trimmed);
        continue;
      } else if (tableBuf.length) {
        flushTable();
      }

      // 分隔线
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushAll();
        out.push('<hr>');
        continue;
      }

      // 标题
      var h = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushAll();
        var lv = h[1].length;
        out.push('<h' + lv + ' class="md-h">' + inline(h[2]) + '</h' + lv + '>');
        continue;
      }

      // 引用（> 已被转义为 &gt;）
      var q = trimmed.match(/^&gt;\s?(.*)$/);
      if (q) {
        flushPara(); flushList(); flushTable();
        quote.push(q[1]);
        continue;
      } else if (quote.length) {
        flushQuote();
      }

      // 无序列表
      var ul = line.match(/^\s{0,3}[-*+]\s+(.*)$/);
      if (ul) {
        flushPara(); flushQuote(); flushTable();
        if (listType !== 'ul') { flushList(); listType = 'ul'; }
        listItems.push(ul[1]);
        continue;
      }

      // 有序列表
      var ol = line.match(/^\s{0,3}\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara(); flushQuote(); flushTable();
        if (listType !== 'ol') { flushList(); listType = 'ol'; }
        listItems.push(ol[1]);
        continue;
      }

      if (listType) flushList();

      // 普通段落
      para.push(trimmed);
    }
    flushAll();

    return out.join('\n');
  };
})(window);
