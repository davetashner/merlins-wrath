// Entry point: node scripts/backlog/generate-cli.ts [--no-github] [.beads/issues.jsonl] [backlog.html]
import { main } from './generate.ts';

process.exitCode = await main(process.argv.slice(2), process.env, new Date());
