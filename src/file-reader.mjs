import { createTextAnalysis, decodeDiagnostic, parseDiagnostic } from './engine.mjs';
import { MAX_FILE_BYTES, MAX_STRUCTURED_BYTES, READ_CHUNK_BYTES, MAX_LINE_CHARACTERS } from '../shared/limits.mjs';

export function validateFile(file) {
  if (!file.size) throw new Error('The file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Files support up to 1 GiB each.');
  if (/\.(evtx|etl|dmp|mdmp|zip|cab)$/i.test(file.name)) throw new Error('Export binary reports as text or XML before importing.');
}
export async function* decodedChunks(file, progress = (_bytes, _total) => {}, chunkBytes = READ_CHUNK_BYTES) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const encoding = head[0] === 0xfe && head[1] === 0xff ? 'utf-16be' :
    (head[0] === 0xff && head[1] === 0xfe) || (head[1] === 0 && head[3] === 0) ? 'utf-16le' : 'utf-8';
  const decoder = new TextDecoder(encoding, { fatal: true });
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const bytes = await file.slice(offset, offset + chunkBytes).arrayBuffer();
    const text = decoder.decode(bytes, { stream: offset + chunkBytes < file.size });
    if (text.includes('\0')) throw new Error('Binary input is unsupported. Export as text or XML.');
    progress(Math.min(file.size, offset + bytes.byteLength), file.size);
    yield text;
  }
}
export async function* lineBatches(file, progress, chunkBytes) {
  let carry = '';
  for await (const chunk of decodedChunks(file, progress, chunkBytes)) {
    const parts = (carry + chunk).split('\n');
    carry = parts.pop();
    if (carry.length > MAX_LINE_CHARACTERS || parts.some(line => line.length > MAX_LINE_CHARACTERS)) {
      throw new Error('A source line exceeds 1 MiB. Export a formatted report with line breaks.');
    }
    if (parts.length) yield parts.map(line => line.replace(/\r$/, ''));
  }
  yield [carry.replace(/\r$/, '')];
}
export async function analyzeFile(file, id, progress = (_bytes, _total) => {}) {
  validateFile(file);
  // Read only the prefix to choose a parser; the renderer never holds decoded full logs.
  let prefix = '';
  for await (const chunk of decodedChunks(file, undefined, 4096)) { prefix = chunk; break; }
  if (/^\s*</.test(prefix) || /\.(csv|wer|json)$/i.test(file.name)) {
    if (file.size > MAX_STRUCTURED_BYTES) throw new Error('XML, JSON, CSV, and WER reports support up to 128 MiB; text logs support up to 1 GiB.');
    progress(0, file.size);
    const report = parseDiagnostic({ id, name: file.name, text: decodeDiagnostic(await file.arrayBuffer()) });
    progress(file.size, file.size);
    return report;
  }
  if (prefix.startsWith('bplist')) throw new Error('Export this binary property list as XML.');
  const analysis = createTextAnalysis(file.name, id);
  let pending = [], offset = 0;
  for await (const batch of lineBatches(file, progress)) {
    pending = pending.concat(batch);
    // Preserve 12 lookahead lines for stack evidence across read boundaries.
    if (pending.length > 12) {
      const count = pending.length - 12;
      analysis.consume(pending.join('\n'), offset, count);
      pending = pending.slice(count);
      offset += count;
    }
  }
  if (pending.length) analysis.consume(pending.join('\n'), offset, pending.length);
  return analysis.finish();
}
export async function readSourcePage(file, start = 0, query = '', pageSize = 500, progress = (_bytes, _total) => {}) {
  const rows = [], needle = query.toLowerCase();
  let line = 0, matched = 0;
  for await (const batch of lineBatches(file, progress)) {
    for (const text of batch) {
      line++;
      if (needle && !text.toLowerCase().includes(needle)) continue;
      if (matched++ < start) continue;
      if (rows.length === pageSize) return { rows, hasNext: true };
      // A huge single line stays in the source file, but does not swamp the DOM.
      rows.push({ line, text: text.length > 8000 ? text.slice(0, 8000) + ' … [line display shortened]' : text });
    }
  }
  return { rows, hasNext: false };
}
