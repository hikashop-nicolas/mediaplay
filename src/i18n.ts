// Self-contained i18n for mediaplay so the library is a complete multilingual product
// on its own. Detects the locale from the browser preferred-languages list (base
// language, first match), English fallback. Adding a language = add a dict to LOCALES;
// hosts may force one via setLocale() or override individual strings per-player.

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

const en: MediaStrings = {
  mediaKeys: "Space: play/pause · F: fullscreen · M: mute · S/D: speed · C: subtitles · ← →: seek · ↑ ↓: volume",
  mediaKeysAudio: "Space: play/pause · M: mute · S/D: speed · ← →: seek · ↑ ↓: volume",
  mediaUnsupported: "This media format is not supported by your browser.",
  mediaAudioUnsupported: "The video is playing without sound: its audio track uses a codec your browser can't decode (e.g. Dolby AC-3/E-AC-3 or DTS).",
  mediaEmpty: "Nothing to play.",
  mediaConverting: "Converting for playback…",
  tracksMenu: "Subtitle and audio tracks",
  subtitles: "Subtitles",
  subtitlesOff: "Off",
  loadSubtitles: "Load subtitle file…",
  audioTracks: "Audio",
};

const fr: MediaStrings = {
  mediaKeys: "Espace : lecture/pause · F : plein écran · M : muet · S/D : vitesse · C : sous-titres · ← → : avancer/reculer · ↑ ↓ : volume",
  mediaKeysAudio: "Espace : lecture/pause · M : muet · S/D : vitesse · ← → : avancer/reculer · ↑ ↓ : volume",
  mediaUnsupported: "Ce format multimédia n'est pas pris en charge par votre navigateur.",
  mediaAudioUnsupported: "La vidéo est lue sans le son : sa piste audio utilise un codec que votre navigateur ne sait pas décoder (par ex. Dolby AC-3/E-AC-3 ou DTS).",
  mediaEmpty: "Rien à lire.",
  mediaConverting: "Conversion pour la lecture…",
  tracksMenu: "Pistes de sous-titres et audio",
  subtitles: "Sous-titres",
  subtitlesOff: "Désactivés",
  loadSubtitles: "Charger un fichier de sous-titres…",
  audioTracks: "Audio",
};

const ja: MediaStrings = {
  mediaKeys: "スペース：再生/一時停止 · F：全画面 · M：ミュート · S/D：速度 · C：字幕 · ← →：シーク · ↑ ↓：音量",
  mediaKeysAudio: "スペース：再生/一時停止 · M：ミュート · S/D：速度 · ← →：シーク · ↑ ↓：音量",
  mediaUnsupported: "このメディア形式はお使いのブラウザーでは再生できません。",
  mediaAudioUnsupported: "音声なしで再生しています。音声トラックがお使いのブラウザーで復号できないコーデック（Dolby AC-3/E-AC-3 や DTS など）を使用しています。",
  mediaEmpty: "再生できる内容がありません。",
  mediaConverting: "再生用に変換しています…",
  tracksMenu: "字幕・音声トラック",
  subtitles: "字幕",
  subtitlesOff: "オフ",
  loadSubtitles: "字幕ファイルを読み込む…",
  audioTracks: "音声",
};

const LOCALES: Record<string, MediaStrings> = { en, fr, ja };

let active: MediaStrings = en;

/** Pick the first preferred language we have a translation for, else English. */
function detect(): MediaStrings {
  const prefs = (typeof navigator !== "undefined" && navigator.languages) || ["en"];
  for (const tag of prefs) {
    const base = tag.toLowerCase().split("-")[0]!;
    if (LOCALES[base]) return LOCALES[base]!;
  }
  return en;
}
active = detect();

/** Force a locale by code (e.g. "fr"); unknown codes fall back to English. */
export function setLocale(code: string): void {
  active = LOCALES[code.toLowerCase().split("-")[0]!] ?? en;
}

/**
 * The active string set, optionally overridden per-player. A host that already owns
 * its own translations (e.g. Omnitext) passes a partial `override` so its exact
 * wording wins over the library defaults.
 */
export function strings(override?: Partial<MediaStrings>): MediaStrings {
  return override ? { ...active, ...override } : active;
}
