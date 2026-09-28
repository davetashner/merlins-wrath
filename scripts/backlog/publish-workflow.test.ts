// Static security check of the publish workflow (mw-e00.12 AC-7). It runs on pull_request_target, i.e.
// with the deploy role and a token in the base repository's context, so it must never check out,
// install or run PR code, and must treat PR text as data.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW = '.github/workflows/publish-site.yml';
const DEFAULT_BRANCH_REF = 'ref: ${{ github.event.repository.default_branch }}';

/** Everything in a pull_request_target workflow that could run or expose PR-controlled content. */
function violations(yaml: string): string[] {
  const found: string[] = [];
  if (!/^\s*pull_request_target:/m.test(yaml)) return found;
  const steps = yaml.split(/\n\s*- (?=uses:|name:|run:)/).slice(1);
  for (const step of steps.filter((s) => s.includes('actions/checkout@'))) {
    if (!step.includes(DEFAULT_BRANCH_REF)) found.push('checkout without the default-branch ref');
    if (!step.includes('persist-credentials: false')) found.push('checkout persists credentials');
  }
  if (/github\.event\.pull_request\.head|github\.head_ref|refs\/pull\//.test(yaml)) {
    found.push('references the PR head');
  }
  if (
    /\b(?:pnpm|npm|yarn|bun)\s+(?:install|i|ci|add|exec|run|dlx)\b|\bnpx\b|\bcorepack\b/.test(yaml)
  ) {
    found.push('installs or runs packages');
  }
  // PR text (title, body, branch names …) must not be interpolated anywhere; only the author
  // association gates the job.
  for (const [, field] of yaml.matchAll(/github\.event\.pull_request\.([a-z_.]+)/g)) {
    if (field !== 'author_association') found.push(`interpolates pull_request.${String(field)}`);
  }
  if (!/^\s*pull-requests: read$/m.test(yaml)) found.push('missing pull-requests: read');
  for (const [, scope] of yaml.matchAll(/^\s*([a-z-]+): write$/gm)) {
    if (scope !== 'id-token') found.push(`grants ${String(scope)}: write`);
  }
  return found;
}

describe('publish-site workflow', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8');

  it('AC-7: under pull_request_target no step checks out a PR head ref or installs/runs PR contents', () => {
    expect(yaml).toMatch(/pull_request_target:\n\s+types: \[opened, reopened, edited, closed\]/);
    expect(violations(yaml)).toEqual([]);
  });

  it('AC-7: the check catches unsafe variants', () => {
    const unsafe = yaml
      .replace(DEFAULT_BRANCH_REF, 'ref: ${{ github.event.pull_request.head.sha }}')
      .replace('persist-credentials: false', 'fetch-depth: 1')
      .replace('mkdir -p _site', 'pnpm install --frozen-lockfile')
      .replace('pull-requests: read', 'pull-requests: write')
      .replace('run: |', 'run: | # ${{ github.event.pull_request.title }}');
    expect(violations(unsafe)).toEqual([
      'checkout without the default-branch ref',
      'checkout persists credentials',
      'references the PR head',
      'installs or runs packages',
      'interpolates pull_request.head.sha',
      'interpolates pull_request.title',
      'missing pull-requests: read',
      'grants pull-requests: write',
    ]);
    expect(violations('on:\n  push:\n')).toEqual([]);
  });

  it('passes a token to the generator only in the build step and runs it with Node directly', () => {
    expect(yaml).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(yaml).toContain('node scripts/backlog/generate-cli.ts .beads/issues.jsonl');
  });
});
