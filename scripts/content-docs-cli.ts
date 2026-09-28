// Entry point: node scripts/content-docs-cli.ts [--check]
import { main } from './content-docs.ts';

process.exitCode = main(process.argv.slice(2));
