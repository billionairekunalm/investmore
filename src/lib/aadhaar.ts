import { mask } from './ocr';

/**
 * Aadhaar Smart Autofill. Everything runs ON THIS DEVICE; images and raw text never leave this module and the
 * Aadhaar number comes back masked (last 4 digits only).
 * Reading order, most exact first:
 *  1. the UIDAI QR code printed on the card / e-Aadhaar — machine-readable, so the data is exact
 *  2. the text layer of an e-Aadhaar PDF
 *  3. OCR of a cleaned-up image (two passes) — good, but never guaranteed, so staff review the result
 * ponytail: QR signature is not verified against UIDAI's certificate; add that (and DigiLocker) with the backend.
 */
export type Conf = 'high' | 'low';
export type Field = { value: string; conf: Conf };
export type FieldKey = 'name' | 'dob' | 'gender' | 'address' | 'city' | 'state' | 'pin' | 'maskedNumber';
export type AadhaarFields = Partial<Record<FieldKey, Field>> & { yearOfBirth?: string; fromQr?: boolean };
export type ReadResult = { texts: string[]; quality: number; qr?: AadhaarFields }; // one text per OCR pass; quality 0–100

export class PasswordNeeded extends Error {}
const isPdfFile = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

/** Reads one uploaded side: QR code + text. */
export async function readSide(file: File, password?: string): Promise<ReadResult> {
  let canvas: HTMLCanvasElement, layer = '';
  if (isPdfFile(file)) {
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    let doc;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise; }
    catch (e) { if ((e as Error).name === 'PasswordException') throw new PasswordNeeded(); throw e; }
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      layer += tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('') + '\n';
    }
    const page = await doc.getPage(1); // rendered for the QR code (and OCR if the PDF has no text)
    const vp = page.getViewport({ scale: 3 });
    canvas = blank(vp.width, vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  } else canvas = await toCanvas(file);

  const qr = await scanQr(canvas);
  if (layer.replace(/\s/g, '').length > 40) return { texts: [layer], quality: 100, qr };
  return { ...(await ocr(canvas)), qr };
}

const blank = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return c; };
async function toCanvas(file: File) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); // honours the phone's rotation flag
  const c = blank(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}
function scaled(src: HTMLCanvasElement, maxSide: number, crop = { x: 0, w: 1 }) {
  const sw = src.width * crop.w, k = maxSide / Math.max(sw, src.height);
  const c = blank(sw * k, src.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, src.width * crop.x, 0, sw, src.height, 0, 0, c.width, c.height);
  return c;
}

/** Dense Secure QR codes decode best at certain sizes, so try a few sizes and the left/right halves of the card. */
async function scanQr(src: HTMLCanvasElement): Promise<AadhaarFields | undefined> {
  const { default: jsQR } = await import('jsqr');
  const tries = [scaled(src, 1400), scaled(src, 1000), scaled(src, 2000), scaled(src, 1200, { x: 0.45, w: 0.55 }), scaled(src, 1200, { x: 0, w: 0.55 })];
  for (const c of tries) {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const code = jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) { const f = await decodeQrPayload(code.data); if (f) return f; }
  }
  return undefined;
}

/** Two OCR passes on cleaned-up copies: contrast-stretched grey (auto layout) and black/white (sparse text). */
async function ocr(src: HTMLCanvasElement): Promise<{ texts: string[]; quality: number }> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const a = await worker.recognize(prep(src, false), { rotateAuto: true });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const b = await worker.recognize(prep(src, true), { rotateAuto: true });
    return { texts: [a.data.text, b.data.text], quality: Math.max(a.data.confidence, b.data.confidence) };
  } finally { await worker.terminate(); }
}

/** Upscale small photos (~2000 px), greyscale, stretch contrast; optionally Otsu black/white. */
function prep(src: HTMLCanvasElement, binarize: boolean) {
  const c = scaled(src, Math.min(2400, Math.max(2000, src.width, src.height)));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height), p = img.data, n = p.length / 4;
  const g = new Uint8ClampedArray(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) { g[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]; hist[g[i]]++; }
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255 && (acc += hist[lo]) < n * 0.01; lo++);
  for (acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) g[i] = ((g[i] - lo) * 255) / span;
  let t = 256;
  if (binarize) { // Otsu threshold
    const h2 = new Array(256).fill(0); for (let i = 0; i < n; i++) h2[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * h2[i];
    let sB = 0, wB = 0, best = 0;
    for (let i = 0; i < 256; i++) {
      wB += h2[i]; if (!wB) continue; const wF = n - wB; if (!wF) break;
      sB += i * h2[i]; const between = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
      if (between > best) { best = between; t = i; }
    }
  }
  for (let i = 0; i < n; i++) { const v = binarize ? (g[i] > t ? 255 : 0) : g[i]; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------- Aadhaar QR (exact data) ----------------
async function inflate(b: Uint8Array<ArrayBuffer>) {
  for (const fmt of ['gzip', 'deflate'] as const) {
    try { return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer()); } catch { /* try next */ }
  }
  throw new Error('not an Aadhaar QR');
}

/**
 * Secure QR (cards since 2019, e-Aadhaar): a big decimal number → bytes → gzip → fields split by byte 255.
 * Older cards: <PrintLetterBarcodeData uid=".." name=".." .../>. Returns null for any other QR.
 */
export async function decodeQrPayload(raw: string): Promise<AadhaarFields | null> {
  const s = raw.trim();
  if (/^<\?xml|^<PrintLetterBarcodeData/i.test(s)) {
    const a: Record<string, string> = {};
    for (const m of s.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) a[m[1].toLowerCase()] = m[2];
    if (!a.name) return null;
    const uid = (a.uid ?? '').replace(/\D/g, '');
    return fromQr({ name: a.name, dob: a.dob || a.yob, gender: a.gender, careOf: a.co, house: a.house, street: a.street, landmark: a.lm, location: a.loc,
      vtc: a.vtc, po: a.po, district: a.dist, state: a.state, pin: a.pc, last4: uid.slice(-4), checksumOk: uid.length === 12 ? verhoeffOk(uid) : undefined });
  }
  if (!/^\d{100,}$/.test(s)) return null;
  let hex = BigInt(s).toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let data: Uint8Array;
  try { data = await inflate(Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16))); } catch { return null; }
  const parts: string[] = [];
  const dec = new TextDecoder('latin1');
  for (let i = 0, start = 0; i < data.length && parts.length < 20; i++) if (data[i] === 255) { parts.push(dec.decode(data.subarray(start, i))); start = i + 1; }
  // V2/V3 payloads start with a version field; then: indicator, reference id, name, dob, gender, care-of, district, landmark, house, location, pin, PO, state, street, sub-district, VTC
  const f = parts.slice(/^V\d+$/.test(parts[0] ?? '') ? 2 : 1);
  const [ref, name, dob, gender, careOf, district, landmark, house, location, pin, po, state, street, , vtc] = f;
  if (!name || !ref) return null;
  return fromQr({ name, dob, gender, careOf, district, landmark, house, location, pin, po, state, street, vtc, last4: /^\d{4}/.test(ref) ? ref.slice(0, 4) : '' });
}

function fromQr(q: { name: string; dob?: string; gender?: string; careOf?: string; house?: string; street?: string; landmark?: string; location?: string; vtc?: string; po?: string; district?: string; state?: string; pin?: string; last4?: string; checksumOk?: boolean }): AadhaarFields {
  const hi = (value: string): Field => ({ value: value.trim(), conf: 'high' });
  const out: AadhaarFields = { fromQr: true, name: hi(titleCase(q.name.trim().replace(/\s+/g, ' '))) };
  const d = q.dob?.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/) ?? q.dob?.match(/(\d{4})-(\d{2})-(\d{2})/);
  const iso = d ? (d[1].length === 4 ? validDate(d[3], d[2], d[1]) : validDate(d[1], d[2], d[3])) : '';
  if (iso) out.dob = hi(iso); else if (/^\d{4}$/.test(q.dob?.trim() ?? '')) out.yearOfBirth = q.dob!.trim();
  const g = ({ M: 'Male', F: 'Female', T: 'Transgender' } as Record<string, string>)[(q.gender ?? '').trim().toUpperCase()[0] ?? ''];
  if (g) out.gender = hi(g);
  const seen = new Set([q.district, q.state, q.pin].map((x) => x?.trim().toLowerCase()));
  const parts = [q.careOf, q.house, q.street, q.landmark, q.location, q.vtc, q.po].map((x) => x?.trim()).filter((x): x is string => {
    if (!x || seen.has(x.toLowerCase())) return false; seen.add(x.toLowerCase()); return true;
  });
  if (parts.length) out.address = hi(parts.join(', '));
  const city = q.district?.trim() || q.vtc?.trim();
  if (city) out.city = hi(titleCase(city));
  if (q.state?.trim()) out.state = hi(matchState(q.state) ?? q.state.trim());
  if (/^\d{6}$/.test(q.pin?.trim() ?? '')) out.pin = hi(q.pin!.trim());
  if (q.last4 && /^\d{4}$/.test(q.last4)) out.maskedNumber = { value: `XXXXXXXX${q.last4}`, conf: q.checksumOk === false ? 'low' : 'high' };
  return out;
}

/** Per field: QR value first, then the first clearly-read OCR value, then any OCR value. */
export function mergeFields(...results: (AadhaarFields | undefined)[]): AadhaarFields {
  const rs = results.filter((r): r is AadhaarFields => !!r);
  const out: AadhaarFields = { fromQr: rs.some((r) => r.fromQr) };
  const keys: FieldKey[] = ['name', 'dob', 'gender', 'address', 'city', 'state', 'pin', 'maskedNumber'];
  for (const k of keys) {
    const pick = rs.find((r) => r.fromQr && r[k]) ?? rs.find((r) => r[k]?.conf === 'high') ?? rs.find((r) => r[k]);
    if (pick?.[k]) out[k] = pick[k];
  }
  if (!out.dob) out.yearOfBirth = rs.find((r) => r.yearOfBirth)?.yearOfBirth;
  if (!out.yearOfBirth) delete out.yearOfBirth;
  return out;
}

// ---------------- parsing (pure, unit-tested) ----------------
const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
const STATE_ALIAS: Record<string, string> = { orissa: 'Odisha', pondicherry: 'Puducherry', 'nct of delhi': 'Delhi', 'new delhi': 'Delhi', uttaranchal: 'Uttarakhand' };
const matchState = (s: string) => {
  const t = s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [k, v] of Object.entries(STATE_ALIAS)) if (t.includes(k)) return v;
  return [...STATES].sort((a, b) => b.length - a.length).find((st) => t.includes(st.toLowerCase()));
};

// Verhoeff checksum — every real Aadhaar number passes it
const VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
export const verhoeffOk = (n: string) => [...n].reverse().reduce((c, ch, i) => VD[c][VP[i % 8][+ch]], 0) === 0;

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
const NAME_RE = /^[A-Za-z][A-Za-z .']{2,49}$/;
const NOT_NAME = /government|india|male|female|transgender|dob|birth|year|address|aadhaar|unique|authority|identification|enrol|help|www|signature|issue|download|vid|father|husband/i;

function validDate(d: string, m: string, y: string) {
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  const ok = dt.getUTCDate() === +d && dt.getUTCMonth() === +m - 1 && +y >= 1900 && +y <= new Date().getFullYear() - 3;
  return ok ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
}

/**
 * front/back: text of each side. quality: OCR confidence per side (fields read from a blurry side are marked "low").
 * Fields that are not printed or cannot be read are simply absent — nothing is guessed.
 */
export function parseAadhaar(front: string, back: string, quality = { front: 100, back: 100 }): AadhaarFields {
  const out: AadhaarFields = {};
  const fq: Conf = quality.front >= 70 ? 'high' : 'low', bq: Conf = quality.back >= 70 ? 'high' : 'low';
  const both = (c: Conf, q: Conf): Conf => (c === 'high' && q === 'high' ? 'high' : 'low');
  const all = `${front}\n${back}`;

  // ---- front: DOB, gender, name ----
  const lines = all.split('\n').map((l) => l.trim()).filter(Boolean);
  const dobRe = /(?:DOB|D\.O\.B\.?|Date of Birth|Birth)\s*[:\-]?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i;
  const dobAt = lines.findIndex((l) => dobRe.test(l));
  if (dobAt >= 0) {
    const [, d, m, y] = lines[dobAt].match(dobRe)!;
    const iso = validDate(d, m, y);
    if (iso) out.dob = { value: iso, conf: fq };
  }
  const yob = all.match(/Year of Birth\s*[:\-]?\s*((?:19|20)\d{2})/i);
  if (!out.dob && yob) out.yearOfBirth = yob[1]; // only the year is printed — DOB stays empty

  const g = all.match(/\b(female|male|transgender)\b/i);
  if (g) out.gender = { value: titleCase(g[1].toUpperCase()), conf: fq };

  const anchor = dobAt >= 0 ? dobAt : lines.findIndex((l) => /year of birth/i.test(l));
  const near = anchor > 0 ? lines.slice(Math.max(0, anchor - 3), anchor).reverse().find((l) => NAME_RE.test(l) && !NOT_NAME.test(l)) : undefined;
  if (near) out.name = { value: titleCase(near.replace(/\s+/g, ' ')), conf: fq };
  else {
    const any = front.split('\n').map((l) => l.trim()).find((l) => NAME_RE.test(l) && !NOT_NAME.test(l) && l.split(' ').length >= 2);
    if (any) out.name = { value: titleCase(any.replace(/\s+/g, ' ')), conf: 'low' };
  }

  // ---- Aadhaar number (ignore 16-digit VIDs) ----
  // spaces only (` ?`): a line break must never join two separate numbers
  const noVid = all.replace(/\b\d{4} ?\d{4} ?\d{4} ?\d{4}\b/g, ' ');
  const num = noVid.match(/\b([2-9]\d{3}) ?(\d{4}) ?(\d{4})\b/);
  if (num) { const digits = num.slice(1).join(''); out.maskedNumber = { value: mask(digits), conf: verhoeffOk(digits) ? 'high' : 'low' }; }

  // ---- back: address, city, state, PIN ----
  const src = /address/i.test(back) ? back : /address/i.test(front) ? front : back;
  const sq = src === back ? bq : fq;
  const at = src.search(/address\s*[:\-]?/i);
  let addr = (at >= 0 ? src.slice(at).replace(/^address\s*[:\-]?\s*/i, '') : src).replace(/\r/g, '');
  const pinM = addr.match(/(?:PIN(?:\s*Code)?\s*[:\-]?\s*)?\b([1-9]\d{2}) ?(\d{3})\b/i);
  if (pinM) {
    out.pin = { value: pinM[1] + pinM[2], conf: sq };
    addr = addr.slice(0, pinM.index);
  } else if (at < 0) addr = ''; // no label and no PIN: don't treat random text as an address
  if (addr) {
    // label must start a segment, so "Sub District:" is not read as "District:"
    const labelled = (k: string) => addr.match(new RegExp(`(?:^|[,\\n])\\s*${k}\\s*:\\s*([^,\\n]+)`, 'i'))?.[1].trim();
    let segs = addr.split(/[,\n]/).map((x) => x.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')).filter((x) => x && !/^(?:PIN(?:\s*Code)?)$/i.test(x));
    const stLab = labelled('State'), distLab = labelled('District');
    let stIdx = -1;
    segs.forEach((x, i) => { if (matchState(x)) stIdx = i; }); // last segment naming a state
    const state = (stLab && matchState(stLab)) || (stIdx >= 0 ? matchState(segs[stIdx]) : undefined);
    if (state) out.state = { value: state, conf: sq };
    let city = distLab;
    if (stIdx >= 0) segs = segs.slice(0, stIdx);
    segs = segs.filter((x) => !/^(state|sub district|district|pin code)\s*:/i.test(x));
    if (!city && segs.length > 1) city = segs[segs.length - 1].replace(/^(dist(rict)?\.?|vtc|po)\s*[:\-]?\s*/i, '');
    if (city && !/\d/.test(city)) {
      out.city = { value: titleCase(city), conf: both(distLab || /dist/i.test(segs[segs.length - 1] ?? '') ? 'high' : 'low', sq) };
      if (!distLab) segs = segs.slice(0, -1);
    }
    const street = segs.map((x) => x.replace(/^(vtc|po)\s*:\s*/i, '')).join(', ').replace(/\s+/g, ' ').trim();
    if (street.length >= 4) out.address = { value: street, conf: both(at >= 0 ? 'high' : 'low', sq) };
  }
  return out;
}
