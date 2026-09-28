// Audio testbed bootstrap (mw-e28.1 AC-6): a page that plays generated test cues through the real
// engine so e2e/audio.spec.ts can check the context unlocks and plays in Chromium, Firefox and
// WebKit. Browser-only wiring; the logic it calls is unit tested in src/audio. Until the greybox
// testbed (mw-e00.21) exists, this is its audio room.
import {
  createBrowserAudioEngine,
  encodeWav,
  installGestureUnlock,
  sineTone,
  SoundRegistry,
  type SoundHandle,
} from '@audio/index';

const RATE = 48_000;
const toneUrl = URL.createObjectURL(
  new Blob([encodeWav(sineTone(660, 0.4, RATE), RATE)], { type: 'audio/wav' }),
);

const registry = new SoundRegistry().register([
  { id: 'sfx-test-tone', variants: ['sfx-test-tone-01'], bus: 'ui', placeholder: true },
  {
    id: 'sfx-test-orbit',
    variants: ['sfx-test-tone-01'],
    bus: 'sfx',
    spatial: true,
    placeholder: true,
  },
]);

// The orbiting source: entity 1 circles the listener at 5 m.
let angle = 0;
const orbit = () => ({ x: 5 * Math.cos(angle), y: 0, z: 5 * Math.sin(angle) });

const engine = createBrowserAudioEngine({
  registry,
  resolveUrl: () => toneUrl,
  dev: import.meta.env.DEV,
  entityPosition: (entity) => (entity === 1 ? orbit() : undefined),
});
installGestureUnlock(document, engine);

const status = document.querySelector<HTMLOutputElement>('#status');
let last: SoundHandle | null = null;

document.querySelector('#play-2d')?.addEventListener('click', () => {
  last = engine.play('sfx-test-tone');
});
document.querySelector('#play-3d')?.addEventListener('click', () => {
  last = engine.play('sfx-test-orbit', { entity: 1 });
});

function frame(): void {
  angle += 0.05;
  engine.update();
  if (status) {
    const stats = engine.stats();
    status.dataset['state'] = stats.state;
    // Latches "playing" once seen, so a short cue that already ended still reads as played.
    if (last && status.dataset['cue'] !== 'playing') status.dataset['cue'] = last.state;
    status.textContent = `context: ${stats.state}, voices: ${String(stats.voices)}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
