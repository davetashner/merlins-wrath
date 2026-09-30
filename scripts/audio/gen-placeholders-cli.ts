// Entry point: node scripts/audio/gen-placeholders-cli.ts [--check]
import { main } from './gen-placeholders.ts';

process.exitCode = main(process.argv.slice(2));
