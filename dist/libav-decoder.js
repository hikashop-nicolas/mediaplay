// A mediabunny CustomAudioDecoder backed by a custom libav.js build that decodes the
// Dolby AC-3 / E-AC-3 family (the codecs browsers refuse). libav runs in its own Web
// Worker (the non-threaded "wasm" variant, so no cross-origin isolation is required),
// so decoding stays off the main thread. Registered once; mediabunny then uses it
// automatically for ac3/eac3 whenever WebCodecs can't.
//
// The WASM/glue are served as static assets (like the libass octopus assets): the host
// serves three files under a base URL and mediaplay dynamically imports the loader from
// there. This keeps the ~0.9 MB decoder out of the main bundle and lazy.
import { CustomAudioDecoder, registerDecoder, AudioSample } from "mediabunny";
const LIBAV_LOADER = "libav-6.9.8.1-audio.mjs"; // the "audio" variant built in-repo (see libav/NOTICE.md)
let libavBase = "";
let libavPromise = null;
/** Set where the libav assets are served from (must end with "/"); call before decoding. */
export function setLibavBase(base) {
    libavBase = base.endsWith("/") ? base : base + "/";
}
/** Load the libav.js eac3 variant once, from the configured asset base. */
function loadLibav() {
    if (!libavPromise) {
        if (!libavBase)
            throw new Error("mediaplay: libav asset base not set");
        // noworker: run the decoder on the calling thread. In worker mode every per-packet
        // ff_decode_multi is a postMessage round-trip, which drags throughput below realtime;
        // direct calls decode at ~80x realtime (measured), easily keeping ahead of playback.
        libavPromise = importLibavLoader()
            .then((factory) => factory.LibAV({ base: libavBase, noworker: true }))
            .catch((e) => {
            // Don't cache the failure. A single failed dynamic import (e.g. a transient hiccup
            // or a Vite dep re-optimize race in dev) would otherwise poison libavPromise and
            // disable AC-3/E-AC-3 audio for the whole page session; clearing it allows a retry.
            libavPromise = null;
            throw e;
        });
    }
    return libavPromise;
}
/** Import the libav loader module, retrying past a poisoned module-map entry. The browser
 *  caches a failed dynamic import for the exact URL for the page's lifetime, so a plain
 *  retry returns the same rejection; a unique query string bypasses the cached failure. */
async function importLibavLoader() {
    const url = new URL(LIBAV_LOADER, libavBase).href;
    try {
        return await import(/* @vite-ignore */ url);
    }
    catch {
        return await import(/* @vite-ignore */ `${url}${url.includes("?") ? "&" : "?"}retry=${Date.now()}`);
    }
}
class LibavAc3Decoder extends CustomAudioDecoder {
    libav = null;
    ctx = 0;
    pkt = 0;
    frame = 0;
    // Output timestamp clock, re-anchored on any discontinuity (e.g. a seek that reuses us).
    clockTs = 0;
    clockSamples = 0;
    anchored = false;
    static supports(codec) {
        return codec === "eac3" || codec === "ac3";
    }
    async init() {
        this.libav = await loadLibav();
        const name = this.codec === "eac3" ? "eac3" : "ac3";
        const [, ctx, pkt, frame] = await this.libav.ff_init_decoder(name);
        this.ctx = ctx;
        this.pkt = pkt;
        this.frame = frame;
        // Do NOT force ctx.sample_fmt: decoders ignore it and output their native format
        // (E-AC-3 = FLTP, planar), and overriding it made the copyout misread the planar
        // frame as interleaved - yielding buffers whose second half was padding zeros
        // (16ms sound + 16ms silence per frame, i.e. chopped audio). emit() handles both
        // planar and interleaved frames as they come.
    }
    async decode(packet) {
        const frames = await this.libav.ff_decode_multi(this.ctx, this.pkt, this.frame, [{ data: packet.data }], false);
        this.emit(frames, packet.timestamp);
    }
    async flush() {
        const frames = await this.libav.ff_decode_multi(this.ctx, this.pkt, this.frame, [], true);
        this.emit(frames, undefined);
    }
    emit(frames, packetTs) {
        for (const f of frames) {
            const rate = f.sample_rate;
            // Planar frame (E-AC-3's native FLTP): f.data is an array of per-channel planes.
            // Concatenate them (mediabunny's "f32-planar" expects planes back to back).
            let data;
            let format;
            let channels;
            let nb;
            if (Array.isArray(f.data)) {
                const planes = f.data;
                channels = planes.length;
                nb = planes[0].length;
                data = new Float32Array(nb * channels);
                planes.forEach((p, i) => data.set(p, i * nb));
                format = "f32-planar";
            }
            else {
                data = f.data;
                channels = this.libav.ff_channels(f);
                nb = data.length / Math.max(1, channels);
                format = "f32";
            }
            // Re-anchor the clock if the input jumps (seek) or on the first frame; otherwise
            // advance it by the decoded frame length so timestamps stay monotonic and gap-free.
            const expected = this.clockTs + this.clockSamples / rate;
            if (packetTs !== undefined && (!this.anchored || Math.abs(packetTs - expected) > 0.1)) {
                this.clockTs = packetTs;
                this.clockSamples = 0;
                this.anchored = true;
            }
            const ts = this.clockTs + this.clockSamples / rate;
            this.clockSamples += nb;
            this.onSample(new AudioSample({ data, format, numberOfChannels: channels, sampleRate: rate, timestamp: ts }));
        }
    }
    async close() {
        if (this.ctx && this.libav) {
            try {
                await this.libav.ff_free_decoder(this.ctx, this.pkt, this.frame);
            }
            catch {
                /* worker already gone */
            }
        }
        this.ctx = this.pkt = this.frame = 0;
    }
}
let registered = false;
/** Register the AC-3/E-AC-3 decoder with mediabunny (idempotent). */
export function registerAc3Decoder() {
    if (registered)
        return;
    registerDecoder(LibavAc3Decoder);
    registered = true;
}
// --- direct decode API (bypasses mediabunny, whose codec model lacks DTS/TrueHD) ---
/** Matroska CodecID -> FFmpeg decoder name, for codecs our libav build decodes. */
export const MKV_LIBAV_CODECS = {
    A_AC3: "ac3",
    A_EAC3: "eac3",
    A_DTS: "dca",
    A_TRUEHD: "truehd",
    A_MLP: "mlp",
};
/** Normalize any libav sample array (s16/s32/f64...) to Float32 in [-1, 1]. */
function toF32(a) {
    if (a instanceof Float32Array)
        return a;
    const out = new Float32Array(a.length);
    if (a instanceof Int32Array)
        for (let i = 0; i < a.length; i++)
            out[i] = a[i] / 2147483648;
    else if (a instanceof Int16Array)
        for (let i = 0; i < a.length; i++)
            out[i] = a[i] / 32768;
    else if (a instanceof Uint8Array)
        for (let i = 0; i < a.length; i++)
            out[i] = (a[i] - 128) / 128;
    else
        for (let i = 0; i < a.length; i++)
            out[i] = a[i]; // f64 or already-float-ish
    return out;
}
/** Open a decoder for an FFmpeg codec name (see MKV_LIBAV_CODECS); caller feeds raw
 *  encoded packets (e.g. from readAudioPackets) and gets Float32 planes back. */
export async function createDirectAudioDecoder(ffName, base) {
    setLibavBase(base);
    const libav = await (libavPromise ?? loadLibav());
    const [, ctx, pkt, frame] = await libav.ff_init_decoder(ffName);
    const norm = (frames) => frames.map((f) => {
        if (Array.isArray(f.data)) {
            // Planar: one array per channel.
            const planes = f.data.map(toF32);
            return { rate: f.sample_rate, channels: planes.length, nb: planes[0]?.length ?? 0, planes };
        }
        // Interleaved: deinterleave into planes.
        const data = toF32(f.data);
        const ch = Math.max(1, libav.ff_channels(f));
        const nb = Math.floor(data.length / ch);
        const planes = [];
        for (let c = 0; c < ch; c++) {
            const p = new Float32Array(nb);
            for (let i = 0; i < nb; i++)
                p[i] = data[i * ch + c];
            planes.push(p);
        }
        return { rate: f.sample_rate, channels: ch, nb, planes };
    });
    return {
        async decode(packets) {
            if (!packets.length)
                return [];
            return norm(await libav.ff_decode_multi(ctx, pkt, frame, packets.map((data) => ({ data })), false));
        },
        async flush() {
            return norm(await libav.ff_decode_multi(ctx, pkt, frame, [], true));
        },
        close() {
            Promise.resolve(libav.ff_free_decoder(ctx, pkt, frame)).catch(() => undefined);
        },
    };
}
