// Entry point: node scripts/perf/budgets-cli.ts [budgets.json] [contract.md]. Validates the perf
// budget file against the hardware baseline (mw-e32.1 AC-6); logic lives in budgets-check.ts.
import { main } from './budgets-check.ts';

process.exitCode = main(process.argv.slice(2), (line) => {
  console.log(line);
});
