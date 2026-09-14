import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFile, readSourcePage, decodedChunks, validateFile } from '../src/file-reader.mjs';
import { MAX_FILE_BYTES, MAX_STRUCTURED_BYTES } from '../shared/limits.mjs';

test('a log over 10 MiB and 120,000 lines is streamed to its final finding and paged by original line', async () => {
  const padding = 'INFO ' + 'routine status '.repeat(5) + '\n';
  const file = new File([padding.repeat(150000), '[SR] Cannot repair member file final.dll\n'], 'CBS.log');
  assert.ok(file.size > 10 * 1024 * 1024);
  const progress = [];
  const result = await analyzeFile(file, 'large', bytes => progress.push(bytes));
  assert.equal(result.lineCount, 150002);
  assert.equal(result.findings[0].evidence[0].locator, 'Line 150001');
  assert.equal(result.findings[0].occurrences, 1);
  assert.equal(progress.at(-1), file.size);
  const page = await readSourcePage(file, 0, 'final.dll');
  assert.equal(page.rows[0].line, 150001); assert.equal(page.hasNext, false);
  const last = await readSourcePage(file, 150000);
  assert.equal(last.rows.length, 2);
});
test('UTF-16 decoding carries split code units, CRLF, and surrogate pairs between reads', async () => {
  const text = 'Memory: 32 GB\r\nProcessor: test 😀\r\n';
  const file = new File([Buffer.from([255,254]), Buffer.from(text, 'utf16le')], 'DxDiag.txt');
  let output = ''; for await (const chunk of decodedChunks(file, undefined, 7)) output += chunk;
  assert.equal(output, text);
  assert.equal((await analyzeFile(file, 'utf16')).records[1].value, 'test 😀');
});
test('inventory sections and stack lookahead survive a read boundary', async () => {
  const prefix = '[Running Tasks]\n' + 'nothing\n'.repeat(140000);
  const file = new File([prefix, 'example.exe\tC:\\Apps\\example.exe\nUnhandled exception: test\n', '    at frame\n'.repeat(20)], 'msinfo.txt');
  const r = await analyzeFile(file, 'boundary');
  assert.equal(r.processes[0].name, 'example.exe');
  assert.equal(r.processes[0].evidence.locator, 'Line 140002');
  assert.match(r.findings[0].evidence[0].excerpt, /at frame/);
});
test('structured reports larger than 10 MiB work, while declared budgets reject before reading', async () => {
  const file = new File(['<MsInfo><!--', 'x'.repeat(11 * 1024 * 1024), '--><Category name="System"><Data><Item>Processor</Item><Value>Large XML CPU</Value></Data></Category></MsInfo>'], 'system.nfo');
  assert.equal((await analyzeFile(file, 'xml')).records[0].value, 'Large XML CPU');
  const page = await readSourcePage(file, 0, 'Large XML CPU');
  assert.equal(page.rows[0].line, 1); assert.ok(page.rows[0].text.length < 8100);
  assert.throws(() => validateFile({ name: 'CBS.log', size: MAX_FILE_BYTES + 1 }), /1 GiB/);
  const huge = { name: 'large.xml', size: MAX_STRUCTURED_BYTES + 1, slice: () => new Blob(['<xml/>']), arrayBuffer: () => { throw new Error('must not allocate'); } };
  await assert.rejects(analyzeFile(huge, 'huge'), /128 MiB/);
});
test('text viewer handles dense short lines and UTF-8 prefix boundaries', async () => {
  const file = new File(['\n'.repeat(180000), 'x'.repeat(4095), '😀\nERROR final issue'], 'app.log');
  assert.equal((await analyzeFile(file, 'dense')).findings[0].evidence[0].locator, 'Line 180002');
  const prefix = new File(['x'.repeat(4095), '😀\nMemory: 8 GB'], 'dxdiag.txt');
  assert.equal((await analyzeFile(prefix, 'prefix')).records[0].value, '8 GB');
});
test('collected snapshots use the same inventory and process-path findings', async () => {
  const data = { schema: 'stackscope.snapshot.v1', collectedAt: '2026-09-14T12:00:00Z', records: [{kind:'hardware', category:'Processor', label:'Processor', value:'Collected CPU'}], processes: [{name:'lsass.exe', path:'C:\\Users\\Example\\lsass.exe', pid:'99', memoryMB:20}], warnings: ['Protected logs unavailable.'] };
  const r = await analyzeFile(new File([JSON.stringify(data)], 'computer-snapshot.json'), 'snapshot');
  assert.equal(r.records[0].value, 'Collected CPU'); assert.equal(r.processes[0].pid, '99');
  assert.equal(r.findings[0].code, 'unexpected-system-path'); assert.deepEqual(r.warnings, data.warnings);
});
