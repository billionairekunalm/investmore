import type { Certificate, CertificateTemplate, TemplateField } from '../domain/types';
import { fmtDate } from '../domain/util';

export const FIELD_LABELS: Record<TemplateField['key'], string> = { name: 'Student name', course: 'Course name', date: 'Completion date', certId: 'Certificate ID', batch: 'Batch', photo: 'Student photo' };
export const fieldValue = (k: TemplateField['key'], c: Pick<Certificate, 'id' | 'data'>) =>
  k === 'name' ? c.data.name : k === 'course' ? c.data.course : k === 'date' ? fmtDate(c.data.date) : k === 'certId' ? c.id : k === 'photo' ? '' : c.data.batch;

/**
 * Draws fields onto page 1 of the template. Field x/y are fractions of page size (from top-left); size is per 1000 units of width.
 * Text is centred on x. The student photo is centred on x/y, `size`% of the page wide, with a thin white frame
 * (no photo on file: a light "Photo" box, so the space is visible in previews).
 */
async function drawOne(tpl: CertificateTemplate, cert: Pick<Certificate, 'id' | 'data'>, photo?: string) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const bytes = await (await fetch(tpl.data)).arrayBuffer();
  let doc;
  if (tpl.fileType === 'application/pdf') {
    doc = await PDFDocument.load(bytes);
    doc.getPages().slice(1).forEach(() => doc!.removePage(1));
  } else {
    doc = await PDFDocument.create();
    const img = tpl.fileType === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const page = doc.getPage(0);
  const { width: W, height: H } = page.getSize();
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const reg = await doc.embedFont(StandardFonts.TimesRoman);
  for (const f of tpl.fields) {
    if (f.key === 'photo') {
      const w = (f.size / 100) * W;
      let img;
      if (photo) {
        const pb = await (await fetch(photo)).arrayBuffer();
        img = /^data:image\/png/.test(photo) ? await doc.embedPng(pb) : await doc.embedJpg(pb);
      }
      const h = img ? (w * img.height) / img.width : w * 1.2;
      const x = f.x * W - w / 2, y = H - f.y * H - h / 2, pad = Math.max(1.5, w * 0.025);
      page.drawRectangle({ x: x - pad, y: y - pad, width: w + pad * 2, height: h + pad * 2, color: rgb(1, 1, 1), borderColor: rgb(0.75, 0.75, 0.78), borderWidth: 0.6 });
      if (img) page.drawImage(img, { x, y, width: w, height: h });
      else {
        page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.93, 0.93, 0.95) });
        const t = 'Photo', sz = w / 6;
        page.drawText(t, { x: x + w / 2 - reg.widthOfTextAtSize(t, sz) / 2, y: y + h / 2 - sz * 0.35, size: sz, font: reg, color: rgb(0.55, 0.55, 0.6) });
      }
      continue;
    }
    const font = f.key === 'name' ? bold : reg;
    const text = fieldValue(f.key, cert);
    const size = (f.size * W) / 1000;
    page.drawText(text, { x: f.x * W - font.widthOfTextAtSize(text, size) / 2, y: H - f.y * H - size * 0.35, size, font, color: rgb(0.1, 0.1, 0.12) });
  }
  doc.setTitle(`Certificate ${cert.id}`);
  return doc;
}

export async function certificatePdf(tpl: CertificateTemplate, cert: Pick<Certificate, 'id' | 'data'>, photo?: string) {
  return (await drawOne(tpl, cert, photo)).save();
}

/** All certificates in one PDF — for printing. */
export async function mergedPdf(items: { tpl: CertificateTemplate; cert: Certificate; photo?: string }[]) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const { tpl, cert, photo } of items) {
    const one = await drawOne(tpl, cert, photo);
    const [p] = await out.copyPages(one, [0]);
    out.addPage(p);
  }
  return out.save();
}

export async function zipPdfs(items: { tpl: CertificateTemplate; cert: Certificate; photo?: string }[]) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const { tpl, cert, photo } of items) zip.file(`${cert.id}-${cert.data.name.replace(/[^\w]+/g, '_')}.pdf`, await certificatePdf(tpl, cert, photo));
  return zip.generateAsync({ type: 'blob' });
}

export const saveBlob = (data: Uint8Array | Blob, name: string, type = 'application/pdf') => {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
export const openBlob = (data: Uint8Array) => window.open(URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' })), '_blank');
