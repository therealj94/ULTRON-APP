/**
 * PDF mínimo (Helvetica, Latin-1). Sin dependencias. Para informes cortos de junta.
 * No es un editor de documentos: título + cuerpo + pie.
 */

function winAnsi(s: string): string {
  let out = '';
  for (const ch of s.replace(/\r\n/g, '\n')) {
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += `\\${ch}`;
      continue;
    }
    if (ch === '\n') {
      out += '\\n';
      continue;
    }
    const c = ch.charCodeAt(0);
    if (c === 9) {
      out += ' ';
      continue;
    }
    if (c < 32) continue;
    if (c < 128) {
      out += ch;
      continue;
    }
    if (c < 256) {
      out += `\\${c.toString(8).padStart(3, '0')}`;
      continue;
    }
    out += '?';
  }
  return out;
}

function wrap(text: string, width = 92): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const words = raw.split(/\s+/);
    let cur = '';
    for (const w of words) {
      if (!w) continue;
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > width) {
        if (cur) lines.push(cur);
        cur = w.length > width ? w.slice(0, width) : w;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines.slice(0, 60);
}

export function textoAPdf(opts: { titulo: string; cuerpo: string; pie?: string }): Buffer {
  const titulo = String(opts.titulo || 'AU-RA').slice(0, 80);
  const pie = String(opts.pie || `AU-RA FP · ${new Date().toISOString().slice(0, 16)} UTC`);
  const body = wrap(String(opts.cuerpo || '').slice(0, 4000));
  const content: string[] = ['BT', '/F1 16 Tf', '50 780 Td', `(${winAnsi(titulo)}) Tj`, '/F1 11 Tf', '0 -28 Td'];
  for (const line of body) {
    content.push(`(${winAnsi(line)}) Tj`, '0 -14 Td');
  }
  content.push('/F1 9 Tf', '0 -20 Td', `(${winAnsi(pie)}) Tj`, 'ET');
  const stream = content.join('\n');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
