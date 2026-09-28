// The "safe to save" registry (mw-e30.5). Autosaves wait while the player is in combat or alerted,
// mid-air, or in dialogue — but save code must not know about combat, stealth or dialogue. Each of
// those systems registers a veto here instead: a check that names why now is not safe, or returns
// null when it has no objection. Resting (mw-e27.13) and quest beats reuse the same registry.

/** A system's objection: why saving now is unsafe, or null when it has none. */
export type SafetyVeto = () => string | null;

/** A veto that currently objects. */
export interface ActiveVeto {
  /** The id the veto was registered under, e.g. `combat`. */
  readonly id: string;
  /** Its reason, e.g. `enemies are hunting you`. */
  readonly reason: string;
}

/** Registered safety vetoes; it is safe when none of them objects. */
export class SafetyVetoes {
  private readonly vetoes = new Map<string, SafetyVeto>();

  /**
   * Registers a veto under a unique id. Returns a function that removes it again.
   * @throws RangeError when `id` is empty or already registered.
   */
  register(id: string, veto: SafetyVeto): () => void {
    if (id === '') throw new RangeError('a safety veto needs an id');
    if (this.vetoes.has(id)) throw new RangeError(`safety veto "${id}" is already registered`);
    this.vetoes.set(id, veto);
    return () => {
      if (this.vetoes.get(id) === veto) this.vetoes.delete(id);
    };
  }

  /** Every veto that objects right now, in registration order. */
  active(): ActiveVeto[] {
    const active: ActiveVeto[] = [];
    for (const [id, veto] of this.vetoes) {
      const reason = veto();
      if (reason !== null) active.push({ id, reason });
    }
    return active;
  }

  /** True when no registered veto objects. */
  isSafe(): boolean {
    return this.active().length === 0;
  }
}
