// The GitHub overlay for backlog.html (mw-e00.12): beads are closed locally after a PR merges, so
// issues.jsonl lags reality. This lists the repository's pull requests and turns their `Closes mw-…`
// lines (read with the PR-body lint's shared parser) into PrRefs for the model. PR bodies are untrusted
// data: only regex-extracted ids leave this module. The fetch is injected so tests use fixtures.
import { parseCloses } from '../pr-body-lint.ts';
import type { PrRef } from './model.ts';

/** Enough of `fetch` for the overlay; the global fetch satisfies it. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

/** A pull request as the overlay needs it. */
export interface PullSummary {
  number: number;
  state: 'open' | 'closed';
  mergedAt: string | null;
  url: string;
  body: string;
  /** Authored by someone with write access (owner, member or collaborator). */
  trusted: boolean;
}

/** Why the overlay could not be read; the page then renders from issues.jsonl alone. */
export class GithubError extends Error {}

export const API = 'https://api.github.com/';
/** The newest PRs read per run (the bead's cap); 5 pages of 100. */
export const MAX_PRS = 500;
const PER_PAGE = 100;
const TIMEOUT_MS = 20_000;
/**
 * Only PRs by people with write access count: anyone can open a PR (or edit its body after merge),
 * and the public page must not let outsiders mark beads as in progress or done.
 */
export const TRUSTED_ASSOCIATIONS: readonly string[] = ['OWNER', 'MEMBER', 'COLLABORATOR'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The rel="next" target of a Link header, only when it stays on api.github.com (it carries the token). */
export function nextLink(header: string | null): string | null {
  const next = /<([^>]+)>;\s*rel="next"/.exec(header ?? '')?.[1];
  return next?.startsWith(API) === true ? next : null;
}

/** One page of the REST `pulls` list; malformed entries are skipped, a non-array is an error. */
export function toPullSummaries(json: unknown): PullSummary[] {
  if (!Array.isArray(json)) throw new GithubError('unexpected response (not a list of PRs)');
  return json.filter(isRecord).flatMap((pr): PullSummary[] => {
    const { number, state, merged_at: mergedAt, html_url: url, body } = pr;
    if (typeof number !== 'number' || typeof url !== 'string') return [];
    if (state !== 'open' && state !== 'closed') return [];
    return [
      {
        number,
        state,
        mergedAt: typeof mergedAt === 'string' ? mergedAt : null,
        url,
        body: typeof body === 'string' ? body : '',
        trusted: TRUSTED_ASSOCIATIONS.includes(String(pr['author_association'])),
      },
    ];
  });
}

function httpError(res: Response): GithubError {
  const limited =
    (res.status === 403 || res.status === 429) &&
    (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'));
  if (!limited) return new GithubError(`HTTP ${String(res.status)}`);
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const when = reset > 0 ? ` until ${new Date(reset * 1000).toISOString()}` : '';
  return new GithubError(`rate limited${when}`);
}

export interface FetchPullsOptions {
  /** owner/name */
  repo: string;
  token: string;
  fetch: FetchLike;
  limit?: number;
}

/**
 * The newest `limit` PRs in any state, following the Link header page by page. One call per run is the
 * per-run cache. Throws GithubError on network, HTTP, rate-limit or shape errors.
 */
export async function fetchPulls({
  repo,
  token,
  fetch,
  limit = MAX_PRS,
}: FetchPullsOptions): Promise<PullSummary[]> {
  const pulls: PullSummary[] = [];
  let url: string | null =
    `${API}repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=${String(PER_PAGE)}`;
  while (url !== null && pulls.length < limit) {
    let res: Response;
    let json: unknown;
    try {
      res = await fetch(url, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw httpError(res);
      json = await res.json();
    } catch (error) {
      if (error instanceof GithubError) throw error;
      throw new GithubError(`request failed (${(error as Error).message})`);
    }
    pulls.push(...toPullSummaries(json));
    url = nextLink(res.headers.get('link'));
  }
  return pulls.slice(0, limit);
}

/**
 * PrRefs for the model: every bead named by a trusted merged or open PR. Closed-unmerged PRs and
 * untrusted authors are ignored.
 */
export function prRefs(pulls: readonly PullSummary[]): PrRef[] {
  return pulls.flatMap((pr): PrRef[] => {
    const merged = pr.mergedAt !== null;
    if (!pr.trusted || (pr.state === 'closed' && !merged)) return [];
    return parseCloses(pr.body).map((id) => ({
      id,
      number: pr.number,
      state: merged ? 'merged' : 'open',
      url: pr.url,
      mergedAt: pr.mergedAt,
    }));
  });
}
