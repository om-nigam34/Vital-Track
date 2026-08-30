/*
  Synthetic ECG waveform.
*/

class ECGMonitor {
  constructor(canvas, { color = "#34d399", bg = "transparent" } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.color = color;
    this.bg = bg;
    this.heartRate = 75;
    this.running = false;
    this.t = 0; // seconds of waveform already generated
    this.pxPerSecond = 90;
    this.buffer = []; // {x, y} scrolling buffer in canvas space
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  setHeartRate(bpm) {
    if (bpm && bpm > 20 && bpm < 250) this.heartRate = bpm;
  }

  // One PQRST cycle as (fraction 0-1, amplitude -1..1) samples. 
  static _cycleShape(frac) {
    // Hand-tuned piecewise cycle: flat -> P bump -> flat -> QRS spike -> flat -> T bump -> flat
    if (frac < 0.10) return 0;
    if (frac < 0.16) return 0.12 * Math.sin(((frac - 0.10) / 0.06) * Math.PI);
    if (frac < 0.40) return 0;
    if (frac < 0.44) return -0.15 * ((frac - 0.40) / 0.04);
    if (frac < 0.48) return -0.15 + 1.75 * ((frac - 0.44) / 0.04);
    if (frac < 0.52) return 1.6 - 2.0 * ((frac - 0.48) / 0.04);
    if (frac < 0.56) return -0.4 + 0.4 * ((frac - 0.52) / 0.04);
    if (frac < 0.68) return 0;
    if (frac < 0.82) return 0.22 * Math.sin(((frac - 0.68) / 0.14) * Math.PI);
    return 0;
  }

  _drawGrid() {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    const step = 24;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  _tick() {
    if (!this.running) return;
    const dt = 1 / 60;
    this.t += dt;

    const cycleSeconds = Math.max(60 / this.heartRate, 0.28);
    const frac = (this.t % cycleSeconds) / cycleSeconds;
    const amplitude = ECGMonitor._cycleShape(frac);

    const midY = this.height / 2;
    const y = midY - amplitude * (this.height * 0.36);
    const x = this.width; // new sample enters from the right edge

    this.buffer.push({ x, y });
    // scroll everything left
    const dx = this.pxPerSecond * dt;
    this.buffer.forEach((p) => (p.x -= dx));
    this.buffer = this.buffer.filter((p) => p.x > -10);

    this._drawGrid();
    const { ctx } = this;
    ctx.beginPath();
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    this.buffer.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    this._raf = requestAnimationFrame(() => this._tick());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._raf = requestAnimationFrame(() => this._tick());
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}