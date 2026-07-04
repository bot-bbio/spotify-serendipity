/**
 * Playlist cover art for Time Capsules, drawn on a local <canvas> — no external
 * requests, so the strict CSP is untouched. Output is base64 JPEG (no data:
 * prefix), which is exactly what `PUT /playlists/{id}/images` accepts, kept
 * under the API's 256 KB ceiling by stepping the JPEG quality down if needed.
 */

/** The API's payload ceiling (bytes of decoded image data). */
const MAX_COVER_BYTES = 256_000;

/**
 * Greedy word-wrap using a caller-supplied measure (the canvas'
 * `measureText().width` in production, a character count in tests). A single
 * word wider than the line is emitted alone rather than dropped.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const attempt = line === '' ? word : `${line} ${word}`;
    if (line !== '' && measure(attempt) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Render the capsule cover and return base64 JPEG data (no `data:` prefix). */
export async function renderCoverJpeg(phrase: string, size = 640): Promise<string> {
  // Make sure the display face is available to the canvas before drawing.
  await document.fonts?.ready?.catch?.(() => {});

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable — cannot render a cover.');

  const pad = size * 0.09;

  // Background: near-black with the app's single green glow, top-anchored.
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, size, size);
  const glow = ctx.createRadialGradient(size / 2, -size * 0.15, 0, size / 2, -size * 0.15, size);
  glow.addColorStop(0, 'rgba(29, 185, 84, 0.32)');
  glow.addColorStop(1, 'rgba(29, 185, 84, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Brand mark: the dice, top-left.
  drawDice(ctx, pad, pad, size * 0.12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = `600 ${size * 0.035}px 'Inter Variable', sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('S E R E N D I P I T Y', pad + size * 0.155, pad + size * 0.06);

  // The phrase, wrapped, lower half.
  const phraseSize = size * 0.08;
  ctx.font = `650 ${phraseSize}px 'Outfit Variable', sans-serif`;
  ctx.fillStyle = '#f7f7f8';
  ctx.textBaseline = 'alphabetic';
  const lines = wrapLines(phrase, size - pad * 2, (s) => ctx.measureText(s).width).slice(0, 5);
  const lineHeight = phraseSize * 1.22;
  const baseY = size - pad - size * 0.055 - (lines.length - 1) * lineHeight;
  lines.forEach((line, i) => ctx.fillText(line, pad, baseY + i * lineHeight));

  // Footer: where this came from.
  ctx.font = `500 ${size * 0.032}px 'Inter Variable', sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillText('from my own listening history', pad, size - pad + size * 0.01);

  // Encode under the API ceiling, stepping quality down if a dense phrase
  // pushes the JPEG over.
  for (const quality of [0.85, 0.7, 0.55]) {
    const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    if (base64.length * 0.75 <= MAX_COVER_BYTES) return base64;
  }
  throw new Error('Cover image could not be encoded under the 256 KB API limit.');
}

function drawDice(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const r = w * 0.24;
  ctx.strokeStyle = '#1ed760';
  ctx.lineWidth = w * 0.09;
  ctx.beginPath();
  ctx.roundRect(x, y, w, w, r);
  ctx.stroke();
  ctx.fillStyle = '#1ed760';
  const dot = w * 0.09;
  for (const [dx, dy] of [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.5, 0.5],
    [0.3, 0.7],
    [0.7, 0.7],
  ]) {
    ctx.beginPath();
    ctx.arc(x + dx * w, y + dy * w, dot, 0, Math.PI * 2);
    ctx.fill();
  }
}
