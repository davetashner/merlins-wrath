// Entry point: PR_BODY=… PR_AUTHOR=… PR_LABELS='["…"]' node scripts/pr-body-lint-cli.ts [.beads/issues.jsonl]
import { main } from './pr-body-lint.ts';

process.exitCode = main(process.argv.slice(2), process.env);
