import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPO, loadOverlay, main } from './generate.ts';
import {
  API,
  fetchPulls,
  GithubError,
  MAX_PRS,
  nextLink,
  prRefs,
  toPullSummaries,
  type FetchLike,
  type PullSummary,
} from './github.ts';

const REPO = 'o/r';
const NOW = new Date('2026-09-27T12:00:00Z');

/** A REST `pulls` list entry. */
const pull = (
  number: number,
  body: string,
  state: 'open' | 'merged' | 'closed' = 'merged',
  association = 'OWNER',
): Record<string, unknown> => ({
  number,
  state: state === 'open' ? 'open' : 'closed',
  merged_at: state === 'merged' ? '2026-09-20T10:00:00Z' : null,
  html_url: `https://github.com/o/r/pull/${String(number)}`,
  body,
  author_association: association,
});

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

/** A fetch mock serving the given responses in order and recording the requested URLs. */
function mockFetch(...responses: (Response | Error)[]): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const fn = (url: string): Promise<Response> => {
    urls.push(url);
    const next = responses.shift();
    if (next === undefined) throw new Error('no more responses');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return Object.assign(fn, { urls });
}

const page = (n: number): string =>
  `${API}repos/${REPO}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${String(n)}`;

describe('fetchPulls', () => {
  it('AC-6: consumes 3 pages via the Link header and merges the results', async () => {
    const fetch = mockFetch(
      json([pull(3, '')], {
        headers: { link: `<${page(2)}>; rel="next", <${page(3)}>; rel="last"` },
      }),
      json([pull(2, '')], {
        headers: { link: `<${page(3)}>; rel="next", <${page(1)}>; rel="first"` },
      }),
      json([pull(1, '')], { headers: { link: `<${page(1)}>; rel="first"` } }),
    );
    const pulls = await fetchPulls({ repo: REPO, token: 't', fetch });
    expect(pulls.map((p) => p.number)).toEqual([3, 2, 1]);
    expect(fetch.urls).toEqual([
      `${API}repos/${REPO}/pulls?state=all&sort=created&direction=desc&per_page=100`,
      page(2),
      page(3),
    ]);
  });

  it('sends the token and API version and stops at the PR cap', async () => {
    const seen: Record<string, string>[] = [];
    const fetch: FetchLike = (_url, init) => {
      seen.push(init.headers);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(
        json([pull(9, ''), pull(8, '')], { headers: { link: `<${page(2)}>; rel="next"` } }),
      );
    };
    const pulls = await fetchPulls({ repo: REPO, token: 'secret', fetch, limit: 3 });
    expect(pulls.map((p) => p.number)).toEqual([9, 8, 9]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      authorization: 'Bearer secret',
      accept: 'application/vnd.github+json',
    });
    expect(MAX_PRS).toBe(500);
  });

  it('reports rate limits, HTTP errors, network errors and bad JSON as GithubError', async () => {
    const fail = async (res: Response | Error): Promise<string> => {
      try {
        await fetchPulls({ repo: REPO, token: 't', fetch: mockFetch(res) });
      } catch (error) {
        expect(error).toBeInstanceOf(GithubError);
        return (error as Error).message;
      }
      throw new Error('expected a GithubError');
    };
    const limited = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' };
    expect(await fail(json({}, { status: 403, headers: limited }))).toBe(
      'rate limited until 2026-09-21T14:13:20.000Z',
    );
    expect(await fail(json({}, { status: 429, headers: { 'retry-after': '60' } }))).toBe(
      'rate limited',
    );
    expect(await fail(json({}, { status: 403 }))).toBe('HTTP 403');
    expect(await fail(json({}, { status: 500 }))).toBe('HTTP 500');
    expect(await fail(new TypeError('fetch failed'))).toBe('request failed (fetch failed)');
    expect(await fail(new Response('<html>', { status: 200 }))).toMatch(/^request failed \(/);
    expect(await fail(json({ message: 'x' }))).toBe('unexpected response (not a list of PRs)');
  });
});

describe('nextLink', () => {
  it('follows rel="next" only to api.github.com', () => {
    expect(nextLink(`<${page(2)}>; rel="next"`)).toBe(page(2));
    expect(nextLink('<https://evil.example/x>; rel="next"')).toBeNull();
    expect(nextLink(`<${page(1)}>; rel="prev"`)).toBeNull();
    expect(nextLink(null)).toBeNull();
  });
});

describe('toPullSummaries', () => {
  it('keeps well-formed PRs and skips malformed entries', () => {
    expect(
      toPullSummaries([
        null,
        { number: '1', html_url: 'u', state: 'open' },
        { number: 2, state: 'open' },
        { number: 3, html_url: 'u', state: 'draft' },
        { number: 4, html_url: 'u', state: 'open', body: null },
        pull(5, 'Closes mw-1', 'merged', 'CONTRIBUTOR'),
      ]),
    ).toEqual<PullSummary[]>([
      { number: 4, state: 'open', mergedAt: null, url: 'u', body: '', trusted: false },
      {
        number: 5,
        state: 'closed',
        mergedAt: '2026-09-20T10:00:00Z',
        url: 'https://github.com/o/r/pull/5',
        body: 'Closes mw-1',
        trusted: false,
      },
    ]);
  });
});

describe('prRefs', () => {
  it('reads Closes lines of trusted merged and open PRs; closed-unmerged and untrusted PRs are ignored', () => {
    const summaries = toPullSummaries([
      pull(57, 'Summary\n\nCloses mw-e09.3\nCloses mw-e09.6\n<!-- Closes mw-e09.9 -->'),
      pull(60, 'Closes mw-e09.4', 'open', 'MEMBER'),
      pull(61, 'Closes mw-e09.5', 'closed', 'COLLABORATOR'),
      pull(62, 'Closes mw-e09.7', 'open', 'NONE'),
      pull(63, 'Closes mw-e09.8', 'merged', 'CONTRIBUTOR'),
    ]);
    expect(prRefs(summaries)).toEqual([
      {
        id: 'mw-e09.3',
        number: 57,
        state: 'merged',
        url: 'https://github.com/o/r/pull/57',
        mergedAt: '2026-09-20T10:00:00Z',
      },
      expect.objectContaining({ id: 'mw-e09.6', number: 57 }),
      {
        id: 'mw-e09.4',
        number: 60,
        state: 'open',
        url: 'https://github.com/o/r/pull/60',
        mergedAt: null,
      },
    ]);
  });
});

describe('generating with the GitHub overlay', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const E09 = [
    { id: 'mw-e09', title: 'E09 — Stealth', issue_type: 'epic', status: 'open' },
    ...[3, 4, 5].map((n) => ({
      id: `mw-e09.${String(n)}`,
      title: `Bead ${String(n)}`,
      status: 'open',
      dependencies: [{ depends_on_id: 'mw-e09', type: 'parent-child' }],
    })),
  ];

  /** Runs main on E09 with the given fetch; returns the exit code, the page and the log. */
  async function generate(
    fetch: FetchLike,
    env: Record<string, string> = { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: REPO },
    flags: string[] = [],
  ): Promise<{ code: number; html: string; log: string[] }> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), 'backlog-gh-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'issues.jsonl'), E09.map((r) => JSON.stringify(r)).join('\n'));
    const out = join(dir, 'backlog.html');
    const code = await main([...flags, join(dir, 'issues.jsonl'), out], env, NOW, dir, fetch);
    return { code, html: readFileSync(out, 'utf8'), log: log.mock.calls.map((c) => String(c[0])) };
  }
  const panel = (html: string, key: string): string => {
    const start = html.indexOf(`id="panel-${key}"`);
    return html.slice(start, html.indexOf('</section>\n', start));
  };
  const row = (html: string, id: string): string => {
    const start = html.indexOf(`<li class="row" id="${id}"`);
    return html.slice(start, html.indexOf('</summary>', start));
  };

  it('AC-1: a merged PR closing an open bead puts it in Completed with a link to the PR', async () => {
    const { code, html, log } = await generate(mockFetch(json([pull(57, 'Closes mw-e09.3')])));
    expect(code).toBe(0);
    expect(panel(html, 'completed')).toContain('id="mw-e09.3"');
    expect(panel(html, 'upcoming')).not.toContain('id="mw-e09.3"');
    expect(row(html, 'mw-e09.3')).toContain(
      'done (<a href="https://github.com/o/r/pull/57">PR #57</a>, 2026-09-20)',
    );
    expect(html).toContain('and open and merged pull requests on GitHub.');
    expect(log).toContain('Read 1 pull requests from o/r (1 Closes references).');
  });

  it('AC-2: an open PR shows its bead "in progress (PR #60)" in Upcoming', async () => {
    const { html } = await generate(mockFetch(json([pull(60, 'Closes mw-e09.4', 'open')])));
    expect(panel(html, 'upcoming')).toContain('id="mw-e09.4"');
    expect(row(html, 'mw-e09.4')).toContain(
      '<span class="pill st-in_progress" title="Status from GitHub pull request #60; issues.jsonl not yet updated">in progress (<a href="https://github.com/o/r/pull/60">PR #60</a>)</span>',
    );
    expect(row(html, 'mw-e09.4')).toContain('data-source="pr"');
  });

  it('AC-3: a closed-unmerged PR leaves its bead at the jsonl status', async () => {
    const { html } = await generate(mockFetch(json([pull(61, 'Closes mw-e09.5', 'closed')])));
    expect(panel(html, 'upcoming')).toContain('id="mw-e09.5"');
    expect(row(html, 'mw-e09.5')).toContain('data-source="jsonl"');
    expect(row(html, 'mw-e09.5')).toContain('<span class="pill st-open">open</span>');
    expect(html).not.toContain('PR #61');
  });

  it('AC-4: a 403 rate limit or network error still writes the page from jsonl with a banner and exit 0', async () => {
    const limited = json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    for (const failure of [limited, new TypeError('getaddrinfo ENOTFOUND')]) {
      const { code, html, log } = await generate(mockFetch(failure));
      expect(code).toBe(0);
      expect(html).toContain('<p class="banner" role="status"><b>GitHub status unavailable.</b>');
      expect(panel(html, 'upcoming')).toContain('id="mw-e09.3"');
      expect(log[0]).toMatch(/^::warning title=Backlog page::GitHub status unavailable \(/);
    }
  });

  it('AC-4: without a token the overlay is skipped with a warning and a banner', async () => {
    const fetch = mockFetch();
    const { code, html, log } = await generate(fetch, { GITHUB_TOKEN: '' });
    expect(code).toBe(0);
    expect(fetch.urls).toEqual([]);
    expect(html).toContain('class="banner"');
    expect(log[0]).toBe(
      '::warning title=Backlog page::GitHub status unavailable (no GITHUB_TOKEN); rendering from issues.jsonl alone.',
    );
  });

  it('AC-5: ids missing from jsonl are listed under "Unknown references"', async () => {
    const { code, html } = await generate(
      mockFetch(
        json([pull(70, 'Closes mw-e99.1\nCloses mw-e09.3'), pull(71, 'Closes mw-e99.1', 'open')]),
      ),
    );
    expect(code).toBe(0);
    expect(html).toContain(
      '<footer><section class="unknown"><h2>Unknown references</h2><p>Pull requests close these ids, which are not in <code>.beads/issues.jsonl</code>.</p>' +
        '<ul><li><span class="rid">mw-e99.1</span> in <a href="https://github.com/o/r/pull/70">PR #70</a></li>' +
        '<li><span class="rid">mw-e99.1</span> in <a href="https://github.com/o/r/pull/71">PR #71</a></li></ul></section>',
    );
  });

  it('--no-github skips the overlay without a banner', async () => {
    const fetch = mockFetch();
    const { html } = await generate(fetch, { GITHUB_TOKEN: 't' }, ['--no-github']);
    expect(fetch.urls).toEqual([]);
    expect(html).not.toContain('class="banner"');
    expect(html).not.toContain('pull requests on GitHub');
  });

  it('reads GH_TOKEN and defaults to the project repository', async () => {
    const fetch = mockFetch(json([]));
    expect(await loadOverlay({ GH_TOKEN: 't', GITHUB_REPOSITORY: '' }, false, fetch)).toEqual({
      github: 'ok',
      prStatus: [],
    });
    expect(fetch.urls[0]).toContain(`repos/${DEFAULT_REPO}/pulls?`);
  });
});
