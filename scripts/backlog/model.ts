// Groups parsed issues into the two backlog tabs (mw-e00.11): Completed and Upcoming / in progress,
// each grouped by epic, then milestone. Pure: the same issues and PR status always give the same model.
import type { Issue } from './parse.ts';

/**
 * A bead referenced by a pull request's `Closes` line. The GitHub overlay (mw-e00.12) supplies these;
 * without it the list is empty and the page reflects issues.jsonl alone.
 */
export interface PrRef {
  id: string;
  number: number;
  state: 'merged' | 'open';
  url: string;
}

export interface DepView {
  id: string;
  /** null when the id is not in the export. */
  title: string | null;
  /** Effective status of the dependency, or 'unknown' when it is not in the export. */
  status: string;
}

export interface ItemView {
  issue: Issue;
  /** jsonl status with the PR overlay applied: a merged PR closes, an open PR marks in_progress. */
  status: string;
  /** Not closed, and either marked blocked or waiting on a dependency that isn't closed. */
  blocked: boolean;
  milestone: string | null;
  className: string | null;
  deps: DepView[];
  pr: PrRef | null;
}

export interface MilestoneGroup {
  key: string;
  label: string;
  items: ItemView[];
}

export interface EpicGroup {
  id: string;
  /** "E09" from a title like "E09 — Name"; empty when the title has no number. */
  number: string;
  name: string;
  /** First line under "## Outcome" in the epic description. */
  outcome: string;
  closed: number;
  total: number;
  milestones: MilestoneGroup[];
}

export interface TabView {
  count: number;
  epics: EpicGroup[];
}

export interface Backlog {
  completed: TabView;
  upcoming: TabView;
  tally: { epics: number; items: number; inProgress: number; completed: number; ready: number };
  milestones: { key: string; label: string }[];
  classes: string[];
}

export const MILESTONES: Readonly<Record<string, string>> = {
  m0: 'M0 Foundation',
  m1: 'M1 Grey-box slice',
  m2: 'M2 Class fantasies',
  m3: 'M3 MVP content',
  m4: 'M4 Fun validation',
  'post-mvp': 'Post-MVP',
};
const MILESTONE_ORDER = Object.keys(MILESTONES);
const OTHER_EPIC = '';

const byId = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** The value of a `key:value` label, or null. */
export function labelValue(issue: Issue, key: string): string | null {
  const found = issue.labels.find((l) => l.startsWith(`${key}:`));
  return found === undefined ? null : found.slice(key.length + 1);
}

export function milestoneLabel(key: string): string {
  return MILESTONES[key] ?? (key === '' ? 'Unscheduled' : key);
}

/** m0 → post-mvp, then unknown milestones alphabetically, then unscheduled. */
function milestoneRank(key: string): [number, string] {
  const known = MILESTONE_ORDER.indexOf(key);
  if (known !== -1) return [known, key];
  return [key === '' ? MILESTONE_ORDER.length + 1 : MILESTONE_ORDER.length, key];
}

function compareMilestones(a: string, b: string): number {
  const [ra, ka] = milestoneRank(a);
  const [rb, kb] = milestoneRank(b);
  return ra - rb || byId(ka, kb);
}

function compareItems(a: ItemView, b: ItemView): number {
  const active = Number(b.status === 'in_progress') - Number(a.status === 'in_progress');
  return active || a.issue.priority - b.issue.priority || byId(a.issue.id, b.issue.id);
}

function epicHeading(epic: Issue): Pick<EpicGroup, 'number' | 'name' | 'outcome'> {
  const match = /^(E\d+)\s*[—–-]\s*(.+)$/.exec(epic.title);
  const outcome = epic.description.split('## Outcome')[1] ?? '';
  return {
    number: match?.[1] ?? '',
    name: match?.[2] ?? epic.title,
    outcome:
      outcome
        .split('\n')
        .map((s) => s.trim())
        .find((s) => s !== '' && !s.startsWith('#')) ?? '',
  };
}

function effectiveStatus(issue: Issue, pr: PrRef | undefined): string {
  if (issue.status === 'closed' || pr === undefined) return issue.status;
  return pr.state === 'merged' ? 'closed' : 'in_progress';
}

/** Builds both tabs. A merged PR outranks an open one for the same bead; jsonl `closed` wins over both. */
export function buildModel(issues: readonly Issue[], prStatus: readonly PrRef[]): Backlog {
  const prs = new Map<string, PrRef>();
  for (const pr of prStatus) {
    if (pr.state === 'merged' || !prs.has(pr.id)) prs.set(pr.id, pr);
  }
  const status = new Map(issues.map((i) => [i.id, effectiveStatus(i, prs.get(i.id))]));
  const known = new Map(issues.map((i) => [i.id, i]));
  const epics = issues.filter((i) => i.type === 'epic').sort((a, b) => byId(a.id, b.id));
  const epicIds = new Set(epics.map((e) => e.id));

  const items: ItemView[] = issues
    .filter((i) => i.type !== 'epic')
    .map((issue) => {
      const own = effectiveStatus(issue, prs.get(issue.id));
      const deps = issue.blocksOn.map((id) => ({
        id,
        title: known.get(id)?.title ?? null,
        status: status.get(id) ?? 'unknown',
      }));
      const waiting = deps.some((d) => d.status !== 'closed' && d.status !== 'unknown');
      return {
        issue,
        status: own,
        blocked: own !== 'closed' && (own === 'blocked' || waiting),
        milestone: labelValue(issue, 'milestone'),
        className: labelValue(issue, 'class'),
        deps,
        pr: prs.get(issue.id) ?? null,
      };
    });

  const epicOf = (item: ItemView): string =>
    item.issue.parent !== null && epicIds.has(item.issue.parent) ? item.issue.parent : OTHER_EPIC;
  const groups: { id: string; heading: Pick<EpicGroup, 'number' | 'name' | 'outcome'> }[] = [
    ...epics.map((e) => ({ id: e.id, heading: epicHeading(e) })),
    { id: OTHER_EPIC, heading: { number: '', name: 'Other work', outcome: '' } },
  ];

  const tab = (done: boolean): TabView => {
    const epicViews: EpicGroup[] = [];
    for (const group of groups) {
      const all = items.filter((i) => epicOf(i) === group.id);
      const shown = all.filter((i) => (i.status === 'closed') === done).sort(compareItems);
      if (shown.length === 0) continue;
      const keys = [...new Set(shown.map((i) => i.milestone ?? ''))].sort(compareMilestones);
      epicViews.push({
        id: group.id,
        ...group.heading,
        closed: all.filter((i) => i.status === 'closed').length,
        total: all.length,
        milestones: keys.map((key) => ({
          key,
          label: milestoneLabel(key),
          items: shown.filter((i) => (i.milestone ?? '') === key),
        })),
      });
    }
    return {
      count: items.filter((i) => (i.status === 'closed') === done).length,
      epics: epicViews,
    };
  };

  const milestoneKeys = [...new Set(items.map((i) => i.milestone ?? ''))].sort(compareMilestones);
  return {
    completed: tab(true),
    upcoming: tab(false),
    tally: {
      epics: epics.length,
      items: items.length,
      inProgress: items.filter((i) => i.status === 'in_progress').length,
      completed: items.filter((i) => i.status === 'closed').length,
      ready: items.filter((i) => i.status !== 'closed' && !i.blocked).length,
    },
    milestones: milestoneKeys.map((key) => ({ key, label: milestoneLabel(key) })),
    classes: [
      ...new Set(items.map((i) => i.className).filter((c): c is string => c !== null)),
    ].sort(byId),
  };
}
