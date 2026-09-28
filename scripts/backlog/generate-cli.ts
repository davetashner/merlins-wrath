// Entry point: node scripts/backlog/generate-cli.ts [.beads/issues.jsonl] [backlog.html]
import { main } from './generate.ts';

process.exitCode = main(process.argv.slice(2), process.env, new Date());
