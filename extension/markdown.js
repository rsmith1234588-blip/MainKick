// Tiny, safe Markdown renderer. Everything is HTML-escaped first, so AI output can never inject markup or scripts.
(() => {
  if (window.MainkickMarkdown) return;

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const HEADING_RE = /^\s{0,3}(#{1,6})\s*(.+?)(?:\s+#+)?\s*$/;
  const FENCE_RE = /^\s*(`{3,}|~{3,})/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function inline(text) {
    const codes = [];
    let s = String(text).replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = esc(s);
    s = s
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .replace(/\*\*\*(?=\S)(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?=\S)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)(.+?)_(?![_\w])/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>')
      // Models often write <br> for a line break (especially inside table cells). It arrives escaped, so turn
      // just that one tag back into a real break; all other markup stays escaped.
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  function splitRow(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function isTableStart(lines, i) {
    return lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]);
  }

  function isBlockStart(lines, i) {
    const l = lines[i];
    return FENCE_RE.test(l) || HEADING_RE.test(l) || HR_RE.test(l) || LIST_RE.test(l) ||
      /^\s*>/.test(l) || isTableStart(lines, i);
  }

  function renderList(lines, start) {
    const items = [];
    let j = start;
    while (j < lines.length) {
      const m = lines[j].match(LIST_RE);
      if (m && !HR_RE.test(lines[j])) {
        items.push({
          indent: m[1].replace(/\t/g, '    ').length,
          ordered: /\d/.test(m[2]),
          start: parseInt(m[2], 10),
          text: m[3]
        });
        j++;
      } else if (items.length && lines[j].trim() && /^\s{2,}/.test(lines[j])) {
        items[items.length - 1].text += ' ' + lines[j].trim();
        j++;
      } else if (!lines[j].trim() && j + 1 < lines.length && LIST_RE.test(lines[j + 1])) {
        j++;
      } else {
        break;
      }
    }

    let html = '';
    const stack = [];
    for (const it of items) {
      while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) {
        html += `</li></${stack.pop().tag}>`;
      }
      const top = stack[stack.length - 1];
      if (!top || it.indent > top.indent) {
        const tag = it.ordered ? 'ol' : 'ul';
        html += `<${tag}${it.ordered && it.start > 1 ? ` start="${it.start}"` : ''}>`;
        stack.push({ indent: it.indent, tag });
      } else {
        html += '</li>';
      }
      const task = it.text.match(/^\[([ xX])\]\s+(.*)$/);
      html += task
        ? `<li class="task">${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2])}`
        : `<li>${inline(it.text)}`;
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return [html, j];
  }

  function render(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(FENCE_RE);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }

      if (!line.trim()) { i++; continue; }

      if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

      const h = line.match(HEADING_RE);
      if (h) {
        out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
        i++;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        continue;
      }

      if (isTableStart(lines, i)) {
        const head = splitRow(lines[i]);
        i += 2;
        let html = '<div class="table-wrap"><table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          html += '<tr>' + splitRow(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
          i++;
        }
        out.push(html + '</tbody></table></div>');
        continue;
      }

      if (LIST_RE.test(line)) {
        const [html, next] = renderList(lines, i);
        out.push(html);
        i = next;
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines, i))) {
        para.push(inline(lines[i].trim()));
        i++;
      }
      out.push(`<p>${para.join('<br>')}</p>`);
    }
    return out.join('');
  }

  window.MainkickMarkdown = { render, escape: esc };
})();
