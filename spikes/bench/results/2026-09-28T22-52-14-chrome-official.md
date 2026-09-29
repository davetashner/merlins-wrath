# Engine spike benchmark (official)

- **Date:** 2026-09-28T22:52:17.057Z
- **Browser:** Google Chrome 154.0.8037.58 (Chromium 154.0.8037.58)
- **Machine:** MacBookPro18,1, Apple M1 Pro, 10 cores, 16 GB
- **OS:** macOS 27.0 (26A428)
- **GPU:** Apple M1 Pro (16 GPU cores); WebGL: ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)
- **Display:** Built-in Liquid Retina XDR Display 3456 x 2234 Retina
- **Render size:** three-rapier 2560×1440, babylon-havok 2560×1440, babylon-rapier 2560×1440; window 1280×720 CSS px
- **Method:** 3 interleaved round(s) per engine; 5 s warm-up, 30 s sampled; median across rounds.
- **vsync:** on (default flags; frame interval capped at the display refresh, empty-page rAF 8.3 ms); off (--disable-gpu-vsync --disable-frame-rate-limit; uncapped, so the interval is real CPU+GPU throughput)

Frame = interval between successive frame starts (rAF cadence). CPU = main-thread time inside the frame callback. GPU = EXT_disjoint_timer_query_webgl2 time of the frame’s GL commands (n/a when not exposed).
Bundle = gzip -9 of JS + WASM actually fetched by the page (glTF model excluded, identical for all); dist = whole build output.

## vsync on

| Prototype | Frame p50 / p95 / p99 ms | FPS | >25 ms | CPU p50 / p95 ms | GPU p50 / p95 ms | Bundle gz KB (JS) | dist gz KB | TTFF ms | JS heap MB | Noise: load1 min–max, power |
|---|---|---|---|---|---|---|---|---|---|---|
| Three.js + Rapier | 8.3 / 10.2 / 10.4 | 120 | 0% | 5.4 / 5.9 | 8.5 / 11.45 | 1772 (1772) | 1772 | 280 | 27.96 (CDP 22.51) | 3.65–5.94, AC Power, 3 noisy |
| Babylon.js + Havok | 11.1 / 12.1 / 12.7 | 89.6 | 0% | 10.9 / 11.9 | 6.64 / 8.63 | 1313.3 (670) | 1588.6 | 800.6 | 104.22 (CDP 97.62) | 5.2–5.73, AC Power, 3 noisy |
| Babylon.js + Rapier | 10.7 / 11.7 / 12.3 | 92.29 | 0% | 10.6 / 11.5 | 6.58 / 8.71 | 2259.6 (2259.6) | 2534.9 | 840.8 | 117.12 (CDP 110.43) | 5.38–5.94, AC Power, 3 noisy |

<details><summary>Per round</summary>

| Prototype | Round | p50 / p95 / p99 ms | CPU p95 | TTFF | heap MB | load1 before→after |
|---|---|---|---|---|---|---|
| Three.js + Rapier | 1 | 8.3 / 10.3 / 10.4 | 6 | 1936.5 | 27.96 | 3.65→5.2 |
| Three.js + Rapier | 2 | 8.3 / 10.2 / 10.4 | 5.8 | 276.7 | 25.8 | 5.94→5.81 |
| Three.js + Rapier | 3 | 8.3 / 10.1 / 10.3 | 5.9 | 280 | 34.98 | 5.94→5.29 |
| Babylon.js + Havok | 1 | 11.2 / 12.3 / 12.7 | 12 | 1237.8 | 107.46 | 5.2→5.73 |
| Babylon.js + Havok | 2 | 11 / 12.1 / 12.7 | 11.9 | 800.6 | 104.22 | 5.59→5.38 |
| Babylon.js + Havok | 3 | 11.1 / 11.9 / 12.6 | 11.7 | 791.7 | 101.69 | 5.29→5.59 |
| Babylon.js + Rapier | 1 | 10.7 / 11.6 / 12.1 | 11.4 | 840.8 | 101.88 | 5.73→5.82 |
| Babylon.js + Rapier | 2 | 10.7 / 11.7 / 12.3 | 11.5 | 854.9 | 118.55 | 5.38→5.94 |
| Babylon.js + Rapier | 3 | 10.8 / 11.8 / 12.4 | 11.6 | 837.8 | 117.12 | 5.81→5.94 |

</details>

## vsync off

| Prototype | Frame p50 / p95 / p99 ms | FPS | >25 ms | CPU p50 / p95 ms | GPU p50 / p95 ms | Bundle gz KB (JS) | dist gz KB | TTFF ms | JS heap MB | Noise: load1 min–max, power |
|---|---|---|---|---|---|---|---|---|---|---|
| Three.js + Rapier | 5.5 / 5.9 / 6.5 | 181.61 | 0% | 5.3 / 5.7 | 6.67 / 7.54 | 1772 (1772) | 1772 | 354.1 | 33.88 (CDP 29.25) | 4.56–6.02, AC Power, 3 noisy |
| Babylon.js + Havok | 10.8 / 11.3 / 11.7 | 92.65 | 0% | 10.6 / 11.2 | 6.69 / 8.5 | 1313.3 (670) | 1588.6 | 859.6 | 105.92 (CDP 90.17) | 4.49–6.02, AC Power, 3 noisy |
| Babylon.js + Rapier | 10.3 / 10.9 / 11.4 | 96.59 | 0% | 10.2 / 10.8 | 6.62 / 8.5 | 2259.6 (2259.6) | 2534.9 | 915.6 | 112.64 (CDP 100.55) | 4.63–5.42, AC Power, 3 noisy |

<details><summary>Per round</summary>

| Prototype | Round | p50 / p95 / p99 ms | CPU p95 | TTFF | heap MB | load1 before→after |
|---|---|---|---|---|---|---|
| Three.js + Rapier | 1 | 5.7 / 6.2 / 6.8 | 6.1 | 365 | 35.25 | 5.59→6.02 |
| Three.js + Rapier | 2 | 5.5 / 5.9 / 6.5 | 5.7 | 354.1 | 33.88 | 4.94→4.63 |
| Three.js + Rapier | 3 | 5.5 / 5.8 / 6.3 | 5.7 | 330.6 | 28.84 | 5.24→4.56 |
| Babylon.js + Havok | 1 | 11 / 11.8 / 12.2 | 11.7 | 891.5 | 94.25 | 6.02→5.42 |
| Babylon.js + Havok | 2 | 10.7 / 11.2 / 11.6 | 11.1 | 859.6 | 105.92 | 5.06→5.03 |
| Babylon.js + Havok | 3 | 10.8 / 11.3 / 11.7 | 11.2 | 842.1 | 115.59 | 4.56→4.49 |
| Babylon.js + Rapier | 1 | 10.4 / 11.2 / 12 | 11.1 | 908.6 | 112.64 | 5.42→5.06 |
| Babylon.js + Rapier | 2 | 10.3 / 10.9 / 11.4 | 10.8 | 931.7 | 108.74 | 5.03→4.94 |
| Babylon.js + Rapier | 3 | 10.3 / 10.9 / 11.4 | 10.7 | 915.6 | 121.54 | 4.63→5.24 |

</details>

