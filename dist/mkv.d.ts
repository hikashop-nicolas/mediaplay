export interface MkvSubtitleTrack {
    label: string;
    language: string;
    vtt: string;
    /** Full reconstructed .ass document for ASS/SSA tracks (styled rendering). */
    assDoc?: string;
}
/** An audio track's identity, for the track-switch menu (playback swaps via remux). */
export interface MkvAudioTrack {
    /** Matroska TrackNumber; matches mediabunny's InputTrack.id. */
    number: number;
    label: string;
    language: string;
    /** Matroska CodecID (e.g. A_EAC3, A_AAC); lets the player spot codecs the browser can't decode. */
    codec: string;
}
/** An embedded font attachment, handed to libass so styled subtitles use the intended fonts. */
export interface MkvFont {
    name: string;
    mime: string;
    data: Uint8Array;
}
/** Byte offset + start time of a Cluster; lets a packet reader seek without an index. */
export interface MkvClusterRef {
    offset: number;
    timeMs: number;
}
export interface MkvInfo {
    subtitles: MkvSubtitleTrack[];
    audio: MkvAudioTrack[];
    fonts: MkvFont[];
    /** Cluster index built during the scan, for readAudioPackets seeking. */
    clusters: MkvClusterRef[];
    /** TimestampScale (ns per tick), needed to interpret cluster/block times. */
    timestampScale: number;
}
/** One encoded audio frame from a Matroska block (a zero-copy view into the file bytes). */
export interface MkvAudioPacket {
    /** Block presentation time, ms. Laced frames within a block share the block's time. */
    tsMs: number;
    data: Uint8Array;
}
export declare function extractMkvSubtitles(bytes: Uint8Array): MkvSubtitleTrack[];
/**
 * Decode subtitle-file bytes to text. Subtitle files in the wild are often not
 * UTF-8 (Shift_JIS, GBK, EUC-KR, Windows-1252 are common); try strict decoders
 * in order and fall back to permissive Windows-1252, which never fails.
 */
export declare function decodeSubtitleBytes(bytes: Uint8Array): string;
/** SRT text -> WebVTT (comma decimals to dots, index lines dropped). */
export declare function srtToVtt(srt: string): string;
/** ASS/SSA file -> WebVTT (Dialogue events; styling and positioning dropped). */
export declare function assFileToVtt(ass: string): string;
/** Any supported subtitle file -> WebVTT, by extension (vtt passes through). */
export declare function subtitleFileToVtt(name: string, bytes: Uint8Array): string;
export declare function extractMkvInfo(bytes: Uint8Array): MkvInfo;
/**
 * Iterate the encoded audio frames of one track, starting at the cluster covering
 * `fromMs` (via the cluster index collected by extractMkvInfo). Yields zero-copy
 * subarray views with the containing block's timestamp; a decoder's sample clock is
 * expected to smooth per-frame times within a laced block.
 */
export declare function readAudioPackets(bytes: Uint8Array, trackNumber: number, fromMs: number, info: MkvInfo): Generator<MkvAudioPacket>;
/** Streaming variant of readAudioPackets: reads the file ONE CLUSTER AT A TIME from a Blob
 * (using the cluster index in `info`) instead of holding the whole file in memory. Yields the
 * same packets; each block's `data` is a view into that cluster's buffer, which stays alive only
 * until the generator advances to the next cluster. Used for AC-3/E-AC-3 playback so a multi-GB
 * file isn't kept in RAM. */
export declare function readAudioPacketsFromBlob(blob: Blob, trackNumber: number, fromMs: number, info: MkvInfo): AsyncGenerator<MkvAudioPacket>;
