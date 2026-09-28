// HTML escaping and the small markdown subset bead text uses (mw-e00.11): headings, bullet and numbered
// lists, fenced code blocks, inline code, bold, test-level tags and http(s) links. Every piece of bead text
// is escaped; no raw HTML from the source ever reaches the output.

/** Escapes text for element content and double- or single-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Code spans first so their contents are never read as bold or links.
const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\[(unit|integration|e2e|perf|manual|content)\]/g;
const SAFE_URL = /^https?:\/\/[^\s]+$/i;

/** Renders one line of inline markdown to escaped HTML. */
export function renderInline(s: string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    out += escapeHtml(s.slice(last, m.index));
    last = m.index + m[0].length;
    const [whole, code, bold, text, url, tag] = m;
    if (code !== undefined) out += `<code>${escapeHtml(code)}</code>`;
    else if (bold !== undefined) out += `<b>${renderInline(bold)}</b>`;
    else if (tag !== undefined) out += `<span class="tag">${tag}</span>`;
    else if (url !== undefined && SAFE_URL.test(url))
      out += `<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">${renderInline(String(text))}</a>`;
    else out += escapeHtml(whole);
  }
  return out + escapeHtml(s.slice(last));
}

type ListKind = 'ul' | 'ol';

/** Renders bead markdown to HTML. Blank input gives an empty string. */
export function renderMarkdown(src: string): string {
  let html = '';
  let list: ListKind | null = null;
  let code: string[] | null = null;
  const closeList = (): void => {
    if (list !== null) html += `</${list}>`;
    list = null;
  };

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (code !== null) {
      if (/^\s*```/.test(raw)) {
        html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
        code = null;
      } else code.push(raw);
      continue;
    }
    if (/^\s*```/.test(raw)) {
      closeList();
      code = [];
      continue;
    }
    const item = /^\s*(?:([-*+])|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      const kind: ListKind = item[1] === undefined ? 'ol' : 'ul';
      if (list !== kind) {
        closeList();
        html += `<${kind}>`;
        list = kind;
      }
      html += `<li>${renderInline(String(item[2]))}</li>`;
      continue;
    }
    closeList();
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      const level = Math.min(6, String(heading[1]).length + 2);
      html += `<h${String(level)}>${renderInline(String(heading[2]))}</h${String(level)}>`;
    } else if (raw.trim() !== '') html += `<p>${renderInline(raw.trim())}</p>`;
  }
  closeList();
  // An unterminated fence still shows its contents.
  if (code !== null) html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
  return html;
}
