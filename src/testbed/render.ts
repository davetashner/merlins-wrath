// Render testbed bootstrap (mw-e00.19 AC-4): recreates the renderer bootstrap five times, disposing
// each one after its first frame, so e2e/render-boot.spec.ts can check that WebGL contexts are
// released rather than accumulating. Browser-only wiring around src/render/bootstrap.
import { createRenderBootstrap, type RenderBootstrap } from '@render/bootstrap/index';

const CYCLES = 5;
const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLOutputElement>('#status');
const button = document.querySelector<HTMLButtonElement>('#recreate');

function bootOnce(container: HTMLElement): Promise<RenderBootstrap> {
  return new Promise((resolve) => {
    const render: RenderBootstrap = createRenderBootstrap({
      container,
      onFirstFrame: () => {
        resolve(render);
      },
    });
  });
}

async function recreate(container: HTMLElement, out: HTMLOutputElement): Promise<void> {
  out.dataset['state'] = 'running';
  let current = await bootOnce(container);
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    current.dispose();
    current = await bootOnce(container);
    out.dataset['cycles'] = String(cycle);
  }
  out.dataset['state'] = 'done';
  out.textContent = `Recreated the renderer ${String(CYCLES)} times.`;
}

if (stage && status && button) {
  button.addEventListener('click', () => {
    button.disabled = true;
    recreate(stage, status).catch((error: unknown) => {
      status.dataset['state'] = 'failed';
      console.error(error);
    });
  });
}
