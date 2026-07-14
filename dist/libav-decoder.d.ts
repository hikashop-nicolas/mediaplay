/** Set where the libav assets are served from (must end with "/"); call before decoding. */
export declare function setLibavBase(base: string): void;
/** Register the AC-3/E-AC-3 decoder with mediabunny (idempotent). */
export declare function registerAc3Decoder(): void;
/** Matroska CodecID -> FFmpeg decoder name, for codecs our libav build decodes. */
export declare const MKV_LIBAV_CODECS: Record<string, string>;
/** One decoded frame, normalized to per-channel Float32 planes. */
export interface DirectFrame {
    rate: number;
    channels: number;
    nb: number;
    planes: Float32Array[];
}
export interface DirectAudioDecoder {
    decode(packets: Uint8Array[]): Promise<DirectFrame[]>;
    flush(): Promise<DirectFrame[]>;
    close(): void;
}
/** Open a decoder for an FFmpeg codec name (see MKV_LIBAV_CODECS); caller feeds raw
 *  encoded packets (e.g. from readAudioPackets) and gets Float32 planes back. */
export declare function createDirectAudioDecoder(ffName: string, base: string): Promise<DirectAudioDecoder>;
