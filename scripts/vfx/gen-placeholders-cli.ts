// Entry point: node scripts/vfx/gen-placeholders-cli.ts [--check] [--seed <n>]
import { loadRepoContent } from '../audio/gen-placeholders.ts';
import { main } from './gen-placeholders.ts';

process.exitCode = main(process.argv.slice(2), process.cwd(), loadRepoContent);
