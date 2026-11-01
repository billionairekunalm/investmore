import { sb } from '../store/cloud';
import { resizeImage } from './ocr';

/**
 * Aadhaar card images, saved with the student's consent.
 * Cloud: private Supabase Storage bucket 'aadhaar' (staff-only, see 0002_aadhaar_storage.sql); the record keeps 'sb:<path>'.
 * Device-only mode: the image is kept as a data URL inside the record.
 */
const BUCKET = 'aadhaar';
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
const asDataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

async function prepare(f: File): Promise<{ blob: Blob; ext: string; type: string }> {
  if (isPdf(f)) return { blob: f, ext: 'pdf', type: 'application/pdf' };
  const url = await resizeImage(f, 1600); // clear enough to read, small enough to store
  return { blob: await (await fetch(url)).blob(), ext: 'jpg', type: 'image/jpeg' };
}

export async function storeAadhaar(studentId: string, files: { front?: File; back?: File }) {
  const out: { front?: string; back?: string } = {};
  for (const side of ['front', 'back'] as const) {
    const f = files[side];
    if (!f) continue;
    const { blob, ext, type } = await prepare(f);
    if (!sb) { out[side] = await asDataUrl(blob); continue; }
    const path = `${studentId}/${side}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: type });
    if (error) throw new Error(`Could not save the Aadhaar ${side} side: ${error.message}`);
    out[side] = `sb:${path}`;
  }
  return out;
}

/** Short-lived link to view a saved image (5 minutes). */
export async function aadhaarUrl(ref: string) {
  if (!ref.startsWith('sb:')) return ref;
  const { data, error } = await sb!.storage.from(BUCKET).createSignedUrl(ref.slice(3), 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function removeAadhaar(refs: (string | undefined)[]) {
  const paths = refs.filter((r): r is string => !!r && r.startsWith('sb:')).map((r) => r.slice(3));
  if (sb && paths.length) await sb.storage.from(BUCKET).remove(paths);
}
