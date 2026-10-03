// Entry point: node scripts/perf/compare-cli.ts --current <report> [--baseline <main's report>].
// Logic lives in regression.ts (mw-e32.1 AC-5).
import { main } from './regression.ts';

process.exitCode = main(process.argv.slice(2), {
  log: (line) => {
    console.log(line);
  },
  env: process.env,
});
