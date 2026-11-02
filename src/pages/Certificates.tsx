import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as S from '../store/store';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Table, Tabs, useRun, useUI, cx } from '../ui/kit';
import type { CertificateTemplate, TemplateField } from '../domain/types';
import { fmtDateTime, todayIST } from '../domain/util';
import { certificatePdf, FIELD_LABELS, fieldValue, mergedPdf, openBlob, saveBlob, zipPdfs } from '../lib/certpdf';

export default function Certificates() {
  const db = S.useDB();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<'issue' | 'issued' | 'templates'>(db.templates.length ? 'issue' : 'templates');
  const eligible = db.students.filter((s) => s.status === 'Completed' && !db.certificates.some((c) => c.studentId === s.id && c.status === 'Issued'));
  return (
    <>
      <PageHeader title="Certificates" sub="Restricted to authorised administrators. Every generation, download and revocation is logged." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'issue', label: 'Ready to issue', count: eligible.length }, { id: 'issued', label: 'Issued', count: db.certificates.length }, { id: 'templates', label: 'Templates', count: db.templates.length }]} />
      {tab === 'issue' && <Issue eligible={eligible} preselect={sp.get('student')} />}
      {tab === 'issued' && <Issued />}
      {tab === 'templates' && <Templates />}
    </>
  );
}

function Issue({ eligible, preselect }: { eligible: ReturnType<typeof S.getDB>['students']; preselect: string | null }) {
  const db = S.useDB();
  const run = useRun();
  const { toast } = useUI();
  const [sel, setSel] = useState<Set<string>>(new Set(preselect ? [preselect] : []));
  const [tpl, setTpl] = useState(db.templates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  if (!db.templates.length) return <Card><Empty title="Upload a certificate template first" body="Go to the Templates tab and upload a PNG, JPG or PDF design." /></Card>;
  const issue = async () => {
    const certs = run(() => S.issueCertificates([...sel], tpl), `${sel.size} certificate(s) issued`);
    if (!certs) return;
    setBusy(true);
    try {
      const t = db.templates.find((x) => x.id === tpl)!;
      const items = certs.map((cert) => ({ tpl: t, cert, photo: db.students.find((x) => x.id === cert.studentId)?.photo }));
      if (items.length === 1) saveBlob(await certificatePdf(t, items[0].cert, items[0].photo), `${items[0].cert.id}.pdf`);
      else saveBlob(await zipPdfs(items), `certificates-${todayIST()}.zip`, 'application/zip');
      S.logCertificateEvent(certs.map((c) => c.id), 'downloaded');
    } catch (e) { toast(`PDF generation failed: ${(e as Error).message}`, 'bad'); }
    setBusy(false); setSel(new Set());
  };
  const course = (id: string) => db.courses.find((c) => c.id === id)?.name ?? '';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
        <Select value={tpl} onChange={(e) => setTpl(e.target.value)} options={db.templates.map((t) => ({ value: t.id, label: t.name }))} className="w-56" />
        <div className="flex-1" />
        <Button variant="primary" loading={busy} disabled={!sel.size || !S.allowed('certificates', 'create', db)} onClick={issue}>Generate {sel.size || ''} certificate{sel.size === 1 ? '' : 's'}</Button>
      </div>
      <Table rows={eligible} rowKey={(s) => s.id} selectable selected={sel} onSelect={setSel}
        empty={<Empty title="No students waiting" body="Students appear here when marked Completed on their profile." />}
        cols={[
          { key: 'c', label: 'ID', render: (s) => <span className="text-muted">{s.code}</span> }, { key: 'n', label: 'Name', render: (s) => <span className="font-medium">{s.name}</span> },
          { key: 'co', label: 'Course', render: (s) => course(s.courseId) }, { key: 'b', label: 'Batch', render: (s) => db.batches.find((b) => b.id === s.batchId)?.name ?? '—' },
        ]} />
    </Card>
  );
}

function Issued() {
  const db = S.useDB();
  const run = useRun();
  const { ask, toast } = useUI();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // the photo comes from the student's profile at the moment the PDF is made
  const items = (ids: string[]) => db.certificates.filter((c) => ids.includes(c.id) && c.status === 'Issued')
    .map((cert) => ({ cert, tpl: db.templates.find((t) => t.id === cert.templateId)!, photo: db.students.find((x) => x.id === cert.studentId)?.photo })).filter((x) => x.tpl);
  const act = async (fn: () => Promise<void>, ids: string[]) => { setBusy(true); try { await fn(); S.logCertificateEvent(ids, 'downloaded'); } catch (e) { toast((e as Error).message, 'bad'); } setBusy(false); };
  const ids = [...sel];
  return (
    <Card>
      {sel.size > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-line bg-accent-soft/50 items-center">
          <span className="font-medium mr-2">{sel.size} selected</span>
          <Button size="sm" loading={busy} onClick={() => act(async () => saveBlob(await zipPdfs(items(ids)), `certificates-${todayIST()}.zip`, 'application/zip'), ids)}>Download ZIP</Button>
          <Button size="sm" loading={busy} onClick={() => act(async () => { openBlob(await mergedPdf(items(ids))); }, ids)}>Print all</Button>
        </div>
      )}
      <Table rows={[...db.certificates].reverse()} rowKey={(c) => c.id} selectable selected={sel} onSelect={setSel} empty={<Empty title="No certificates issued yet" />}
        cols={[
          { key: 'id', label: 'Certificate ID', render: (c) => <span className="font-medium">{c.id}</span>, sort: (c) => c.id },
          { key: 'n', label: 'Student', render: (c) => c.data.name, sort: (c) => c.data.name }, { key: 'co', label: 'Course', render: (c) => c.data.course },
          { key: 'd', label: 'Issued', render: (c) => fmtDateTime(c.issuedAt), sort: (c) => c.issuedAt }, { key: 'b', label: 'By', render: (c) => S.empName(c.issuedBy, db) },
          { key: 's', label: 'Status', render: (c) => <Badge>{c.status}</Badge> },
          { key: 'h', label: 'History', render: (c) => <span className="text-xs text-muted">{c.history.length} events</span> },
          { key: 'x', label: '', render: (c) => c.status === 'Issued' && (
            <div className="flex gap-1">
              <Button size="sm" onClick={() => act(async () => { const it = items([c.id])[0]; saveBlob(await certificatePdf(it.tpl, c, it.photo), `${c.id}.pdf`); }, [c.id])}>PDF</Button>
              {S.allowed('certificates', 'delete', db) && <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: `Revoke ${c.id}?`, input: 'Reason', confirm: 'Revoke', danger: true }); if (r) run(() => S.revokeCertificate(c.id, r), 'Certificate revoked'); }}>Revoke</Button>}
            </div>
          ) },
        ]} />
    </Card>
  );
}

const DEFAULT_FIELDS: TemplateField[] = [
  { key: 'name', x: 0.5, y: 0.45, size: 42 }, { key: 'course', x: 0.5, y: 0.56, size: 22 },
  { key: 'date', x: 0.25, y: 0.8, size: 16 }, { key: 'certId', x: 0.75, y: 0.8, size: 16 },
];

function Templates() {
  const db = S.useDB();
  const run = useRun();
  const { ask } = useUI();
  const [edit, setEdit] = useState<Partial<CertificateTemplate> | null>(null);
  return (
    <>
      <div className="flex justify-end mb-3">{S.allowed('certificates', 'create', db) && <Button variant="primary" onClick={() => setEdit({ name: '', fields: DEFAULT_FIELDS })}>+ Upload template</Button>}</div>
      {!db.templates.length ? <Card><Empty title="No templates yet" body="Upload your certificate design (PNG, JPG or a one-page PDF). Then place the dynamic fields." /></Card> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {db.templates.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <div className="aspect-[1.414] bg-surface border-b border-line grid place-items-center overflow-hidden">
                {t.fileType === 'application/pdf' ? <span className="text-muted">PDF template</span> : <img src={t.data} alt="" className="w-full h-full object-contain" />}
              </div>
              <div className="p-3 flex items-center justify-between">
                <div><div className="font-medium">{t.name}</div><div className="text-xs text-muted">{t.fields.length} fields · {db.certificates.filter((c) => c.templateId === t.id).length} issued</div></div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => setEdit(t)}>Edit</Button>
                  {S.allowed('certificates', 'delete', db) && <Button size="sm" variant="ghost" onClick={async () => { if (await ask({ title: `Delete ${t.name}?`, confirm: 'Delete', danger: true })) run(() => S.deleteTemplate(t.id), 'Template deleted'); }}>Delete</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <TemplateEditor initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TemplateEditor({ initial, onClose }: { initial: Partial<CertificateTemplate>; onClose: () => void }) {
  const run = useRun();
  const { toast } = useUI();
  const [t, setT] = useState<Partial<CertificateTemplate>>(initial);
  const [active, setActive] = useState<TemplateField['key']>('name');
  const [preview, setPreview] = useState<string>();
  const sample = { id: `CERT-${todayIST().slice(0, 4)}-0001`, data: { name: 'Aarav Sharma', course: 'Stock Market Mastery', date: todayIST(), batch: 'Morning Batch' } };
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const onFile = (f?: File) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(f.type)) return toast('Use a PNG, JPG or PDF file.', 'bad');
    if (f.size > 8 * 1024 * 1024) return toast('Template must be under 8 MB.', 'bad');
    const r = new FileReader(); r.onload = () => setT((x) => ({ ...x, data: String(r.result), fileType: f.type as CertificateTemplate['fileType'], name: x.name || f.name.replace(/\.\w+$/, '') })); r.readAsDataURL(f);
  };
  const fields = t.fields ?? [];
  const setField = (k: TemplateField['key'], patch: Partial<TemplateField>) => setT({ ...t, fields: fields.map((f) => (f.key === k ? { ...f, ...patch } : f)) });
  const toggle = (k: TemplateField['key']) => setT({ ...t, fields: fields.some((f) => f.key === k) ? fields.filter((f) => f.key !== k) : [...fields, k === 'photo' ? { key: k, x: 0.5, y: 0.28, size: 13 } : { key: k, x: 0.5, y: 0.5, size: 18 }] });
  const doPreview = async () => {
    try { const b = await certificatePdf(t as CertificateTemplate, sample); setPreview(URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/pdf' }))); }
    catch (e) { toast(`Could not render: ${(e as Error).message}`, 'bad'); }
  };
  const save = () => { let ok = false; run(() => { S.saveTemplate(t as any); ok = true; }, 'Template saved'); if (ok) onClose(); };
  const isImg = t.fileType && t.fileType !== 'application/pdf';
  return (
    <Modal open onClose={onClose} title={t.id ? `Edit ${t.name}` : 'New certificate template'} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button disabled={!t.data} onClick={doPreview}>Preview PDF</Button><Button variant="primary" disabled={!t.data || !t.name} onClick={save}>Save template</Button></>}>
      <div className="grid md:grid-cols-[1fr_260px] gap-4">
        <div>
          {!t.data ? (
            <label className="flex flex-col items-center justify-center aspect-[1.414] rounded-xl border-2 border-dashed border-line cursor-pointer hover:bg-surface">
              <input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <span className="font-medium">Upload design</span><span className="text-xs text-muted mt-1">PNG / JPG (high resolution) or one-page PDF</span>
            </label>
          ) : preview ? (
            <div><iframe src={preview} className="w-full aspect-[1.414] rounded-lg border border-line" title="Preview" /><Button size="sm" variant="ghost" className="mt-2" onClick={() => setPreview(undefined)}>Back to editor</Button></div>
          ) : isImg ? (
            <div className="relative select-none cursor-crosshair rounded-lg overflow-hidden border border-line" style={{ containerType: 'inline-size' }} onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setField(active, { x: +((e.clientX - r.left) / r.width).toFixed(3), y: +((e.clientY - r.top) / r.height).toFixed(3) });
            }}>
              <img src={t.data} alt="" className="w-full block" draggable={false} />
              {fields.map((f) => f.key === 'photo' ? (
                <span key={f.key} className={cx('absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center bg-zinc-200/90 text-zinc-500 rounded-sm border-2 border-white', f.key === active ? 'ring-2 ring-accent' : 'ring-1 ring-zinc-400/60')}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.size}cqw`, height: `${f.size * 1.2}cqw`, fontSize: `${f.size / 6}cqw` }}>Photo</span>
              ) : (
                <span key={f.key} className={cx('absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-serif px-1 rounded', f.key === active ? 'ring-2 ring-accent bg-accent/10' : 'ring-1 ring-zinc-400/60')}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, fontSize: `${f.size / 10}cqw` }}>
                  {fieldValue(f.key, sample)}
                </span>
              ))}
            </div>
          ) : <div className="aspect-[1.414] rounded-lg border border-line grid place-items-center text-muted p-6 text-center">PDF template loaded. Set positions on the right, then use “Preview PDF”.</div>}
          {t.data && !preview && isImg && <p className="text-xs text-muted mt-2">Click on the design to place <b>{FIELD_LABELS[active]}</b>.</p>}
        </div>
        <div className="space-y-3">
          <Field label="Template name" required><Input value={t.name ?? ''} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
          {t.data && <label className="text-xs text-accent cursor-pointer">Replace file<input type="file" accept="image/png,image/jpeg,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>}
          <div className="text-[12.5px] font-medium text-zinc-700">Dynamic fields</div>
          {(Object.keys(FIELD_LABELS) as TemplateField['key'][]).map((k) => {
            const f = fields.find((x) => x.key === k);
            return (
              <div key={k} className={cx('rounded-lg border p-2', active === k && f ? 'border-accent' : 'border-line')} onClick={() => f && setActive(k)}>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!f} onChange={() => toggle(k)} className="accent-[var(--color-accent)]" /><span className="font-medium">{FIELD_LABELS[k]}</span></label>
                {f && (
                  <div className="grid grid-cols-3 gap-1.5 mt-2">
                    <Input type="number" step="0.01" min={0} max={1} value={f.x} onChange={(e) => setField(k, { x: +e.target.value })} title="X (0–1)" />
                    <Input type="number" step="0.01" min={0} max={1} value={f.y} onChange={(e) => setField(k, { y: +e.target.value })} title="Y (0–1)" />
                    <Input type="number" min={k === 'photo' ? 5 : 6} max={k === 'photo' ? 40 : 120} value={f.size} onChange={(e) => setField(k, { size: +e.target.value })} title={k === 'photo' ? 'Photo width (% of page)' : 'Size'} />
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-muted">X / Y are fractions of the page from the top-left (text is centred on X). Size is relative to page width; for the photo it is its width in % of the page. The photo comes from the student's profile.</p>
        </div>
      </div>
    </Modal>
  );
}
