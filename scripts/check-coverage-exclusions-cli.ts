// Entry point: node scripts/check-coverage-exclusions-cli.ts [--summary f] [--config f] [--exclusions f] [--layers f]
import { main } from './check-coverage-exclusions.ts';

process.exitCode = await main(process.argv.slice(2));
