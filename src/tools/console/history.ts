// Command history for the debug console (mw-e33.1): the lines typed, newest last, persisted in
// browser storage so they survive reloads (a scene change reloads the page). Up/Down walk it like a
// shell. Storage may be missing or throw (private mode, blocked site data): history then lives only
// in memory for the session.

/** The part of Web Storage the history uses. */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key. */
export const HISTORY_KEY = 'vesper.debug-console.history';

/** Lines kept. */
export const HISTORY_LIMIT = 50;

function load(storage: HistoryStorage | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((line): line is string => typeof line === 'string').slice(-HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export class ConsoleHistory {
  private readonly lines: string[];
  /** Position while walking: lines.length means "past the newest" (the line being typed). */
  private cursor: number;

  constructor(private readonly storage?: HistoryStorage) {
    this.lines = load(storage);
    this.cursor = this.lines.length;
  }

  /** Every remembered line, oldest first. */
  get entries(): readonly string[] {
    return this.lines;
  }

  /** Remembers a submitted line (blank lines and repeats of the newest are skipped). */
  add(line: string): void {
    const trimmed = line.trim();
    if (trimmed !== '' && trimmed !== this.lines.at(-1)) {
      this.lines.push(trimmed);
      if (this.lines.length > HISTORY_LIMIT) this.lines.shift();
      try {
        this.storage?.setItem(HISTORY_KEY, JSON.stringify(this.lines));
      } catch {
        // Storage full or blocked: keep the in-memory history.
      }
    }
    this.cursor = this.lines.length;
  }

  /** The previous (older) line, staying on the oldest; undefined when there is none. */
  previous(): string | undefined {
    if (this.lines.length === 0) return undefined;
    this.cursor = Math.max(0, this.cursor - 1);
    return this.lines[this.cursor];
  }

  /** The next (newer) line, or '' once past the newest. */
  next(): string {
    this.cursor = Math.min(this.lines.length, this.cursor + 1);
    return this.lines[this.cursor] ?? '';
  }
}
