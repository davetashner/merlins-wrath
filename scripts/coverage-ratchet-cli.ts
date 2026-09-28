// Entry point: node scripts/coverage-ratchet-cli.ts [options]. Logic lives in coverage-ratchet.ts.
import { main } from './coverage-ratchet.ts';

process.exitCode = main(process.argv.slice(2), process.env);
