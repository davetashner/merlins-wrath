// DOM wiring for the debug fly camera (mw-e00.21): F2 toggles it; while it is on, movement keys fly
// (and are kept from scrolling the page) and dragging on the canvas with any mouse button looks
// around. Losing focus drops held keys so the camera never keeps flying on its own.

import { DEBUG_CAMERA_TOGGLE_KEY, type DebugCamera } from './debug-camera';

type Listener = (event: Event) => void;

/** The part of EventTarget the wiring uses (window, the canvas, or a test double). */
export interface ListenerHost {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

export interface DebugCameraInputOptions {
  /** Receives keyboard and focus events (the window). */
  readonly keys: ListenerHost;
  /** Receives pointer events for mouse look (the canvas). */
  readonly surface: ListenerHost;
  /** Called after every toggle with the new state. */
  readonly onToggle?: (active: boolean) => void;
}

/** Wires `camera` to the DOM; returns a function that unwires it. */
export function bindDebugCameraInput(
  camera: DebugCamera,
  { keys, surface, onToggle }: DebugCameraInputOptions,
): () => void {
  let last: { x: number; y: number } | undefined;
  const listeners: [ListenerHost, string, Listener][] = [
    [
      keys,
      'keydown',
      (event) => {
        const key = event as KeyboardEvent;
        if (key.code === DEBUG_CAMERA_TOGGLE_KEY) {
          key.preventDefault();
          if (key.repeat) return;
          const active = camera.toggle(); // not inside `onToggle?.()`: it must run either way
          onToggle?.(active);
        } else if (camera.keyDown(key.code)) {
          key.preventDefault();
        }
      },
    ],
    [
      keys,
      'keyup',
      (event) => {
        camera.keyUp((event as KeyboardEvent).code);
      },
    ],
    [
      keys,
      'blur',
      () => {
        camera.clear();
      },
    ],
    [
      surface,
      'pointerdown',
      (event) => {
        const pointer = event as PointerEvent;
        last = { x: pointer.clientX, y: pointer.clientY };
      },
    ],
    [
      surface,
      'pointermove',
      (event) => {
        const pointer = event as PointerEvent;
        if (pointer.buttons !== 0 && last !== undefined) {
          camera.look(pointer.clientX - last.x, pointer.clientY - last.y);
        }
        last = { x: pointer.clientX, y: pointer.clientY };
      },
    ],
  ];
  for (const [host, type, listener] of listeners) host.addEventListener(type, listener);
  return () => {
    for (const [host, type, listener] of listeners) host.removeEventListener(type, listener);
  };
}
