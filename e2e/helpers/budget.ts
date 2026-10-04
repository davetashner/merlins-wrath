/**
 * A wall-clock budget for an e2e assertion (mw-e41.8). The contract budgets (backlog contract §1) are
 * for the reference machine with a GPU; CI runners render in software and measure the same code
 * 2.9-3.1 s against a 3 s budget. Locally the budget stays exact; on CI it gets a 2x allowance so a
 * slow runner does not fail the PR. The real budgets are enforced by the perf suite (mw-e32).
 */
export const CI_BUDGET_FACTOR = 2;

export function budgetMs(ms: number): number {
  return process.env['CI'] ? ms * CI_BUDGET_FACTOR : ms;
}
