export type AudioSourceKind = "none" | "file" | "capture";

const FFT_SIZE = 2048;

// Chrome supports these options, but TypeScript's built-in types don't list them yet.
type CaptureOptions = DisplayMediaStreamOptions & {
  systemAudio?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
};

/**
 * Owns the Web Audio graph and exposes the latest FFT data.
 *
 *   File:    <audio> → elementSource ─┬→ analyser
 *                                     └→ speakers
 *   Capture: stream  → streamSource ───→ analyser   (not to speakers: avoids echo)
 *
 * Create it from a user action (click/file pick): browsers block audio until then.
 */
export class AudioEngine {
  readonly context = new AudioContext();
  readonly analyser = this.context.createAnalyser();

  // Allocated once and overwritten by update() every frame.
  // Real decibels (not the 0–255 bytes, which squash everything into a fixed window).
  readonly frequencyDb: Float32Array<ArrayBuffer>;
  readonly waveformData: Uint8Array<ArrayBuffer>;

  // A media element can only be wrapped by createMediaElementSource() once,
  // so we keep one <audio> element and swap its src for each file.
  private readonly audio = new Audio();
  private readonly elementSource = this.context.createMediaElementSource(this.audio);
  private fileUrl: string | null = null;

  private stream: MediaStream | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;

  private _source: AudioSourceKind = "none";

  /**
   * Called when playback state changes on its own: the song plays, pauses or ends,
   * or capture is stopped from Chrome's "Stop sharing" bar.
   */
  onChange: (() => void) | null = null;

  constructor() {
    this.analyser.fftSize = FFT_SIZE;
    // Low enough that kick drums stay punchy; Spectrum adds its own smoothing on the way down.
    this.analyser.smoothingTimeConstant = 0.5;
    this.frequencyDb = new Float32Array(this.analyser.frequencyBinCount);
    this.waveformData = new Uint8Array(this.analyser.fftSize);

    this.elementSource.connect(this.analyser);
    this.elementSource.connect(this.context.destination);

    for (const event of ["play", "pause", "ended"]) {
      this.audio.addEventListener(event, () => this.onChange?.());
    }
  }

  get source(): AudioSourceKind {
    return this._source;
  }

  get isPlaying(): boolean {
    return this._source === "capture" || (this._source === "file" && !this.audio.paused);
  }

  async loadFile(file: File): Promise<void> {
    this.stopCapture();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);

    this.fileUrl = URL.createObjectURL(file);
    this.audio.src = this.fileUrl;
    this._source = "file";
    await this.play();
  }

  async play(): Promise<void> {
    if (this._source !== "file") return;
    await this.context.resume();
    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  /**
   * Captures audio from a shared tab or screen (e.g. Spotify).
   * Throws if the user cancels or doesn't tick "Share audio".
   */
  async startCapture(): Promise<void> {
    const options: CaptureOptions = {
      video: true, // Chrome requires video to offer screen sharing; we discard it below
      audio: {
        // These filters are meant for voice calls and would distort music.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: "include", // offer "Share system audio" when sharing a whole screen
      selfBrowserSurface: "exclude", // don't offer this tab: it would capture itself
    };
    const stream = await navigator.mediaDevices.getDisplayMedia(options);

    stream.getVideoTracks().forEach((track) => track.stop());

    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('No audio was shared. Tick "Share audio" in the share dialog.');
    }

    this.pause();
    this.stopCapture();
    await this.context.resume();

    this.stream = stream;
    this.streamSource = this.context.createMediaStreamSource(stream);
    this.streamSource.connect(this.analyser);
    this._source = "capture";

    audioTrack.addEventListener("ended", () => {
      this.stopCapture();
      this.onChange?.();
    });
  }

  stopCapture(): void {
    if (!this.stream) return;
    this.streamSource?.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.streamSource = null;
    // Fall back to the loaded file (paused), if there is one.
    this._source = this.fileUrl ? "file" : "none";
  }

  /** Copies the analyser's latest data into frequencyDb and waveformData. */
  update(): void {
    this.analyser.getFloatFrequencyData(this.frequencyDb);
    this.analyser.getByteTimeDomainData(this.waveformData);
  }
}
