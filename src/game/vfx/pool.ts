// Object pool (mw-e29.1): effect instances own typed arrays sized for their particles, so creating one
// per spawn would churn the garbage collector mid-fight. A pool is warmed up front (e.g. during a
// level load) and hands the same instances out again; `allocations` counts every instance it ever
// had to create, so a test can prove steady-state spawning allocates nothing.

export class Pool<T> {
  readonly #create: () => T;
  readonly #free: T[] = [];
  #allocations = 0;

  constructor(create: () => T) {
    this.#create = create;
  }

  /** Instances created so far (warm-up included). */
  get allocations(): number {
    return this.#allocations;
  }

  /** Idle instances ready to hand out. */
  get idle(): number {
    return this.#free.length;
  }

  /** Creates instances until at least `count` are idle. */
  warm(count: number): void {
    while (this.#free.length < count) this.#free.push(this.#make());
  }

  /** An idle instance, or a new one if none is idle. */
  acquire(): T {
    return this.#free.pop() ?? this.#make();
  }

  /** Returns an instance for reuse. The caller must not use it afterwards. */
  release(item: T): void {
    this.#free.push(item);
  }

  #make(): T {
    this.#allocations++;
    return this.#create();
  }
}
