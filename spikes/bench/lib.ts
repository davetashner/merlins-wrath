// Shared helpers for the spike harnesses: static server, build, bundle sizes, machine info, stats, browsers.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { cpus, loadavg, totalmem } from 'node:os';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const SPIKES_DIR = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------- CLI

export function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out.set(a.slice(2, eq), a.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out.set(a.slice(2), argv[++i]!);
    else out.set(a.slice(2), 'true');
  }
  return out;
}

// ---------------------------------------------------------------- build + sizes

export function run(cmd: string, cwd = SPIKES_DIR): void {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export interface SizeReport {
  jsRawKB: number;
  jsGzKB: number;
  wasmRawKB: number;
  wasmGzKB: number;
  /** JS + WASM gzip, excluding the shared glTF model (identical in every prototype). */
  codeGzKB: number;
}

const kb = (n: number): number => Math.round((n / 1024) * 10) / 10;

export function sizeOf(files: string[]): SizeReport {
  let jsRaw = 0;
  let jsGz = 0;
  let wasmRaw = 0;
  let wasmGz = 0;
  for (const f of files) {
    const buf = readFileSync(f);
    const gz = gzipSync(buf, { level: 9 }).length;
    if (f.endsWith('.js')) {
      jsRaw += buf.length;
      jsGz += gz;
    } else if (f.endsWith('.wasm')) {
      wasmRaw += buf.length;
      wasmGz += gz;
    }
  }
  return { jsRawKB: kb(jsRaw), jsGzKB: kb(jsGz), wasmRawKB: kb(wasmRaw), wasmGzKB: kb(wasmGz), codeGzKB: kb(jsGz + wasmGz) };
}

export function distSize(dir: string): SizeReport {
  return sizeOf(walk(dir));
}

// ---------------------------------------------------------------- static server

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
};

export interface StaticServer {
  url: string;
  /** Absolute paths of files served since the last reset. */
  served: Set<string>;
  close(): Promise<void>;
}

/** `onPost` receives JSON bodies POSTed to /__report (browsers we cannot drive report back this way). */
export async function serve(root: string, onPost?: (body: unknown) => void): Promise<StaticServer> {
  const served = new Set<string>();
  const server: Server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/__report' && onPost) {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        onPost(JSON.parse(body));
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end();
      });
      return;
    }
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    served.add(file);
    // No caching: every page load is a cold load, so TTFF includes download + compile.
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    served,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export function relativeTo(root: string, files: Iterable<string>): string[] {
  return [...files].map((f) => relative(root, f)).sort();
}

// ---------------------------------------------------------------- machine + noise

const sh = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

export interface MachineInfo {
  model: string;
  chip: string;
  cores: number;
  memoryGB: number;
  os: string;
  gpu: string;
  display: string;
  node: string;
}

export function machineInfo(): MachineInfo {
  const displays = sh('system_profiler SPDisplaysDataType');
  const pick = (re: RegExp): string => re.exec(displays)?.[1]?.trim() ?? '';
  return {
    model: sh('sysctl -n hw.model') || 'unknown',
    chip: sh('sysctl -n machdep.cpu.brand_string') || cpus()[0]?.model || 'unknown',
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: sh('sw_vers -productName') ? `${sh('sw_vers -productName')} ${sh('sw_vers -productVersion')} (${sh('sw_vers -buildVersion')})` : process.platform,
    gpu: `${pick(/Chipset Model: (.+)/)}${pick(/Total Number of Cores: (\d+)/) ? ` (${pick(/Total Number of Cores: (\d+)/)} GPU cores)` : ''}`,
    display: `${pick(/Display Type: (.+)/)} ${pick(/Resolution: (.+)/)}`.trim(),
    node: process.version,
  };
}

export interface NoiseSample {
  load1: number;
  power: string;
  lowPowerMode: boolean;
  thermal: string;
}

export function noise(): NoiseSample {
  const batt = sh('pmset -g batt');
  const therm = sh('pmset -g therm');
  return {
    load1: Math.round((loadavg()[0] ?? 0) * 100) / 100,
    power: /'([^']+)'/.exec(batt)?.[1] ?? 'unknown',
    lowPowerMode: /lowpowermode\s+1/.test(sh('pmset -g')),
    thermal: /No thermal warning/.test(therm) ? 'nominal' : therm.split('\n').slice(0, 2).join(' ') || 'unknown',
  };
}

/** Lightweight load gate: log the load average; optionally wait for it to drop, then proceed regardless. */
export async function loadGate(threshold: number, waitMinutes: number, log: (s: string) => void): Promise<boolean> {
  const deadline = Date.now() + waitMinutes * 60_000;
  let l = loadavg()[0] ?? 0;
  while (l > threshold && Date.now() < deadline) {
    log(`  load ${l.toFixed(2)} > ${String(threshold)}, waiting…`);
    await new Promise((r) => setTimeout(r, 5000));
    l = loadavg()[0] ?? 0;
  }
  const noisy = l > threshold;
  if (noisy) log(`  load ${l.toFixed(2)} > ${String(threshold)}: proceeding, block flagged noisy`);
  return noisy;
}

// ---------------------------------------------------------------- stats

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export const median = (xs: number[]): number => percentile([...xs].sort((a, b) => a - b), 50);
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  fps: number;
  /** Share of frames longer than 25 ms, i.e. a visibly missed 60 Hz frame. */
  over25pct: number;
  over33_3pct: number;
}

export function frameStats(xs: number[]): FrameStats {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    frames: xs.length,
    p50: round2(percentile(s, 50)),
    p95: round2(percentile(s, 95)),
    p99: round2(percentile(s, 99)),
    mean: round2(mean),
    fps: round2(1000 / mean),
    over25pct: round2((100 * xs.filter((x) => x > 25).length) / Math.max(1, xs.length)),
    over33_3pct: round2((100 * xs.filter((x) => x > 33.3).length) / Math.max(1, xs.length)),
  };
}

// ---------------------------------------------------------------- browsers

export interface BrowserChoice {
  id: string;
  label: string;
  /** undefined = Playwright's bundled browser. */
  executablePath: string | undefined;
  engine: 'chromium' | 'firefox' | 'webkit';
  /** Marketing version from the app bundle, when there is one (Brave's differs from its Chromium version). */
  appVersion: string;
}

const APPS: Record<string, { label: string; app: string; bin: string }> = {
  chrome: { label: 'Google Chrome', app: '/Applications/Google Chrome.app', bin: 'Contents/MacOS/Google Chrome' },
  brave: { label: 'Brave', app: '/Applications/Brave Browser.app', bin: 'Contents/MacOS/Brave Browser' },
  edge: { label: 'Microsoft Edge', app: '/Applications/Microsoft Edge.app', bin: 'Contents/MacOS/Microsoft Edge' },
};

export function chooseBrowser(id: string): BrowserChoice {
  if (id === 'chromium' || id === 'firefox' || id === 'webkit') {
    return { id, label: `Playwright ${id}`, executablePath: undefined, engine: id, appVersion: '' };
  }
  const app = APPS[id];
  const executablePath = app ? join(app.app, app.bin) : id;
  if (!existsSync(executablePath)) throw new Error(`browser not found: ${executablePath}`);
  const plist = app ? join(app.app, 'Contents/Info.plist') : '';
  let appVersion = '';
  if (plist && existsSync(plist)) {
    try {
      appVersion = execFileSync('defaults', ['read', plist.replace(/\.plist$/, ''), 'CFBundleShortVersionString'], {
        encoding: 'utf8',
      }).trim();
    } catch {
      appVersion = '';
    }
  }
  return { id, label: app?.label ?? id, executablePath, engine: 'chromium', appVersion };
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
