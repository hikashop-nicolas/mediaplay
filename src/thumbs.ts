// Timeline hover previews. Frames are decoded from the source bytes (mediabunny's
// CanvasSink), not from a second hidden <video>: that works for the files the browser
// cannot play natively (the remux path) and takes no extra video decoder, which is a
// scarce resource on mobile.

/** Width of a preview frame in CSS pixels; the height follows the aspect ratio. */
const WIDTH = 160;
/** Frames kept in memory (one per rounded second), oldest dropped first. */
const CACHE_MAX = 60;

export interface Thumbnailer {
  /** The frame at `time`, or null when none is decoded yet (a decode may be running). */
  get(time: number): Promise<HTMLCanvasElement | OffscreenCanvas | null>;
  /** Decode `count` frames spread over the duration, so the first hover is not blank. */
  prefetch(duration: number, count?: number): Promise<void>;
  destroy(): void;
}

/** Open `blob` for frame extraction. Null when it holds no decodable video track. */
export async function createThumbnailer(blob: Blob): Promise<Thumbnailer | null> {
  const mb = await import("mediabunny");
  let sink: InstanceType<typeof mb.CanvasSink>;
  try {
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    sink = new mb.CanvasSink(track, { width: WIDTH, fit: "contain" });
  } catch {
    return null;
  }
  const cache = new Map<number, HTMLCanvasElement | OffscreenCanvas>();
  let dead = false;
  let busy = false; // one decode at a time; a hover during one is answered by the next call

  const get = async (time: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> => {
    const key = Math.max(0, Math.round(time));
    const hit = cache.get(key);
    if (hit || dead || busy) return hit ?? null;
    busy = true;
    try {
      const frame = await sink.getCanvas(key);
      if (dead || !frame) return null;
      cache.set(key, frame.canvas);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      return frame.canvas;
    } catch {
      return null;
    } finally {
      busy = false;
    }
  };

  return {
    get,
    async prefetch(duration, count = 12) {
      if (!Number.isFinite(duration) || duration <= 0) return;
      for (let i = 0; i < count && !dead; i++) await get(((i + 0.5) * duration) / count);
    },
    destroy() {
      dead = true;
      cache.clear();
    },
  };
}
