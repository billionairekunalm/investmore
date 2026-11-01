import type { IdDocument } from '../domain/types';

/**
 * Runs OCR in the browser (tesseract.js, lazy-loaded) and extracts ONLY permitted fields.
 * The full ID number is masked immediately; the raw image and OCR text are discarded.
 * ponytail: on-device OCR; swap for a DPDP-compliant OCR / DigiLocker verification API when the backend lands.
 */
export async function extractId(image: Blob, type: IdDocument['type']): Promise<{ maskedNumber: string; nameOnDoc: string }> {
  const { default: Tesseract } = await import('tesseract.js');
  const { data } = await Tesseract.recognize(image, 'eng');
  const text = data.text;
  return { maskedNumber: maskFrom(text, type), nameOnDoc: guessName(text) };
}

export function maskFrom(text: string, type: IdDocument['type']): string {
  const patterns: Record<string, RegExp> = {
    Aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/, PAN: /\b[A-Z]{5}\d{4}[A-Z]\b/, Passport: /\b[A-Z]\d{7}\b/,
    'Voter ID': /\b[A-Z]{3}\d{7}\b/, 'Driving Licence': /\b[A-Z]{2}[-\s]?\d{2}[-\s]?\d{4,11}\b/,
  };
  const m = text.match(patterns[type] ?? /\b[A-Z0-9]{6,}\b/);
  return m ? mask(m[0]) : '';
}
export const mask = (raw: string) => { const c = raw.replace(/[\s-]/g, ''); return c.length < 5 ? '' : `${'X'.repeat(c.length - 4)}${c.slice(-4)}`; };

function guessName(text: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const skip = /government|india|male|female|dob|birth|year|address|aadhaar|income|tax|permanent|account|signature|\d/i;
  return lines.find((l) => /^[A-Za-z][A-Za-z .]{3,40}$/.test(l) && !skip.test(l)) ?? '';
}

/** Downscale a captured photo to keep records small. */
export function resizeImage(file: File, max = 320): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
