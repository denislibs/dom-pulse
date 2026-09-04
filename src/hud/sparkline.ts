export function drawSparkline(canvas: HTMLCanvasElement, values: number[], color = '#22c55e'): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * step;
    const y = h - 1 - (v / max) * (h - 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
