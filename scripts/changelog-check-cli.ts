// Entry point: PR_AUTHOR=… PR_LABELS='["…"]' node scripts/changelog-check-cli.ts <changed-files.txt> [CHANGELOG.md]
import { main } from './changelog-check.ts';

process.exitCode = main(process.argv.slice(2), process.env);
