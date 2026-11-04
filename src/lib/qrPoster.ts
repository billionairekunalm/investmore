/** The permanent classroom attendance QR: its link, a QR-only image, and a print-ready wall poster (PNG). */
export const PUBLIC_SITE = 'https://investmore.vercel.app';

/** Link inside the QR. A code made while testing on this computer (localhost) must still point at the live site. */
export const attendUrl = (token: string) =>
  `${/^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname) ? PUBLIC_SITE : location.origin}/attend?t=${token}`;

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
};

export async function qrOnly(url: string) {
  const Q = await import('qrcode');
  return Q.toDataURL(url, { width: 1000, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#151715', light: '#ffffff' } });
}

/** A4 portrait at 150 dpi (1240 × 1754): brand header, big QR, three simple steps. */
export async function qrPoster(url: string, academy = 'InvestMore'): Promise<string> {
  const [qr, logo] = await Promise.all([qrOnly(url).then(loadImg), loadImg('/logo-mark.png').catch(() => null)]);
  const W = 1240, H = 1754;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const font = (w: number, s: number) => `${w} ${s}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
  c.fillStyle = '#f2f1ec'; c.fillRect(0, 0, W, H);

  // header
  c.fillStyle = '#151715'; c.fillRect(0, 0, W, 330);
  c.fillStyle = '#ffffff'; rr(c, 110, 90, 150, 150, 36); c.fill();
  if (logo) c.drawImage(logo, 110 + 15, 90 + 15, 120, 120);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.font = font(800, 70);
  const a = academy.trim().toLowerCase() === 'investmore';
  if (a) { c.fillStyle = '#ffffff'; c.fillText('INVEST', 300, 170); c.fillStyle = '#05b200'; c.fillText('MORE', 300 + c.measureText('INVEST').width, 170); }
  else { c.fillStyle = '#ffffff'; c.fillText(academy.toUpperCase(), 300, 170); }
  c.fillStyle = '#a1a1aa'; c.font = font(600, 28); c.fillText('TRAINING ACADEMY', 302, 218);

  // title
  c.textAlign = 'center'; c.fillStyle = '#181818';
  c.font = font(800, 92); c.fillText('Scan to mark your', W / 2, 470);
  c.fillStyle = '#028a02'; c.fillText('attendance', W / 2, 575);

  // QR card
  const S = 760, X = (W - S) / 2, Y = 640;
  c.save(); c.shadowColor = 'rgba(24,24,24,.18)'; c.shadowBlur = 50; c.shadowOffsetY = 16; c.fillStyle = '#ffffff'; rr(c, X, Y, S, S, 56); c.fill(); c.restore();
  c.lineWidth = 14; c.strokeStyle = '#b6f09c'; rr(c, X, Y, S, S, 56); c.stroke();
  c.drawImage(qr, X + 40, Y + 40, S - 80, S - 80);

  // steps
  const steps = ['Open your phone camera and scan this code', 'Sign in with your Student ID (only the first time)', 'Tap “Mark my attendance”'];
  c.textAlign = 'left';
  steps.forEach((t, i) => {
    const y = 1488 + i * 74;
    c.fillStyle = '#151715'; c.beginPath(); c.arc(220, y - 12, 26, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#b6f09c'; c.font = font(800, 30); c.textAlign = 'center'; c.fillText(String(i + 1), 220, y - 1);
    c.fillStyle = '#181818'; c.font = font(600, 38); c.textAlign = 'left'; c.fillText(t, 275, y);
  });
  c.textAlign = 'center'; c.fillStyle = '#8a8a80'; c.font = font(500, 26);
  c.fillText('Attendance opens shortly before your class starts', W / 2, 1722);
  return cv.toDataURL('image/png');
}
