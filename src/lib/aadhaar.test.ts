import { describe, expect, it } from 'vitest';
import { decodeQrPayload, mergeFields, parseAadhaar, verhoeffOk } from './aadhaar';

// Builds a Secure QR payload the way UIDAI does: fields joined by byte 255 → gzip → one big decimal number.
async function secureQr(fields: string[]) {
  const enc = new TextEncoder();
  const bytes: number[] = [];
  for (const f of fields) bytes.push(...enc.encode(f), 255);
  bytes.push(...new Array(64).fill(7)); // stands in for the photo + signature that follow the text fields
  const gz = new Uint8Array(await new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return BigInt('0x' + [...gz].map((b) => b.toString(16).padStart(2, '0')).join('')).toString();
}
const QR_FIELDS = ['3', '0124' + '20231115103000123', 'Ananya Verma', '14-08-2002', 'F', 'D/O: Sunil Verma', 'Kolkata', 'Near City Centre', '22', 'Salt Lake',
  '700091', 'Bidhannagar', 'West Bengal', 'Park Street', 'Bidhannagar', 'Salt Lake'];

describe('decodeQrPayload (exact data from the Aadhaar QR)', () => {
  it('decodes a V2 Secure QR', async () => {
    const r = await decodeQrPayload(await secureQr(['V2', ...QR_FIELDS]));
    expect(r).toMatchObject({
      fromQr: true, name: { value: 'Ananya Verma', conf: 'high' }, dob: { value: '2002-08-14' }, gender: { value: 'Female' },
      city: { value: 'Kolkata' }, state: { value: 'West Bengal' }, pin: { value: '700091' }, maskedNumber: { value: 'XXXXXXXX0124' },
    });
    expect(r?.address?.value).toBe('D/O: Sunil Verma, 22, Park Street, Near City Centre, Salt Lake, Bidhannagar');
  });
  it('decodes the older Secure QR without a version field', async () => {
    expect((await decodeQrPayload(await secureQr(QR_FIELDS)))?.name?.value).toBe('Ananya Verma');
  });
  it('decodes the old XML QR and keeps only the last 4 digits', async () => {
    const r = await decodeQrPayload(`<?xml version="1.0" encoding="UTF-8"?> <PrintLetterBarcodeData uid="${N}" name="Rohan Sharma" gender="M" yob="1998" co="S/O Ramesh Sharma" house="12" street="MG Road" lm="" loc="Indiranagar" vtc="Bengaluru" po="Indiranagar" dist="Bengaluru" state="Karnataka" pc="560038"/>`);
    expect(r).toMatchObject({ name: { value: 'Rohan Sharma' }, gender: { value: 'Male' }, yearOfBirth: '1998', city: { value: 'Bengaluru' }, pin: { value: '560038' } });
    expect(r?.dob).toBeUndefined();
    expect(r?.maskedNumber?.value).toBe(`XXXXXXXX${N.slice(-4)}`);
    expect(JSON.stringify(r)).not.toContain(N); // full number never leaves the decoder
  });
  it('ignores QR codes that are not Aadhaar', async () => {
    expect(await decodeQrPayload('https://example.com')).toBeNull();
    expect(await decodeQrPayload('1234567890')).toBeNull();
  });
  it('prefers QR values over OCR guesses', () => {
    const m = mergeFields({ fromQr: true, city: { value: 'Kolkata', conf: 'high' } }, { city: { value: 'Kolkat', conf: 'low' }, pin: { value: '700091', conf: 'high' } });
    expect(m).toMatchObject({ fromQr: true, city: { value: 'Kolkata' }, pin: { value: '700091' } });
  });
});

// builds a 12-digit number with a valid Verhoeff check digit (test data only, not a real Aadhaar)
const valid = (base11: string) => { for (let d = 0; d < 10; d++) if (verhoeffOk(base11 + d)) return base11 + d; throw new Error(); };
const spaced = (n: string) => `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
const N = valid('23456789012');

describe('parseAadhaar', () => {
  it('reads a standard card (front + back)', () => {
    const front = `भारत सरकार\nGOVERNMENT OF INDIA\nROHAN SHARMA\nजन्म तिथि/DOB: 12/05/1998\nपुरुष/ MALE\n${spaced(N)}\nमेरा आधार, मेरी पहचान`;
    const back = `Unique Identification Authority of India\nAddress: S/O Ramesh Sharma, 12, MG Road,\nNear Ganesh Temple, Indiranagar,\nBengaluru, Karnataka - 560038\n${spaced(N)}\n1947 help@uidai.gov.in www.uidai.gov.in`;
    const r = parseAadhaar(front, back);
    expect(r.name).toEqual({ value: 'Rohan Sharma', conf: 'high' });
    expect(r.dob).toEqual({ value: '1998-05-12', conf: 'high' });
    expect(r.gender?.value).toBe('Male');
    expect(r.maskedNumber).toEqual({ value: `XXXXXXXX${N.slice(-4)}`, conf: 'high' });
    expect(r.pin?.value).toBe('560038');
    expect(r.state?.value).toBe('Karnataka');
    expect(r.city).toEqual({ value: 'Bengaluru', conf: 'low' }); // guessed from position → flagged for review
    expect(r.address?.value).toBe('S/O Ramesh Sharma, 12, MG Road, Near Ganesh Temple, Indiranagar');
  });

  it('reads the labelled e-Aadhaar address and a year-only birth date', () => {
    const front = `Priya Patel\nYear of Birth : 2001\nFEMALE`;
    const back = `Address: C/O: Suresh Patel, 45, Shanti Nagar, VTC: Navrangpura, PO: Navrangpura, Sub District: Ahmedabad City, District: Ahmedabad, State: Gujarat, PIN Code: 380009`;
    const r = parseAadhaar(front, back);
    expect(r.name?.value).toBe('Priya Patel');
    expect(r.dob).toBeUndefined(); // only the year is printed — never invent a day/month
    expect(r.yearOfBirth).toBe('2001');
    expect(r.gender?.value).toBe('Female');
    expect(r.city).toEqual({ value: 'Ahmedabad', conf: 'high' });
    expect(r.state?.value).toBe('Gujarat');
    expect(r.pin?.value).toBe('380009');
    expect(r.address?.value).toContain('45, Shanti Nagar');
  });

  it('leaves out what it cannot read and flags doubtful values', () => {
    const r = parseAadhaar(`blurry ## text\nDOB: 31/02/1999\n${spaced('234567890123')}\nVID: 9123 4567 8901 2345`, '', { front: 40, back: 0 });
    expect(r.dob).toBeUndefined();            // 31 Feb is not a date
    expect(r.address).toBeUndefined();
    expect(r.pin).toBeUndefined();
    expect(r.maskedNumber?.conf).toBe('low'); // fails the checksum
    expect(r.maskedNumber?.value.endsWith('0123')).toBe(true); // the 16-digit VID is ignored
  });

  it('handles "&" in state names', () => {
    expect(parseAadhaar('', 'Address: 4 Lal Chowk, Srinagar, Jammu & Kashmir 190001').state?.value).toBe('Jammu and Kashmir');
  });
});
