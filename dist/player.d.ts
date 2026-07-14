import { type MediaStrings } from "./i18n";
/** The file to play. */
export interface MediaSource {
    /** The media, ideally as a disk-backed Blob/File so playback, remux and extraction read it
     * on demand instead of holding the whole (multi-GB) file in RAM. `bytes` is still accepted
     * for callers that already have the data in memory; provide one or the other. */
    blob?: Blob;
    bytes?: Uint8Array;
    /** MIME type; decides <audio> vs <video> and seeds the blob type. */
    mime?: string;
    /** File name (currently informational; reserved for future export naming). */
    filename?: string;
}
/** Where the libass (SubtitlesOctopus) worker + fallback font are served from. */
export interface LibassAssets {
    /** Same-origin URL of subtitles-octopus-worker.js (its .wasm sits beside it). */
    workerUrl?: string;
    /** URL of the Latin fallback font (default.woff2). */
    fontUrl?: string;
    /** Extra font URLs for libass (e.g. a CJK font); merged with any fonts embedded in the file. */
    fonts?: string[];
}
export interface MediaPlayerOptions {
    /** Called with a human-readable message when playback fails irrecoverably. */
    onError?: (message: string) => void;
    /** Override individual UI strings (a host with its own translations wins here). */
    strings?: Partial<MediaStrings>;
    /** Libass asset URLs; default to octopus/… relative to document.baseURI. */
    libass?: LibassAssets;
    /** AC-3/E-AC-3 libav decoder assets; `base` is the served dir (default libav/ under baseURI). */
    libav?: {
        base?: string;
    };
    /** Embedded mode (host drives the player, e.g. a subtitle editor): suppress the
     * document-level keyboard shortcuts and the CC/tracks button so the host owns both. */
    embedded?: boolean;
}
export interface MediaPlayerHandle {
    /** The original document bytes (the player never mutates them). */
    getBytes(): Uint8Array | undefined;
    /** The underlying <video>/<audio> element, for hosts that drive playback (seek,
     * currentTime, play/pause). Undefined until mounted, or for an empty source. */
    getMediaElement(): HTMLMediaElement | undefined;
    /** Show subtitles from raw text (SRT/VTT/ASS/SSA by filename), replacing any previously
     * set with this method. For live preview of an edited document; video sources only. */
    setSubtitleText(content: string, filename: string): void;
    /** Move keyboard focus into the player. */
    focus(): void;
    /** Tear down: stop playback, revoke blob URLs, remove listeners and DOM. */
    destroy(): void;
}
/**
 * Mount a read-only media player into `container` and start playing `source`.
 * Returns a handle to read the original bytes, focus, or tear the player down.
 */
export declare function createMediaPlayer(container: HTMLElement, source: MediaSource, opts?: MediaPlayerOptions): MediaPlayerHandle;
