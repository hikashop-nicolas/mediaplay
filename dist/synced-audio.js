// Plays an audio track the browser can't decode, in sync with a (muted) video element.
//
// mediabunny demuxes and, via our registered libav CustomAudioDecoder, decodes the
// track to AudioBuffers on demand. This engine schedules those buffers on a Web Audio
// AudioContext against the video's own clock (the video stays the timing master), and
// keeps them aligned through play, pause, seek and rate changes. Each buffer is placed
// relative to the LIVE video.currentTime, so the stream is self-correcting: any small
// offset introduced by a transition is absorbed within a few (32 ms) buffers.
import { Input, ALL_FORMATS, BufferSource, AudioBufferSink } from "mediabunny";
import { setLibavBase, registerAc3Decoder, createDirectAudioDecoder, MKV_LIBAV_CODECS } from "./libav-decoder";
import { readAudioPackets, extractMkvInfo } from "./mkv";
const LOOKAHEAD = 1.5; // seconds of audio to keep scheduled ahead (survives main-thread stalls)
const LEAD_IN = 0.05; // small audio-clock headroom at anchor (also the residual A/V offset)
// Re-anchor only on a LARGE desync (a real problem), not momentary video hitches. When
// the video stutters (e.g. a busy main thread), re-anchoring would gap the audio; instead
// let it keep playing from its buffer and re-align as the video recovers.
const DRIFT_MAX = 1.0;
const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));
class SyncedAudio {
    video;
    ctx;
    source;
    gain; // master output (buffer sources -> gain -> analyser -> speakers)
    analyser;
    token = 0;
    active = new Set();
    disposed = false;
    listeners = [];
    cleanups = [];
    restartTimer = 0;
    pauseTimer = 0;
    currentIter = null;
    reseeks = 0;
    // Until the first user gesture the video stays force-muted (that's what let it
    // autoplay), so video.muted can't be honored yet; after the gesture unmutes it, the
    // element's muted/volume drive the gain natively (M key, arrows, the controls' slider).
    muteSynced = false;
    constructor(video, source) {
        this.video = video;
        this.ctx = new AudioContext();
        this.gain = this.ctx.createGain();
        this.analyser = this.ctx.createAnalyser();
        this.gain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        // Test hook: lets an instrumented page (demo/gaptest) attach an analyzer to the graph.
        globalThis.__mediaplayDebugTap?.(this.ctx, this.gain);
        this.source = source;
        const on = (ev, fn) => {
            this.video.addEventListener(ev, fn);
            this.listeners.push([ev, fn]);
        };
        // Suspending the context on pause freezes scheduled audio in place, aligned with
        // the paused video; resuming continues both together.
        on("play", () => {
            // A stuttering video (big file) fires rapid pause/play; do NOT restart the pipeline
            // here (that would gap the audio every hitch). Just cancel a pending suspend and
            // keep playing; the drift check re-aligns if the stutter caused real desync.
            window.clearTimeout(this.pauseTimer);
            void this.ctx.resume();
        });
        on("pause", () => {
            // Debounce: only suspend on a sustained pause, so momentary stalls don't chop audio.
            window.clearTimeout(this.pauseTimer);
            this.pauseTimer = window.setTimeout(() => {
                if (this.video.paused)
                    void this.ctx.suspend();
            }, 300);
        });
        // A seek invalidates everything queued; drop it and re-decode from the new point.
        on("seeking", () => {
            this.stopActive();
            this.token++;
        });
        on("seeked", () => this.restart());
        on("ratechange", () => this.restart());
        // Volume / mute: mirror the video element's state onto the decoded-audio gain, so
        // the player's M / arrow keys and the native controls' volume slider all work.
        on("volumechange", () => this.applyVolume());
        this.applyVolume();
        // The context is created after async work (demux/probe), so it's outside the
        // original user gesture and starts "suspended"; browsers then block resume() until
        // the next interaction. Resume on any gesture until it's actually running. The same
        // first gesture also lifts the autoplay force-mute on the video element (its native
        // track is silent anyway), after which muted/volume are honored natively.
        const tryResume = () => {
            if (this.disposed)
                return removeGesture();
            if (!this.muteSynced) {
                this.muteSynced = true;
                this.video.muted = false;
                this.applyVolume();
            }
            // Prime the context inside this gesture so a later resume() (on play) is allowed,
            // but if the video isn't playing yet keep it idle, so audio doesn't run ahead of a
            // paused video (embedded hosts open paused). Stop listening only once it's running
            // during playback.
            void this.ctx.resume().then(() => {
                if (this.video.paused && this.ctx.state === "running")
                    return this.ctx.suspend();
            });
            if (this.ctx.state === "running" && !this.video.paused)
                removeGesture();
        };
        const gestures = ["pointerdown", "keydown", "touchstart"];
        const removeGesture = () => gestures.forEach((ev) => document.removeEventListener(ev, tryResume));
        gestures.forEach((ev) => document.addEventListener(ev, tryResume, { passive: true }));
        this.cleanups.push(removeGesture);
    }
    /** Decoded-audio gain follows the video element's volume (and, once the autoplay
     *  force-mute has been lifted, its muted flag). */
    applyVolume() {
        this.gain.gain.value = this.muteSynced && this.video.muted ? 0 : this.video.volume;
    }
    start() {
        // A fresh AudioContext is "running" when the page already has user activation (e.g.
        // the click that opened the file). If the video is paused (an embedded host opens
        // paused), suspend it so decoded audio doesn't play on its own; the play handler
        // resumes it when the video actually starts.
        if (this.video.paused)
            void this.ctx.suspend();
        this.restart();
    }
    /** Stop the current run and (debounced) start a fresh one at the live position. A
     *  scrub fires many seek events; coalescing them avoids spinning up a decode pipeline
     *  per event. */
    restart() {
        if (this.disposed)
            return;
        this.token++; // invalidate the running loop immediately (stops scheduling)
        this.stopActive();
        window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => void this.launch(), 120);
    }
    /** Single-flight decode: close the previous iterator (freeing its decoder in the libav
     *  worker) before opening a new one, so decoders never pile up and OOM the worker. */
    async launch() {
        if (this.disposed)
            return;
        const myToken = ++this.token;
        const prev = this.currentIter;
        this.currentIter = null;
        if (prev) {
            try {
                await prev.return();
            }
            catch {
                /* iterator already finished */
            }
        }
        if (myToken !== this.token || this.disposed)
            return; // superseded while closing
        const iter = this.source.buffers(this.video.currentTime, this.ctx);
        this.currentIter = iter;
        await this.run(myToken, iter);
    }
    stopActive() {
        for (const n of this.active) {
            try {
                n.stop();
                n.disconnect();
            }
            catch {
                /* already stopped */
            }
        }
        this.active.clear();
    }
    async run(token, iter) {
        if (this.ctx.state === "suspended" && !this.video.paused) {
            try {
                await this.ctx.resume();
            }
            catch {
                /* needs a user gesture; the next play/gesture will resume */
            }
        }
        let scheduled = 0;
        // Anchor mapping media-time <-> audio-clock time, fixed for this run so buffers are
        // laid down contiguously (gapless). The video clock is used only to establish the
        // anchor and to detect drift; per-buffer live-clock scheduling made the audio jitter.
        let anchorCtx = 0;
        let anchorMedia = 0;
        let nextWhen = 0; // running audio-clock cursor: the next buffer starts exactly here
        let anchored = false;
        try {
            for await (const { buffer, timestamp, duration } of iter) {
                if (token !== this.token || this.disposed)
                    return;
                // Cold start: the first decoded buffer can arrive late, by which point the video
                // has run ahead. Re-seek the now-warm decoder to the live position rather than
                // decode-and-skip hundreds of stale buffers. Guarded + capped so it can't loop.
                if (!anchored && this.reseeks < 3 && !this.video.paused && this.video.currentTime - timestamp > 2) {
                    this.reseeks++;
                    this.restart();
                    return;
                }
                // Drop buffers before the live position (from a coarse seek) until we anchor.
                if (!anchored && timestamp < this.video.currentTime - 0.1)
                    continue;
                const rate = this.video.playbackRate || 1;
                if (!anchored) {
                    // Anchor: the live video position plays now (+ a small lead), so audio stays in
                    // sync. From here buffers are laid down back-to-back from the nextWhen cursor -
                    // sample-accurate, so there is no gap or overlap (and no click) between them.
                    anchorCtx = this.ctx.currentTime + LEAD_IN;
                    anchorMedia = this.video.currentTime;
                    nextWhen = anchorCtx;
                    anchored = true;
                }
                // Backpressure: keep at most LOOKAHEAD of audio scheduled ahead of the clock.
                while (nextWhen > this.ctx.currentTime + LOOKAHEAD && token === this.token && !this.disposed) {
                    await sleep(80);
                }
                if (token !== this.token || this.disposed)
                    return;
                // Drift: re-anchor only on a large desync (the two clocks tick slightly
                // differently over time); momentary video stutters are tolerated so audio is smooth.
                if (!this.video.paused && this.ctx.state === "running") {
                    const audioMediaNow = anchorMedia + (this.ctx.currentTime - anchorCtx) * rate;
                    if (Math.abs(audioMediaNow - this.video.currentTime) > DRIFT_MAX) {
                        this.restart();
                        return;
                    }
                }
                // If the cursor fell behind the clock (decode starved, rare), snap it up to now
                // instead of scheduling in the past. Otherwise buffers abut exactly.
                if (nextWhen < this.ctx.currentTime)
                    nextWhen = this.ctx.currentTime;
                const node = this.ctx.createBufferSource();
                node.buffer = buffer;
                node.playbackRate.value = rate;
                node.connect(this.gain);
                node.onended = () => this.active.delete(node);
                try {
                    node.start(nextWhen);
                }
                catch {
                    continue;
                }
                nextWhen += duration / rate;
                this.active.add(node);
                if (++scheduled === 1)
                    this.reseeks = 0;
            }
        }
        catch (e) {
            console.warn("[mediaplay:audio] scheduling stopped:", e);
        }
    }
    destroy() {
        this.disposed = true;
        this.token++;
        window.clearTimeout(this.restartTimer);
        window.clearTimeout(this.pauseTimer);
        void this.currentIter?.return();
        this.currentIter = null;
        this.stopActive();
        for (const [ev, fn] of this.listeners)
            this.video.removeEventListener(ev, fn);
        this.listeners.length = 0;
        for (const fn of this.cleanups)
            fn();
        this.cleanups.length = 0;
        try {
            void this.ctx.close();
        }
        catch {
            /* already closed */
        }
    }
}
/** mediabunny-backed source: demux + decode via the registered CustomAudioDecoder. */
function mediabunnySource(track) {
    const sink = new AudioBufferSink(track);
    return {
        async *buffers(fromTime) {
            yield* sink.buffers(fromTime);
        },
    };
}
/**
 * Direct Matroska -> libav source, for codecs mediabunny's codec model cannot carry
 * (DTS, TrueHD/MLP): read the track's encoded frames with our own EBML block reader,
 * decode them in batches, and coalesce the small decoded frames (TrueHD frames are
 * under 1 ms) into ~85 ms AudioBuffers so the scheduler isn't flooded with nodes.
 */
function mkvDirectSource(bytes, trackNumber, ffCodec, base, info) {
    const CHUNK = 4096; // min samples per emitted AudioBuffer
    const BATCH = 16; // encoded packets per decode call
    return {
        async *buffers(fromTime, ctx) {
            const dec = await createDirectAudioDecoder(ffCodec, base);
            try {
                let rate = 0;
                let channels = 0;
                let clockTs = 0; // media time of the next decoded sample
                let clockSamples = 0;
                let anchored = false;
                let chunkTs = null; // media time of the first pending sample
                let pend = [];
                let pendSamples = 0;
                const build = () => {
                    const buffer = ctx.createBuffer(Math.max(1, channels), pendSamples, rate || 48000);
                    for (let c = 0; c < channels; c++) {
                        const chd = buffer.getChannelData(c);
                        let o = 0;
                        for (const planes of pend) {
                            const p = planes[Math.min(c, planes.length - 1)];
                            chd.set(p, o);
                            o += p.length;
                        }
                    }
                    const chunk = { buffer, timestamp: chunkTs, duration: pendSamples / (rate || 48000) };
                    pend = [];
                    pendSamples = 0;
                    chunkTs = null;
                    return chunk;
                };
                const ingest = (frames) => {
                    const out = [];
                    for (const f of frames) {
                        if (!f.nb)
                            continue;
                        if (rate && (f.rate !== rate || f.channels !== channels) && pendSamples)
                            out.push(build());
                        rate = f.rate;
                        channels = f.channels;
                        if (chunkTs == null)
                            chunkTs = clockTs + clockSamples / rate;
                        pend.push(f.planes);
                        pendSamples += f.nb;
                        clockSamples += f.nb;
                        if (pendSamples >= CHUNK)
                            out.push(build());
                    }
                    return out;
                };
                let batch = [];
                let batchTs = 0;
                const packets = readAudioPackets(bytes, trackNumber, fromTime * 1000, info);
                for (const pkt of packets) {
                    if (!batch.length)
                        batchTs = pkt.tsMs / 1000;
                    batch.push(pkt.data);
                    if (batch.length < BATCH)
                        continue;
                    // Anchor/adjust the sample clock at batch boundaries (where a real container
                    // timestamp is known); laced frames inside a block share the block time.
                    const expected = clockTs + (rate ? clockSamples / rate : 0);
                    if (!anchored || Math.abs(batchTs - expected) > 0.25) {
                        if (pendSamples)
                            yield build();
                        clockTs = batchTs;
                        clockSamples = 0;
                        anchored = true;
                    }
                    const chunks = ingest(await dec.decode(batch));
                    batch = [];
                    for (const c of chunks)
                        yield c;
                }
                if (batch.length) {
                    const chunks = ingest(await dec.decode(batch));
                    for (const c of chunks)
                        yield c;
                }
                const tail = ingest(await dec.flush());
                for (const c of tail)
                    yield c;
                if (pendSamples)
                    yield build();
            }
            finally {
                dec.close();
            }
        },
    };
}
/**
 * Start playing `bytes`' audio track number `audioIndex` (index into the file's audio
 * tracks) in sync with `video`, decoding it with the bundled libav decoder served from
 * `base`. AC-3/E-AC-3 route through mediabunny; DTS/TrueHD/MLP need `direct` (Matroska
 * only) because mediabunny's codec model cannot carry them. The caller should mute
 * `video` first. Returns a handle, or "undecodable", or null if there's no such track.
 */
// Only one decoded-audio stream exists at a time. This is semantically right (you can't
// watch two videos at once) and defends against a host mounting the player more than once
// (e.g. a double-open race): a stale engine would otherwise keep its own AudioContext and
// decoder alive, overlapping audio and starving the decoder.
let currentEngine = null;
function stopCurrentEngine() {
    currentEngine?.destroy();
    currentEngine = null;
}
export async function playSyncedAudio(video, bytes, audioIndex, base, direct) {
    setLibavBase(base);
    registerAc3Decoder();
    // Tear down any previous stream up front, so two concurrent starts can't both run.
    stopCurrentEngine();
    try {
        let source;
        const ffCodec = direct ? MKV_LIBAV_CODECS[direct.mkvCodec.toUpperCase()] : undefined;
        if (direct && ffCodec && !/^A_E?AC3$/i.test(direct.mkvCodec)) {
            // DTS / TrueHD / MLP: our own EBML packet reader feeds libav directly.
            if (!direct.info.clusters.length)
                return "undecodable";
            source = mkvDirectSource(bytes, direct.mkvTrackNumber, ffCodec, base, direct.info);
        }
        else {
            // Pass the view directly (no copy): the file can be very large.
            const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
            const tracks = await input.getTracks();
            const audioTracks = tracks.filter((t) => t.isAudioTrack());
            const track = audioTracks[audioIndex] ?? audioTracks[0];
            if (!track)
                return null;
            source = mediabunnySource(track);
        }
        // A newer start may have happened while we awaited setup; it wins.
        stopCurrentEngine();
        const engine = new SyncedAudio(video, source);
        currentEngine = engine;
        engine.start();
        return {
            destroy: () => {
                engine.destroy();
                if (currentEngine === engine)
                    currentEngine = null;
            },
        };
    }
    catch (e) {
        console.warn("[mediaplay:audio] playSyncedAudio failed:", e);
        return "undecodable";
    }
}
/**
 * Decode a file's audio track to a downsampled waveform (absolute-peak buckets), using
 * the same codec routing as playback: mediabunny (with our libav decoder for AC-3/E-AC-3)
 * for most codecs, and the direct Matroska reader for DTS/TrueHD/MLP. It streams the
 * decoded PCM chunk by chunk and keeps only the peaks, so it works on codecs the browser
 * can't decode and on large files without holding the whole PCM in memory.
 */
export async function extractWaveformPeaks(bytes, opts = {}) {
    const peaksPerSec = opts.peaksPerSec ?? 100;
    const base = opts.base ?? new URL("libav/", document.baseURI).toString();
    const audioIndex = opts.audioIndex ?? 0;
    setLibavBase(base);
    registerAc3Decoder();
    // Route Dolby/DTS Matroska tracks through the direct decoder like the player does.
    let direct;
    try {
        const info = extractMkvInfo(bytes);
        const audio = info.audio[audioIndex] ?? info.audio[0];
        if (audio && MKV_LIBAV_CODECS[audio.codec.toUpperCase()]) {
            direct = { mkvTrackNumber: audio.number, mkvCodec: audio.codec, info };
        }
    }
    catch {
        /* not Matroska; fall through to mediabunny */
    }
    let source;
    const ffCodec = direct ? MKV_LIBAV_CODECS[direct.mkvCodec.toUpperCase()] : undefined;
    if (direct && ffCodec && !/^A_E?AC3$/i.test(direct.mkvCodec)) {
        if (!direct.info.clusters.length)
            return null;
        source = mkvDirectSource(bytes, direct.mkvTrackNumber, ffCodec, base, direct.info);
    }
    else {
        const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
        const tracks = await input.getTracks();
        const track = tracks.filter((t) => t.isAudioTrack())[audioIndex] ?? tracks.filter((t) => t.isAudioTrack())[0];
        if (!track)
            return null;
        source = mediabunnySource(track);
    }
    const ctx = new AudioContext();
    const STRIDE = 4; // sample stride for the peak scan (visual detail is fine)
    const peaks = [];
    try {
        for await (const chunk of source.buffers(0, ctx)) {
            if (opts.signal?.aborted)
                return null;
            const { buffer, timestamp } = chunk;
            const rate = buffer.sampleRate || 48000;
            const nch = buffer.numberOfChannels;
            const chans = [];
            for (let c = 0; c < nch; c += 1)
                chans.push(buffer.getChannelData(c));
            const len = buffer.length;
            for (let i = 0; i < len; i += STRIDE) {
                let a = 0;
                for (const ch of chans) {
                    const x = Math.abs(ch[i]);
                    if (x > a)
                        a = x;
                }
                const bucket = Math.floor((timestamp + i / rate) * peaksPerSec);
                if (bucket >= 0 && (peaks[bucket] === undefined || a > peaks[bucket]))
                    peaks[bucket] = a;
            }
            if (opts.onProgress && opts.durationHint)
                opts.onProgress(Math.min(1, timestamp / opts.durationHint));
        }
    }
    catch (e) {
        console.warn("[mediaplay:audio] extractWaveformPeaks failed:", e);
        if (!peaks.length)
            return null;
    }
    finally {
        void ctx.close();
    }
    const out = new Float32Array(peaks.length);
    for (let i = 0; i < peaks.length; i += 1)
        out[i] = peaks[i] ?? 0;
    return { peaks: out, peaksPerSec };
}
