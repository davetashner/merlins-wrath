import { describe, expect, it } from 'vitest';
import { escapeHtml, renderInline, renderMarkdown } from './markdown.ts';

describe('escapeHtml', () => {
  it('escapes every character that could open markup or leave an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('renderInline', () => {
  it('renders code, bold, test-level tags and http(s) links', () => {
    expect(
      renderInline('Run `a < b` **now** [unit] see [docs](https://example.com/a?b=1&c=2) end'),
    ).toBe(
      'Run <code>a &lt; b</code> <b>now</b> <span class="tag">unit</span> see ' +
        '<a href="https://example.com/a?b=1&amp;c=2" rel="nofollow noopener noreferrer">docs</a> end',
    );
  });

  it('does not read markdown inside code spans', () => {
    expect(renderInline('`**x** [a](https://b)`')).toBe('<code>**x** [a](https://b)</code>');
  });

  it('AC-2: javascript: and other non-http links stay inert text', () => {
    expect(renderInline('[click](javascript:alert(1)) [f](file:///etc/passwd)')).toBe(
      '[click](javascript:alert(1)) [f](file:///etc/passwd)',
    );
    expect(renderInline('**<img src=x onerror=alert(1)>**')).toBe(
      '<b>&lt;img src=x onerror=alert(1)&gt;</b>',
    );
  });
});

describe('renderMarkdown', () => {
  it('renders headings, bullet and numbered lists, paragraphs and fenced code', () => {
    const src = [
      '## Why',
      'Because.',
      '- one',
      '* two',
      '1. first',
      '2) second',
      '',
      '####### not a heading',
      '```ts',
      'const a = "<b>";',
      '',
      '```',
      '- after code',
    ].join('\r\n');
    expect(renderMarkdown(src)).toBe(
      '<h4>Why</h4><p>Because.</p><ul><li>one</li><li>two</li></ul>' +
        '<ol><li>first</li><li>second</li></ol><p>####### not a heading</p>' +
        '<pre><code>const a = &quot;&lt;b&gt;&quot;;\n</code></pre><ul><li>after code</li></ul>',
    );
  });

  it('caps deep headings at h6 and closes a trailing list', () => {
    expect(renderMarkdown('##### Deep\n- last')).toBe('<h6>Deep</h6><ul><li>last</li></ul>');
  });

  it('shows the contents of an unterminated fence', () => {
    expect(renderMarkdown('- a\n```\n<x>')).toBe(
      '<ul><li>a</li></ul><pre><code>&lt;x&gt;</code></pre>',
    );
  });

  it('gives an empty string for blank input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('\n  \n')).toBe('');
  });

  it('AC-2: raw HTML in any block never passes through', () => {
    const html = renderMarkdown(
      '# <script>alert(1)</script>\n<script>alert(2)</script>\n- <img src=x onerror=alert(3)>',
    );
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });
});
