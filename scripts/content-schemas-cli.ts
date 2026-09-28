// Entry point: node scripts/content-schemas-cli.ts [--check]
import { main } from './content-schemas.ts';

process.exitCode = main(process.argv.slice(2));
