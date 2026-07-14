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
export declare function playSyncedAudio(video: HTMLMediaElement, bytes: Uint8Array, audioIndex: number, base: string, direct?: DirectAudioInfo): Promise<SyncedAudioHandle | "undecodable" | null>;
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
