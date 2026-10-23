// The order a queue plays in, with no DOM and no media in it: which entry is next, which is
// previous, what repeat and shuffle do. The player drives it and draws the result.

export type RepeatMode = "off" | "all" | "one";

/** Past this many seconds, Previous restarts the entry instead of going back. */
export const RESTART_AFTER = 3;

export interface QueueOptions {
  repeat?: RepeatMode;
  shuffle?: boolean;
  startIndex?: number;
  /** Injectable so a test can fix the shuffle. */
  random?: () => number;
}

export class PlayQueue {
  private n: number;
  private cur: number;
  private repeatMode: RepeatMode;
  private shuffled: boolean;
  private readonly random: () => number;
  /** Entry indices in the order they play; the identity unless shuffle is on. */
  private order: number[];
  private pos: number;

  constructor(count: number, opts: QueueOptions = {}) {
    this.n = count;
    this.cur = count ? Math.min(Math.max(opts.startIndex ?? 0, 0), count - 1) : 0;
    this.repeatMode = opts.repeat ?? "off";
    this.shuffled = !!opts.shuffle;
    this.random = opts.random ?? Math.random;
    this.order = [];
    this.pos = 0;
    this.rebuild();
  }

  get length(): number {
    return this.n;
  }
  get index(): number {
    return this.cur;
  }
  get repeat(): RepeatMode {
    return this.repeatMode;
  }
  get shuffle(): boolean {
    return this.shuffled;
  }
  /** Entry indices in play order, for drawing the list the way it will play. */
  playOrder(): readonly number[] {
    return this.order;
  }

  setRepeat(mode: RepeatMode): void {
    this.repeatMode = mode;
  }

  setShuffle(on: boolean): void {
    if (on === this.shuffled) return;
    this.shuffled = on;
    this.rebuild();
  }

  /**
   * The entry after this one, or null when playback should stop. `auto` is the entry ending
   * by itself, which stops after the last one unless repeat is on. A person pressing Next on
   * the last entry is asking for another, so it wraps to the first whatever repeat says.
   */
  next(auto: boolean): number | null {
    if (!this.n) return null;
    if (auto && this.repeatMode === "one") return this.cur;
    if (this.pos + 1 < this.n) return this.land(this.pos + 1);
    if (this.repeatMode === "all" || !auto) {
      if (this.shuffled) this.reshuffleKeepingLastApart();
      return this.land(0);
    }
    return null;
  }

  /** Back one entry, or the start of this one when it has played a while or nothing precedes it. */
  previous(playedSeconds: number): number {
    if (!this.n) return 0;
    if (playedSeconds > RESTART_AFTER) return this.cur;
    if (this.pos > 0) return this.land(this.pos - 1);
    if (this.repeatMode === "all") return this.land(this.n - 1);
    return this.cur;
  }

  /** Jump to an entry; the play order carries on from there. */
  goTo(index: number): number {
    if (index < 0 || index >= this.n) return this.cur;
    this.pos = this.order.indexOf(index);
    this.cur = index;
    return index;
  }

  /**
   * Take an entry out. Returns what should play now: the same entry (still), another one
   * because the playing one went, or null when nothing is left.
   */
  remove(index: number): { removedCurrent: boolean; play: number | null } {
    if (index < 0 || index >= this.n) return { removedCurrent: false, play: this.n ? this.cur : null };
    const removedCurrent = index === this.cur;
    const removedPos = this.order.indexOf(index);
    this.order.splice(removedPos, 1);
    for (let i = 0; i < this.order.length; i++) if (this.order[i]! > index) this.order[i] = this.order[i]! - 1;
    this.n--;
    if (!this.n) {
      this.cur = 0;
      this.pos = 0;
      return { removedCurrent, play: null };
    }
    if (!removedCurrent) {
      if (index < this.cur) this.cur--;
      this.pos = this.order.indexOf(this.cur);
      return { removedCurrent: false, play: this.cur };
    }
    // The next in order slides into the removed slot; at the end, the new last one plays.
    this.pos = Math.min(removedPos, this.n - 1);
    this.cur = this.order[this.pos]!;
    return { removedCurrent: true, play: this.cur };
  }

  /** Append entries. Shuffled, they land at random places after the current one. */
  add(count: number): void {
    for (let k = 0; k < count; k++) {
      const entry = this.n++;
      if (!this.shuffled || this.order.length <= this.pos + 1) {
        this.order.push(entry);
      } else {
        const room = this.order.length - (this.pos + 1);
        this.order.splice(this.pos + 1 + Math.floor(this.random() * (room + 1)), 0, entry);
      }
    }
    this.pos = this.order.indexOf(this.cur);
  }

  private land(pos: number): number {
    this.pos = pos;
    this.cur = this.order[pos]!;
    return this.cur;
  }

  private rebuild(): void {
    const ids = Array.from({ length: this.n }, (_, i) => i);
    if (!this.shuffled) {
      this.order = ids;
      this.pos = this.cur;
      return;
    }
    // The playing entry leads, so turning shuffle on does not cut it off.
    const rest = ids.filter((i) => i !== this.cur);
    this.shuffleInPlace(rest);
    this.order = this.n ? [this.cur, ...rest] : [];
    this.pos = 0;
  }

  /** A new pass after the last entry: reshuffle, and do not open with what just ended. */
  private reshuffleKeepingLastApart(): void {
    const last = this.order[this.n - 1]!;
    this.shuffleInPlace(this.order);
    if (this.n > 1 && this.order[0] === last) {
      const swap = 1 + Math.floor(this.random() * (this.n - 1));
      [this.order[0], this.order[swap]] = [this.order[swap]!, this.order[0]!];
    }
  }

  private shuffleInPlace(a: number[]): void {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
  }
}
