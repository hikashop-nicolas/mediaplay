import { describe, expect, it } from "vitest";
import { PlayQueue } from "./queue";

/** A random source that counts through fixed values, so a shuffle is the same every run. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

/** Everything a queue plays on one pass, by pressing Next until it stops. */
function playThrough(q: PlayQueue, limit = 50): number[] {
  const seen = [q.index];
  for (let i = 0; i < limit; i++) {
    const n = q.next(true);
    if (n === null) break;
    seen.push(n);
  }
  return seen;
}

describe("a queue in order", () => {
  it("plays each entry once and stops at the end with repeat off", () => {
    expect(playThrough(new PlayQueue(4))).toEqual([0, 1, 2, 3]);
  });

  it("starts where it is told to", () => {
    expect(playThrough(new PlayQueue(4, { startIndex: 2 }))).toEqual([2, 3]);
  });

  it("wraps to the first entry with repeat all", () => {
    const q = new PlayQueue(3, { repeat: "all", startIndex: 2 });
    expect(q.next(true)).toBe(0);
    expect(q.next(true)).toBe(1);
  });

  it("stays on the same entry when it ends with repeat one", () => {
    const q = new PlayQueue(3, { repeat: "one", startIndex: 1 });
    expect(q.next(true)).toBe(1);
    expect(q.next(true)).toBe(1);
  });

  it("still moves on when a person presses Next with repeat one", () => {
    const q = new PlayQueue(3, { repeat: "one" });
    expect(q.next(false)).toBe(1);
  });

  it("does nothing when Next is pressed on the last entry with repeat off", () => {
    const q = new PlayQueue(2, { startIndex: 1 });
    expect(q.next(false)).toBeNull();
    expect(q.index, "and it did not move").toBe(1);
  });

  it("goes back one entry, or restarts the one that has played a while", () => {
    const q = new PlayQueue(3, { startIndex: 2 });
    expect(q.previous(10), "past three seconds it restarts").toBe(2);
    expect(q.previous(1)).toBe(1);
    expect(q.previous(0)).toBe(0);
    expect(q.previous(0), "nothing before the first").toBe(0);
  });

  it("goes from the first entry to the last with repeat all", () => {
    const q = new PlayQueue(3, { repeat: "all" });
    expect(q.previous(0)).toBe(2);
  });

  it("has nothing to play when it is empty", () => {
    const q = new PlayQueue(0);
    expect(q.next(true)).toBeNull();
    expect(q.previous(0)).toBe(0);
  });

  it("jumps to an entry and carries on from there", () => {
    const q = new PlayQueue(5);
    expect(q.goTo(3)).toBe(3);
    expect(q.next(true)).toBe(4);
    expect(q.goTo(99), "an index that is not there changes nothing").toBe(4);
  });
});

describe("a shuffled queue", () => {
  it("plays every entry exactly once per pass", () => {
    const q = new PlayQueue(8, { shuffle: true, random: seeded(7) });
    const pass = playThrough(q);
    expect(pass).toHaveLength(8);
    expect([...pass].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("opens with the entry that is playing when shuffle is switched on", () => {
    const q = new PlayQueue(6, { startIndex: 4, random: seeded(3) });
    q.setShuffle(true);
    expect(q.playOrder()[0]).toBe(4);
    expect(q.index).toBe(4);
  });

  it("goes back through what was actually played, not through the list", () => {
    const q = new PlayQueue(6, { shuffle: true, random: seeded(11) });
    const forward = [q.index, q.next(false)!, q.next(false)!, q.next(false)!];
    expect(q.previous(0)).toBe(forward[2]);
    expect(q.previous(0)).toBe(forward[1]);
    expect(q.previous(0)).toBe(forward[0]);
  });

  it("reshuffles on a wrap, and does not open the next pass with the entry that just ended", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const q = new PlayQueue(5, { shuffle: true, repeat: "all", random: seeded(seed) });
      const first = playThrough(q, 4);
      const last = first[first.length - 1]!;
      const wrapped = q.next(true)!;
      expect(wrapped, `seed ${seed}`).not.toBe(last);
    }
  });

  it("stops at the end of a pass with repeat off", () => {
    const q = new PlayQueue(3, { shuffle: true, random: seeded(2) });
    playThrough(q);
    expect(q.next(true)).toBeNull();
  });

  it("returns to list order when shuffle is switched off, from where it is", () => {
    const q = new PlayQueue(5, { shuffle: true, random: seeded(5) });
    q.next(false);
    const at = q.index;
    q.setShuffle(false);
    expect(q.playOrder()).toEqual([0, 1, 2, 3, 4]);
    expect(q.next(false)).toBe(at + 1 > 4 ? null : at + 1);
  });
});

describe("changing the queue while it plays", () => {
  it("takes out an entry behind the playing one without losing the place", () => {
    const q = new PlayQueue(5, { startIndex: 3 });
    expect(q.remove(1)).toEqual({ removedCurrent: false, play: 2 });
    expect(q.index, "entry 3 is entry 2 now").toBe(2);
    expect(q.next(true)).toBe(3);
  });

  it("takes out an entry after the playing one", () => {
    const q = new PlayQueue(5, { startIndex: 1 });
    q.remove(3);
    expect(q.index).toBe(1);
    expect(playThrough(q)).toEqual([1, 2, 3]);
  });

  it("plays the next entry when the playing one is removed", () => {
    const q = new PlayQueue(4, { startIndex: 1 });
    expect(q.remove(1)).toEqual({ removedCurrent: true, play: 1 });
    expect(q.length).toBe(3);
  });

  it("plays the new last entry when the playing last one is removed", () => {
    const q = new PlayQueue(3, { startIndex: 2 });
    expect(q.remove(2)).toEqual({ removedCurrent: true, play: 1 });
  });

  it("reports nothing left to play when the last entry goes", () => {
    const q = new PlayQueue(1);
    expect(q.remove(0)).toEqual({ removedCurrent: true, play: null });
    expect(q.next(true)).toBeNull();
  });

  it("keeps a shuffled order intact around a removal", () => {
    const q = new PlayQueue(6, { shuffle: true, random: seeded(9) });
    q.next(false);
    const keep = q.index;
    const victim = q.playOrder().find((i) => i !== keep && i !== q.playOrder()[0])!;
    q.remove(victim);
    expect(q.length).toBe(5);
    expect([...q.playOrder()].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(q.playOrder()[q.playOrder().indexOf(q.index)]).toBe(q.index);
  });

  it("adds entries at the end, and plays them", () => {
    const q = new PlayQueue(2);
    q.add(2);
    expect(q.length).toBe(4);
    expect(playThrough(q)).toEqual([0, 1, 2, 3]);
  });

  it("slots added entries after the current one when shuffled, never before it", () => {
    const q = new PlayQueue(4, { shuffle: true, random: seeded(4) });
    q.next(false);
    const playedSoFar = q.playOrder().slice(0, q.playOrder().indexOf(q.index) + 1);
    q.add(3);
    expect(q.playOrder().slice(0, playedSoFar.length)).toEqual(playedSoFar);
    expect(new Set(q.playOrder()).size).toBe(7);
  });

  it("starts a queue that was empty when entries arrive", () => {
    const q = new PlayQueue(0);
    q.add(3);
    expect(q.index).toBe(0);
    expect(playThrough(q)).toEqual([0, 1, 2]);
  });
});
