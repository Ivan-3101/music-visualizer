import { BAR_COUNT, BASS_MAX_HZ, MID_MAX_HZ, barToHz, hzToPosition } from "../audio/spectrum";

const WIDTH = 360; // CSS pixels
const HEIGHT = 140;

const COLORS = { bass: "#ff4d6d", mid: "#ffd166", treble: "#4cc9f0" };

/** Draws Spectrum levels as a 2D bar graph, for checking the audio data. */
export class DebugBars {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly colors: string[] = [];

  constructor() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.className = "debug-bars";

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    ctx.scale(dpr, dpr); // draw in CSS pixels; the canvas has dpr× more real pixels
    this.ctx = ctx;

    for (let i = 0; i < BAR_COUNT; i++) {
      const hz = barToHz(i);
      this.colors.push(hz < BASS_MAX_HZ ? COLORS.bass : hz < MID_MAX_HZ ? COLORS.mid : COLORS.treble);
    }
  }

  /** levels: one value per bar, 0..1 (from Spectrum). */
  draw(levels: Float32Array): void {
    const { ctx } = this;
    const barWidth = WIDTH / BAR_COUNT;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "rgba(5, 6, 10, 0.75)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    levels.forEach((level, i) => {
      const barHeight = level * (HEIGHT - 16);
      ctx.fillStyle = this.colors[i];
      ctx.fillRect(i * barWidth + 1, HEIGHT - barHeight, barWidth - 2, barHeight);
    });

    this.drawDivider(BASS_MAX_HZ, "250 Hz");
    this.drawDivider(MID_MAX_HZ, "4 kHz");
  }

  private drawDivider(hz: number, label: string): void {
    const x = hzToPosition(hz) * WIDTH;
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    this.ctx.fillRect(x, 0, 1, HEIGHT);
    this.ctx.font = "10px system-ui, sans-serif";
    this.ctx.fillText(label, x + 3, 11);
  }
}
