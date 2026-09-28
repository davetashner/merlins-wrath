// Entry point: node scripts/content-coverage-cli.ts [--content dir] [--report file]
import { main } from './content-coverage.ts';

process.exitCode = main(process.argv.slice(2));
