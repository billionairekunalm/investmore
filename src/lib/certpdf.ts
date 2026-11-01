import type { Certificate, CertificateTemplate, TemplateField } from '../domain/types';
import { fmtDate } from '../domain/util';

export const FIELD_LABELS: Record<TemplateField['key'], string> = { name: 'Student name', course: 'Course name', date: 'Completion date', certId: 'Certificate ID', batch: 'Batch' };
export const fieldValue = (k: TemplateField['key'], c: Pick<Certificate, 'id' | 'data'>) =>
  k === 'name' ? c.data.name : k === 'course' ? c.data.course : k === 'date' ? fmtDate(c.data.date) : k === 'certId' ? c.id : c.data.batch;

/** Draws fields onto page 1 of the template. Field x/y are fractions of page size (from top-left); size is per 1000 units of width. Text is centred on x. */
async function drawOne(tpl: CertificateTemplate, cert: Pick<Certificate, 'id' | 'data'>) {
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
    const font = f.key === 'name' ? bold : reg;
    const text = fieldValue(f.key, cert);
    const size = (f.size * W) / 1000;
    page.drawText(text, { x: f.x * W - font.widthOfTextAtSize(text, size) / 2, y: H - f.y * H - size * 0.35, size, font, color: rgb(0.1, 0.1, 0.12) });
  }
  doc.setTitle(`Certificate ${cert.id}`);
  return doc;
}

export async function certificatePdf(tpl: CertificateTemplate, cert: Pick<Certificate, 'id' | 'data'>) {
  return (await drawOne(tpl, cert)).save();
}

/** All certificates in one PDF — for printing. */
export async function mergedPdf(items: { tpl: CertificateTemplate; cert: Certificate }[]) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const { tpl, cert } of items) {
    const one = await drawOne(tpl, cert);
    const [p] = await out.copyPages(one, [0]);
    out.addPage(p);
  }
  return out.save();
}

export async function zipPdfs(items: { tpl: CertificateTemplate; cert: Certificate }[]) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const { tpl, cert } of items) zip.file(`${cert.id}-${cert.data.name.replace(/[^\w]+/g, '_')}.pdf`, await certificatePdf(tpl, cert));
  return zip.generateAsync({ type: 'blob' });
}

export const saveBlob = (data: Uint8Array | Blob, name: string, type = 'application/pdf') => {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
export const openBlob = (data: Uint8Array) => window.open(URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' })), '_blank');
