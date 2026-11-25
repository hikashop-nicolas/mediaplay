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
  play: string;
  pause: string;
  mute: string;
  unmute: string;
  volume: string;
  timeline: string;
  speed: string;
  scope: string;
  scopeBars: string;
  scopeOff: string;
  visualiser: string;
  previousTrack: string;
  nextTrack: string;
  repeat: string;
  repeatOff: string;
  repeatAll: string;
  repeatOne: string;
  shuffle: string;
  playlist: string;
  removeFromPlaylist: string;
  notReachable: string;
  playsOnline: string;
  skipped: string;
  close: string;
  chooseFolder: string;
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
  play: "Play",
  pause: "Pause",
  mute: "Mute",
  unmute: "Unmute",
  volume: "Volume",
  timeline: "Timeline",  speed: "Speed",  scope: "Oscilloscope",
  scopeBars: "Bars",  scopeOff: "No visualiser",    visualiser: "Visualiser",
  previousTrack: "Previous",
  nextTrack: "Next",
  repeat: "Repeat",
  repeatOff: "Repeat: off",
  repeatAll: "Repeat: all",
  repeatOne: "Repeat: one",
  shuffle: "Shuffle",
  playlist: "Playlist",
  removeFromPlaylist: "Remove from the playlist",
  notReachable: "Not found next to the playlist",
  playsOnline: "Plays from the web",
  skipped: "Could not play, skipping",
  close: "Close",
  chooseFolder: "Choose the folder with the files…",
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
  play: "Lecture",
  pause: "Pause",
  mute: "Couper le son",
  unmute: "Rétablir le son",
  volume: "Volume",
  timeline: "Barre de progression",  speed: "Vitesse",  scope: "Oscilloscope",
  scopeBars: "Barres",  scopeOff: "Aucune visualisation",    visualiser: "Visualisation",
  previousTrack: "Précédent",
  nextTrack: "Suivant",
  repeat: "Répéter",
  repeatOff: "Répéter : non",
  repeatAll: "Répéter : tout",
  repeatOne: "Répéter : un seul",
  shuffle: "Aléatoire",
  playlist: "Liste de lecture",
  removeFromPlaylist: "Retirer de la liste",
  notReachable: "Introuvable à côté de la liste",
  playsOnline: "Lu depuis le web",
  skipped: "Lecture impossible, passage au suivant",
  close: "Fermer",
  chooseFolder: "Choisir le dossier des fichiers…",
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
  play: "再生",
  pause: "一時停止",
  mute: "ミュート",
  unmute: "ミュート解除",
  volume: "音量",
  timeline: "シークバー",  speed: "再生速度",  scope: "オシロスコープ",
  scopeBars: "バー",  scopeOff: "表示なし",    visualiser: "ビジュアライザー",
  previousTrack: "前へ",
  nextTrack: "次へ",
  repeat: "リピート",
  repeatOff: "リピート：オフ",
  repeatAll: "リピート：全曲",
  repeatOne: "リピート：1曲",
  shuffle: "シャッフル",
  playlist: "プレイリスト",
  removeFromPlaylist: "プレイリストから削除",
  notReachable: "プレイリストの隣に見つかりません",
  playsOnline: "ウェブから再生",
  skipped: "再生できないためスキップします",
  close: "閉じる",
  chooseFolder: "ファイルのあるフォルダを選ぶ…",
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
  play: "Reproducir",
  pause: "Pausar",
  mute: "Silenciar",
  unmute: "Activar el sonido",
  volume: "Volumen",
  timeline: "Barra de progreso",  speed: "Velocidad",  scope: "Osciloscopio",
  scopeBars: "Barras",  scopeOff: "Sin visualización",    visualiser: "Visualizador",
  previousTrack: "Anterior",
  nextTrack: "Siguiente",
  repeat: "Repetir",
  repeatOff: "Repetir: no",
  repeatAll: "Repetir: todo",
  repeatOne: "Repetir: uno",
  shuffle: "Aleatorio",
  playlist: "Lista de reproducción",
  removeFromPlaylist: "Quitar de la lista",
  notReachable: "No se encuentra junto a la lista",
  playsOnline: "Se reproduce desde la web",
  skipped: "No se pudo reproducir, se salta",
  close: "Cerrar",
  chooseFolder: "Elegir la carpeta con los archivos…",
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
  play: "Wiedergabe",
  pause: "Pause",
  mute: "Stummschalten",
  unmute: "Ton einschalten",
  volume: "Lautstärke",
  timeline: "Zeitleiste",  speed: "Geschwindigkeit",  scope: "Oszilloskop",
  scopeBars: "Balken",  scopeOff: "Keine Visualisierung",    visualiser: "Visualisierung",
  previousTrack: "Zurück",
  nextTrack: "Weiter",
  repeat: "Wiederholen",
  repeatOff: "Wiederholen: aus",
  repeatAll: "Wiederholen: alle",
  repeatOne: "Wiederholen: einen",
  shuffle: "Zufall",
  playlist: "Wiedergabeliste",
  removeFromPlaylist: "Aus der Liste entfernen",
  notReachable: "Neben der Liste nicht gefunden",
  playsOnline: "Wird aus dem Web abgespielt",
  skipped: "Nicht abspielbar, wird übersprungen",
  close: "Schließen",
  chooseFolder: "Ordner mit den Dateien wählen…",
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
  play: "Reproduzir",
  pause: "Pausar",
  mute: "Silenciar",
  unmute: "Ativar o som",
  volume: "Volume",
  timeline: "Barra de progresso",  speed: "Velocidade",  scope: "Osciloscópio",
  scopeBars: "Barras",  scopeOff: "Sem visualização",    visualiser: "Visualizador",
  previousTrack: "Anterior",
  nextTrack: "Seguinte",
  repeat: "Repetir",
  repeatOff: "Repetir: não",
  repeatAll: "Repetir: tudo",
  repeatOne: "Repetir: um",
  shuffle: "Aleatório",
  playlist: "Lista de reprodução",
  removeFromPlaylist: "Remover da lista",
  notReachable: "Não encontrado junto à lista",
  playsOnline: "Reproduzido a partir da web",
  skipped: "Não foi possível reproduzir, a saltar",
  close: "Fechar",
  chooseFolder: "Escolher a pasta com os ficheiros…",
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
  play: "Воспроизвести",
  pause: "Пауза",
  mute: "Выключить звук",
  unmute: "Включить звук",
  volume: "Громкость",
  timeline: "Шкала времени",  speed: "Скорость",  scope: "Осциллограф",
  scopeBars: "Полосы",  scopeOff: "Без визуализации",    visualiser: "Визуализация",
  previousTrack: "Назад",
  nextTrack: "Далее",
  repeat: "Повтор",
  repeatOff: "Повтор: выкл.",
  repeatAll: "Повтор: все",
  repeatOne: "Повтор: один",
  shuffle: "Вперемешку",
  playlist: "Плейлист",
  removeFromPlaylist: "Убрать из плейлиста",
  notReachable: "Не найдено рядом с плейлистом",
  playsOnline: "Воспроизводится из интернета",
  skipped: "Не удалось воспроизвести, пропуск",
  close: "Закрыть",
  chooseFolder: "Выбрать папку с файлами…",
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
  play: "播放",
  pause: "暂停",
  mute: "静音",
  unmute: "取消静音",
  volume: "音量",
  timeline: "进度条",  speed: "播放速度",  scope: "示波器",
  scopeBars: "频谱条",  scopeOff: "不显示",    visualiser: "可视化",
  previousTrack: "上一个",
  nextTrack: "下一个",
  repeat: "循环",
  repeatOff: "循环：关",
  repeatAll: "循环：全部",
  repeatOne: "循环：单曲",
  shuffle: "随机",
  playlist: "播放列表",
  removeFromPlaylist: "从列表中移除",
  notReachable: "在播放列表旁找不到",
  playsOnline: "从网络播放",
  skipped: "无法播放，已跳过",
  close: "关闭",
  chooseFolder: "选择文件所在文件夹…",
};

const it: MediaStrings = {
  mediaKeys: "Spazio: riproduci/pausa · F: schermo intero · M: muto · S/D: velocità · C: sottotitoli · ← →: avanti/indietro · ↑ ↓: volume",
  mediaKeysAudio: "Spazio: riproduci/pausa · M: muto · S/D: velocità · ← →: avanti/indietro · ↑ ↓: volume",
  mediaUnsupported: "Questo formato multimediale non è supportato dal browser.",
  mediaAudioUnsupported: "Il video viene riprodotto senza audio: la traccia audio usa un codec che il browser non è in grado di decodificare (ad es. Dolby AC-3/E-AC-3 o DTS).",
  mediaEmpty: "Niente da riprodurre.",
  mediaConverting: "Conversione per la riproduzione…",
  tracksMenu: "Tracce sottotitoli e audio",
  subtitles: "Sottotitoli",
  subtitlesOff: "Disattivati",
  loadSubtitles: "Carica file di sottotitoli…",
  audioTracks: "Audio",
  fullscreen: "Schermo intero",
  play: "Riproduci",
  pause: "Pausa",
  mute: "Disattiva audio",
  unmute: "Riattiva audio",
  volume: "Volume",
  timeline: "Barra di avanzamento",
  speed: "Velocità",
  scope: "Oscilloscopio",
  scopeBars: "Barre",
  scopeOff: "Nessuna visualizzazione",
  visualiser: "Visualizzazione",
  previousTrack: "Precedente",
  nextTrack: "Successivo",
  repeat: "Ripeti",
  repeatOff: "Ripeti: no",
  repeatAll: "Ripeti: tutti",
  repeatOne: "Ripeti: uno",
  shuffle: "Casuale",
  playlist: "Playlist",
  removeFromPlaylist: "Rimuovi dalla playlist",
  notReachable: "Non trovato accanto alla playlist",
  playsOnline: "Riprodotto dal web",
  skipped: "Impossibile riprodurre, passaggio al successivo",
  close: "Chiudi",
  chooseFolder: "Scegli la cartella con i file…",
};

const pl: MediaStrings = {
  mediaKeys: "Spacja: odtwarzaj/pauza · F: pełny ekran · M: wycisz · S/D: prędkość · C: napisy · ← →: przewijanie · ↑ ↓: głośność",
  mediaKeysAudio: "Spacja: odtwarzaj/pauza · M: wycisz · S/D: prędkość · ← →: przewijanie · ↑ ↓: głośność",
  mediaUnsupported: "Ten format multimediów nie jest obsługiwany przez przeglądarkę.",
  mediaAudioUnsupported: "Wideo jest odtwarzane bez dźwięku: ścieżka dźwiękowa używa kodeka, którego przeglądarka nie potrafi zdekodować (np. Dolby AC-3/E-AC-3 lub DTS).",
  mediaEmpty: "Brak multimediów do odtworzenia.",
  mediaConverting: "Konwertowanie do odtwarzania…",
  tracksMenu: "Ścieżki napisów i dźwięku",
  subtitles: "Napisy",
  subtitlesOff: "Wyłączone",
  loadSubtitles: "Wczytaj plik napisów…",
  audioTracks: "Dźwięk",
  fullscreen: "Pełny ekran",
  play: "Odtwórz",
  pause: "Pauza",
  mute: "Wycisz",
  unmute: "Włącz dźwięk",
  volume: "Głośność",
  timeline: "Oś czasu",
  speed: "Prędkość",
  scope: "Oscyloskop",
  scopeBars: "Słupki",
  scopeOff: "Bez wizualizacji",
  visualiser: "Wizualizacja",
  previousTrack: "Poprzedni",
  nextTrack: "Następny",
  repeat: "Powtarzanie",
  repeatOff: "Powtarzanie: wył.",
  repeatAll: "Powtarzanie: wszystkie",
  repeatOne: "Powtarzanie: jeden",
  shuffle: "Losowo",
  playlist: "Lista odtwarzania",
  removeFromPlaylist: "Usuń z listy odtwarzania",
  notReachable: "Nie znaleziono obok listy odtwarzania",
  playsOnline: "Odtwarzane z internetu",
  skipped: "Nie można odtworzyć, pomijanie",
  close: "Zamknij",
  chooseFolder: "Wybierz folder z plikami…",
};

const ko: MediaStrings = {
  mediaKeys: "Space: 재생/일시정지 · F: 전체 화면 · M: 음소거 · S/D: 재생 속도 · C: 자막 · ← →: 탐색 · ↑ ↓: 볼륨",
  mediaKeysAudio: "Space: 재생/일시정지 · M: 음소거 · S/D: 재생 속도 · ← →: 탐색 · ↑ ↓: 볼륨",
  mediaUnsupported: "브라우저에서 이 미디어 형식을 지원하지 않습니다.",
  mediaAudioUnsupported: "동영상이 소리 없이 재생됩니다. 오디오 트랙이 브라우저에서 디코딩할 수 없는 코덱(예: Dolby AC-3/E-AC-3 또는 DTS)을 사용합니다.",
  mediaEmpty: "재생할 항목이 없습니다.",
  mediaConverting: "재생을 위해 변환하는 중…",
  tracksMenu: "자막 및 오디오 트랙",
  subtitles: "자막",
  subtitlesOff: "끄기",
  loadSubtitles: "자막 파일 불러오기…",
  audioTracks: "오디오",
  fullscreen: "전체 화면",
  play: "재생",
  pause: "일시정지",
  mute: "음소거",
  unmute: "음소거 해제",
  volume: "볼륨",
  timeline: "타임라인",
  speed: "재생 속도",
  scope: "오실로스코프",
  scopeBars: "막대",
  scopeOff: "시각화 없음",
  visualiser: "시각화",
  previousTrack: "이전",
  nextTrack: "다음",
  repeat: "반복",
  repeatOff: "반복: 끄기",
  repeatAll: "반복: 전체",
  repeatOne: "반복: 한 곡",
  shuffle: "무작위 재생",
  playlist: "재생 목록",
  removeFromPlaylist: "재생 목록에서 제거",
  notReachable: "재생 목록과 같은 위치에서 찾을 수 없습니다",
  playsOnline: "웹에서 재생됩니다",
  skipped: "재생할 수 없어 건너뜁니다",
  close: "닫기",
  chooseFolder: "파일이 있는 폴더 선택…",
};

const tr: MediaStrings = {
  mediaKeys: "Boşluk: oynat/duraklat · F: tam ekran · M: sessiz · S/D: hız · C: altyazılar · ← →: ileri/geri sar · ↑ ↓: ses düzeyi",
  mediaKeysAudio: "Boşluk: oynat/duraklat · M: sessiz · S/D: hız · ← →: ileri/geri sar · ↑ ↓: ses düzeyi",
  mediaUnsupported: "Bu medya biçimi tarayıcınız tarafından desteklenmiyor.",
  mediaAudioUnsupported: "Video sessiz oynatılıyor: ses parçası, tarayıcınızın çözemediği bir codec kullanıyor (ör. Dolby AC-3/E-AC-3 veya DTS).",
  mediaEmpty: "Oynatılacak bir şey yok.",
  mediaConverting: "Oynatma için dönüştürülüyor…",
  tracksMenu: "Altyazı ve ses parçaları",
  subtitles: "Altyazılar",
  subtitlesOff: "Kapalı",
  loadSubtitles: "Altyazı dosyası yükle…",
  audioTracks: "Ses",
  fullscreen: "Tam ekran",
  play: "Oynat",
  pause: "Duraklat",
  mute: "Sesi kapat",
  unmute: "Sesi aç",
  volume: "Ses düzeyi",
  timeline: "Zaman çizelgesi",
  speed: "Oynatma hızı",
  scope: "Osiloskop",
  scopeBars: "Çubuklar",
  scopeOff: "Görselleştirme yok",
  visualiser: "Görselleştirici",
  previousTrack: "Önceki",
  nextTrack: "Sonraki",
  repeat: "Tekrarla",
  repeatOff: "Tekrar: kapalı",
  repeatAll: "Tekrar: tümü",
  repeatOne: "Tekrar: tek",
  shuffle: "Karıştır",
  playlist: "Oynatma listesi",
  removeFromPlaylist: "Oynatma listesinden kaldır",
  notReachable: "Oynatma listesinin yanında bulunamadı",
  playsOnline: "Web'den oynatılır",
  skipped: "Oynatılamadı, atlanıyor",
  close: "Kapat",
  chooseFolder: "Dosyaların bulunduğu klasörü seçin…",
};

const LOCALES: Record<string, MediaStrings> = { en, fr, ja, es, de, pt, ru, zh, it, pl, ko, tr };

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
