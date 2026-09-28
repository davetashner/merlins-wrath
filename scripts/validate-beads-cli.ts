// Entry point: node scripts/validate-beads-cli.ts [.beads/issues.jsonl]
import { main } from './validate-beads.ts';

process.exitCode = main(process.argv.slice(2));
