// Entry point: node scripts/loot-check-cli.ts [--content dir]
import { main } from './loot-check.ts';

process.exitCode = main(process.argv.slice(2));
