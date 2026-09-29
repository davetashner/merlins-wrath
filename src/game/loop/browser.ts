// Browser frame sources for the frame loop (mw-e00.20): requestAnimationFrame, performance.now and
// the Page Visibility API, behind the interfaces the loop takes so tests can substitute fakes.
import type { FrameScheduler, TimeSource, VisibilitySource } from './fixed-step';

export interface BrowserFrameSources {
  readonly now: TimeSource;
  readonly scheduler: FrameScheduler;
  readonly visibility: VisibilitySource;
}

type BrowserHost = Pick<
  Window,
  'requestAnimationFrame' | 'cancelAnimationFrame' | 'performance'
> & {
  readonly document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
};

export function browserFrameSources(host: BrowserHost): BrowserFrameSources {
  const { document } = host;
  return {
    now: () => host.performance.now(),
    scheduler: {
      request: (callback) =>
        host.requestAnimationFrame(() => {
          callback();
        }),
      cancel: (handle) => {
        host.cancelAnimationFrame(handle);
      },
    },
    visibility: {
      get hidden() {
        return document.hidden;
      },
      subscribe(listener) {
        document.addEventListener('visibilitychange', listener);
        return () => {
          document.removeEventListener('visibilitychange', listener);
        };
      },
    },
  };
}
