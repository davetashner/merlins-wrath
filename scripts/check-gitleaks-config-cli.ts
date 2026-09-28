// Entry point: node scripts/check-gitleaks-config-cli.ts [path/to/.gitleaks.toml]
import { main } from './check-gitleaks-config.ts';

process.exitCode = main(process.argv.slice(2));
