// pnpm perf:budgets (mw-e32.1 AC-6): validates perf/perf-budgets.json, including that every budget's
// source quotes the hardware baseline section of docs/backlog-contract.md verbatim. Prints one
// GitHub error annotation per problem.

import { loadBudgets } from './budgets.ts';

export const DEFAULT_BUDGETS = 'perf/perf-budgets.json';
export const DEFAULT_CONTRACT = 'docs/backlog-contract.md';

/** `[budgets.json] [contract.md]`; returns the exit code. */
export function main(argv: readonly string[], log: (line: string) => void): number {
  const [budgetsPath = DEFAULT_BUDGETS, contractPath = DEFAULT_CONTRACT] = argv;
  try {
    const budgets = loadBudgets(budgetsPath, contractPath);
    log(
      `${budgetsPath}: ${String(budgets.length)} budget(s), every one citing the hardware baseline.`,
    );
    return 0;
  } catch (error) {
    for (const line of (error as Error).message.split('\n').slice(1)) {
      log(`::error title=Perf budgets,file=${budgetsPath}::${line.trim()}`);
    }
    log(String((error as Error).message.split('\n')[0]));
    return 1;
  }
}
