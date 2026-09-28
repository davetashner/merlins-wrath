// Entry point: node scripts/dependency-audit-cli.ts [--audit audit.json] [--waivers audit-waivers.json] [--waivers-only]
import { main } from './dependency-audit.ts';

process.exitCode = main(process.argv.slice(2), process.env);
