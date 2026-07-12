// "@jellyfin/libass-wasm" (SubtitlesOctopus) ships no types; declare the bits we use.
declare module "@jellyfin/libass-wasm" {
  export default class SubtitlesOctopus {
    constructor(options: {
      video: HTMLVideoElement;
      subContent: string;
      workerUrl: string;
      fallbackFont?: string;
      fonts?: string[];
      onReady?: () => void;
      onError?: (error: unknown) => void;
    });
    dispose(): void;
    freeTrack(): void;
    setTrack(content: string): void;
    resize(): void;
  }
}
