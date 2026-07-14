import { type MkvInfo } from "./mkv";
export interface SyncedAudioHandle {
    destroy(): void;
}
/** Direct-decode routing for playSyncedAudio: the Matroska metadata of the chosen track. */
export interface DirectAudioInfo {
    /** Matroska TrackNumber of the audio track. */
    mkvTrackNumber: number;
    /** Matroska CodecID (e.g. A_DTS). */
    mkvCodec: string;
    /** The parse result of extractMkvInfo (cluster index + timestamp scale). */
    info: MkvInfo;
}
export declare function playSyncedAudio(video: HTMLMediaElement, blob: Blob, audioIndex: number, base: string, direct?: DirectAudioInfo): Promise<SyncedAudioHandle | "undecodable" | null>;
export interface WaveformPeaks {
    peaks: Float32Array;
    peaksPerSec: number;
}
/**
 * Decode a file's audio track to a downsampled waveform (absolute-peak buckets), using
 * the same codec routing as playback: mediabunny (with our libav decoder for AC-3/E-AC-3)
 * for most codecs, and the direct Matroska reader for DTS/TrueHD/MLP. It streams the
 * decoded PCM chunk by chunk and keeps only the peaks, so it works on codecs the browser
 * can't decode and on large files without holding the whole PCM in memory.
 */
export declare function extractWaveformPeaks(bytes: Uint8Array, opts?: {
    base?: string;
    peaksPerSec?: number;
    audioIndex?: number;
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
    durationHint?: number;
}): Promise<WaveformPeaks | null>;
/**
 * Decode a file's audio track to 16 kHz mono PCM (what speech recognisers like Whisper expect),
 * streaming from a Blob on disk. Unlike the browser's decodeAudioData this goes through
 * mediabunny + the registered AC-3/E-AC-3 decoder, so it handles Matroska containers and Dolby
 * audio the browser can't decode. Downmixes to mono per chunk and resamples to 16 kHz at the end.
 */
export declare function decodeAudioToMono16k(blob: Blob, opts?: {
    base?: string;
    audioIndex?: number;
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
    durationHint?: number;
}): Promise<Float32Array>;
