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
  fullscreen: string;
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
  fullscreen: "Fullscreen",
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
  fullscreen: "Plein écran",
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
  fullscreen: "全画面",
};

const es: MediaStrings = {
  mediaKeys: "Espacio: reproducir/pausar · F: pantalla completa · M: silenciar · S/D: velocidad · C: subtítulos · ← →: avanzar/retroceder · ↑ ↓: volumen",
  mediaKeysAudio: "Espacio: reproducir/pausar · M: silenciar · S/D: velocidad · ← →: avanzar/retroceder · ↑ ↓: volumen",
  mediaUnsupported: "Su navegador no admite este formato multimedia.",
  mediaAudioUnsupported: "El vídeo se reproduce sin sonido: su pista de audio usa un códec que su navegador no sabe descodificar (por ejemplo Dolby AC-3/E-AC-3 o DTS).",
  mediaEmpty: "No hay nada que reproducir.",
  mediaConverting: "Convirtiendo para la reproducción…",
  tracksMenu: "Pistas de subtítulos y de audio",
  subtitles: "Subtítulos",
  subtitlesOff: "Desactivados",
  loadSubtitles: "Cargar un archivo de subtítulos…",
  audioTracks: "Audio",
  fullscreen: "Pantalla completa",
};

const de: MediaStrings = {
  mediaKeys: "Leertaste: Wiedergabe/Pause · F: Vollbild · M: stumm · S/D: Geschwindigkeit · C: Untertitel · ← →: spulen · ↑ ↓: Lautstärke",
  mediaKeysAudio: "Leertaste: Wiedergabe/Pause · M: stumm · S/D: Geschwindigkeit · ← →: spulen · ↑ ↓: Lautstärke",
  mediaUnsupported: "Dieses Medienformat unterstützt Ihr Browser nicht.",
  mediaAudioUnsupported: "Das Video läuft ohne Ton: Seine Tonspur verwendet einen Codec, den Ihr Browser nicht dekodieren kann (etwa Dolby AC-3/E-AC-3 oder DTS).",
  mediaEmpty: "Nichts abzuspielen.",
  mediaConverting: "Wird für die Wiedergabe umgewandelt…",
  tracksMenu: "Untertitel- und Tonspuren",
  subtitles: "Untertitel",
  subtitlesOff: "Aus",
  loadSubtitles: "Untertiteldatei laden…",
  audioTracks: "Ton",
  fullscreen: "Vollbild",
};

const pt: MediaStrings = {
  mediaKeys: "Espaço: reproduzir/pausar · F: ecrã inteiro · M: silenciar · S/D: velocidade · C: legendas · ← →: avançar/recuar · ↑ ↓: volume",
  mediaKeysAudio: "Espaço: reproduzir/pausar · M: silenciar · S/D: velocidade · ← →: avançar/recuar · ↑ ↓: volume",
  mediaUnsupported: "O seu navegador não suporta este formato multimédia.",
  mediaAudioUnsupported: "O vídeo está a ser reproduzido sem som: a faixa de áudio usa um codec que o seu navegador não sabe descodificar (por exemplo Dolby AC-3/E-AC-3 ou DTS).",
  mediaEmpty: "Não há nada para reproduzir.",
  mediaConverting: "A converter para reprodução…",
  tracksMenu: "Faixas de legendas e de áudio",
  subtitles: "Legendas",
  subtitlesOff: "Desativadas",
  loadSubtitles: "Carregar um ficheiro de legendas…",
  audioTracks: "Áudio",
  fullscreen: "Ecrã inteiro",
};

const ru: MediaStrings = {
  mediaKeys: "Пробел: воспроизведение/пауза · F: во весь экран · M: без звука · S/D: скорость · C: субтитры · ← →: перемотка · ↑ ↓: громкость",
  mediaKeysAudio: "Пробел: воспроизведение/пауза · M: без звука · S/D: скорость · ← →: перемотка · ↑ ↓: громкость",
  mediaUnsupported: "Ваш браузер не поддерживает этот медиаформат.",
  mediaAudioUnsupported: "Видео идёт без звука: его звуковая дорожка использует кодек, который ваш браузер не может декодировать (например, Dolby AC-3/E-AC-3 или DTS).",
  mediaEmpty: "Нечего воспроизводить.",
  mediaConverting: "Преобразование для воспроизведения…",
  tracksMenu: "Дорожки субтитров и звука",
  subtitles: "Субтитры",
  subtitlesOff: "Выключены",
  loadSubtitles: "Загрузить файл субтитров…",
  audioTracks: "Звук",
  fullscreen: "Во весь экран",
};

const zh: MediaStrings = {
  mediaKeys: "空格：播放/暂停 · F：全屏 · M：静音 · S/D：速度 · C：字幕 · ← →：快进/快退 · ↑ ↓：音量",
  mediaKeysAudio: "空格：播放/暂停 · M：静音 · S/D：速度 · ← →：快进/快退 · ↑ ↓：音量",
  mediaUnsupported: "您的浏览器不支持此媒体格式。",
  mediaAudioUnsupported: "视频正在无声播放：其音轨使用了您的浏览器无法解码的编解码器（例如 Dolby AC-3/E-AC-3 或 DTS）。",
  mediaEmpty: "没有可播放的内容。",
  mediaConverting: "正在转换以便播放…",
  tracksMenu: "字幕和音轨",
  subtitles: "字幕",
  subtitlesOff: "关闭",
  loadSubtitles: "加载字幕文件…",
  audioTracks: "音频",
  fullscreen: "全屏",
};

const LOCALES: Record<string, MediaStrings> = { en, fr, ja, es, de, pt, ru, zh };

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
