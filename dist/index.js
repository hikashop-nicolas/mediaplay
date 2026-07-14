// mediaplay: a standalone, framework-agnostic, client-side audio/video player for the
// browser. Plays the raw file bytes in a <video>/<audio> element and, when the browser
// can't play them directly, remuxes in memory (mediabunny) to a container it accepts,
// without re-encoding. Embedded and external subtitles (SRT/ASS/SSA/VTT) are extracted
// and rendered, with styled ASS via libass (SubtitlesOctopus). No server, no upload.
//
// - player.ts  the player UI + the createMediaPlayer entry point
// - mkv.ts     the Matroska/WebM subtitle+audio-track extractor and subtitle converters
//
// The subtitle helpers are re-exported so they can be used headlessly (no player).
export { createMediaPlayer, } from "./player";
export { setLocale, strings } from "./i18n";
export { extractWaveformPeaks, decodeAudioToMono16k } from "./synced-audio";
export { extractMkvInfo, extractMkvSubtitles, subtitleFileToVtt, decodeSubtitleBytes, srtToVtt, assFileToVtt, } from "./mkv";
