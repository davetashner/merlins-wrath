// Tiny element builder shared by the component kit (mw-e00.23).

export interface ElementProps {
  readonly className?: string;
  readonly text?: string;
  /** Attributes (role, aria-*, tabindex…). */
  readonly attrs?: Readonly<Record<string, string>>;
  /** `data-*` values, keyed without the prefix. */
  readonly data?: Readonly<Record<string, string>>;
}

/** Creates `<tag>` in the page's document with the given props and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className !== undefined) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value);
  for (const [name, value] of Object.entries(props.data ?? {})) el.dataset[name] = value;
  el.append(...children);
  return el;
}

let nextId = 0;

/** A document-unique id for aria-controls / aria-describedby links. */
export function uid(prefix: string): string {
  nextId += 1;
  return `${prefix}-${String(nextId)}`;
}
