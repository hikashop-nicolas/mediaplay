export type MediaStrings = {
    mediaKeys: string;
    mediaKeysAudio: string;
    mediaUnsupported: string;
    mediaAudioUnsupported: string;
    mediaEmpty: string;
    mediaConverting: string;
    tracksMenu: string;
    subtitles: string;
    subtitlesOff: string;
    loadSubtitles: string;
    audioTracks: string;
};
/** Force a locale by code (e.g. "fr"); unknown codes fall back to English. */
export declare function setLocale(code: string): void;
/**
 * The active string set, optionally overridden per-player. A host that already owns
 * its own translations (e.g. Omnitext) passes a partial `override` so its exact
 * wording wins over the library defaults.
 */
export declare function strings(override?: Partial<MediaStrings>): MediaStrings;
