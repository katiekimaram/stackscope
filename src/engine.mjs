import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { MAX_FILE_BYTES, MAX_STRUCTURED_BYTES } from '../shared/limits.mjs';
export { MAX_FILE_BYTES, MAX_CASE_BYTES, MAX_FILES } from '../shared/limits.mjs';
const MAX_RECORDS = 12000;
const hardwareKeys = /^(processor|cpu|memory|installed physical memory.*|total physical memory|available physical memory|bios.*|baseboard.*|system manufacturer|system model|card name|chip type|display memory.*|dedicated memory|driver version|driver date.*|disk.*|model|capacity|size|resolution|manufacturer|serial number|hardware uuid)$/i;
const systemKeys = /^(os name|os version|operating system|version|system type|directx version|machine name|system name|windows dir|page file|time of this report|kernel version|boot volume)$/i;
const text = value => String(value ?? '').trim();
const tag = node => Object.keys(node ?? {}).find(k => k !== ':@' && k !== '#text' && !k.startsWith('?') && !k.startsWith('!'));
const kids = node => node?.[tag(node)] ?? [];
const scalar = nodes => (nodes ?? []).map(n => '#text' in n ? String(n['#text']) : scalar(kids(n))).join('').trim();
const is = (node, name) => tag(node)?.split(':').pop().toLowerCase() === name.toLowerCase();
const direct = (node, name) => kids(node).find(n => is(n, name));
const get = (node, name) => scalar(kids(direct(node, name)));
const attrs = node => node?.[':@'] ?? {};
function descendants(nodes, name, out = []) {
  for (const n of nodes ?? []) { if (is(n, name)) out.push(n); descendants(kids(n), name, out); }
  return out;
}
export function decodeDiagnostic(buffer) {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (b.byteLength > MAX_FILE_BYTES) throw new Error('File exceeds the 1 GiB import limit.');
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(b.subarray(2));
  if (b.length > 8 && b[1] === 0 && b[3] === 0) return new TextDecoder('utf-16le', { fatal: true }).decode(b);
  const s = new TextDecoder('utf-8', { fatal: true }).decode(b);
  if (s.includes('\0')) throw new Error('Binary input is unsupported. Export this report as text or XML.');
  return s.replace(/^\uFEFF/, '');
}
export function parseDiagnostic(input) {
  const name = text(input.name).slice(0, 240) || 'Untitled report', id = text(input.id) || name;
  let content = String(input.text ?? '').replace(/^\uFEFF/, '');
  if (!content) throw new Error('The file is empty.');
  if (content.length > MAX_FILE_BYTES || new TextEncoder().encode(content).length > MAX_FILE_BYTES) throw new Error('File exceeds the 1 GiB import limit.');
  if (/\0/.test(content) || /\.(evtx|etl|dmp|mdmp|zip|cab)$/i.test(name) || content.startsWith('bplist')) throw new Error('Binary reports are not yet supported. Export EVTX to XML, traces to text/CSV, or use debugger text output.');
  let lines = content.split(/\r?\n/);
  let lineOffset = 0, processCount = lines.length;
  let section = 'System summary';
  const result = { id, name, format: 'Text log', records: [], processes: [], findings: [], warnings: [], lineCount: input._stream ? 0 : lines.length };
  const recordKeys = new Set(), processKeys = new Set(), findingKeys = new Map();
  const evidence = (locator, excerpt) => ({ sourceId: id, source: name, locator: locator.replace(/^Line (\d+)/, (_, n) => 'Line ' + (Number(n) + lineOffset)), excerpt: text(excerpt).slice(0, 1400) });
  function record(kind, category, label, value, locator) {
    value = text(value);
    if (!value || result.records.length >= MAX_RECORDS) return;
    const key = [kind, category, label, value].join('\u001f');
    if (recordKeys.has(key)) return;
    recordKeys.add(key);
    result.records.push({ kind, category, label, value, evidence: evidence(locator, label + ': ' + value) });
  }
  function finding(code, title, severity, confidence, explanation, nextStep, locator, excerpt, group = code) {
    const existing = findingKeys.get(group);
    if (existing) { existing.occurrences++; if (existing.evidence.length < 6) existing.evidence.push(evidence(locator, excerpt)); return; }
    if (result.findings.length >= 500) return;
    const item = { id: id + ':' + result.findings.length, code, title, severity, confidence, explanation, nextStep, occurrences: 1, evidence: [evidence(locator, excerpt)] };
    findingKeys.set(group, item); result.findings.push(item);
  }
  function process(nameValue, path = '', publisher = '', version = '', locator = '', extra = {}) {
    const n = text(nameValue).slice(0, 200), key = [n, path, version, extra.pid ?? '', extra.measuredAt ?? '', extra.cpuPercent ?? '', extra.sampleSeconds ?? ''].join('|');
    if (!n || result.processes.length >= MAX_RECORDS || processKeys.has(key)) return;
    processKeys.add(key);
    result.processes.push({ name: n, path: text(path), publisher: text(publisher), version: text(version), ...extra, evidence: evidence(locator, key) });
    if (/^(svchost|lsass|services|winlogon|csrss)\.exe$/i.test(n) && /^[a-z]:\\/i.test(path) && !/^[a-z]:\\windows\\(system32|syswow64)\\/i.test(path)) {
      finding('unexpected-system-path', 'System-like process in an unexpected location', 'medium', 'medium',
        'The name resembles a Windows system process, but the reported path is outside the usual Windows system directories. This is an investigation lead, not a malware verdict.',
        'Verify the actual executable, signature, publisher, and hash. Account for a nonstandard Windows installation.',
        locator, n + ' — ' + path, 'path:' + path.toLowerCase());
    }
  }
  function classify(label, section) {
    if (hardwareKeys.test(label) || /hardware|display|sound device|storage|disk|processor|memory|baseboard|bios/i.test(section)) return 'hardware';
    if (systemKeys.test(label)) return 'system';
    return /software|application|program|running task|process|startup|service/i.test(section) ? 'software' : 'system';
  }
  function textInventory() {
    lines.forEach((raw, i) => {
      if (i >= processCount) return;
      const line = raw.trim();
      if (/^\[[^\]]+\]$/.test(line)) { section = line.slice(1, -1); return; }
      if (/^(System Information|Display Devices|Sound Devices|Disk & DVD\/CD-ROM Drives|System Devices|Running Tasks|Startup Programs|Services)$/i.test(line)) { section = line; return; }
      if (/^[-=]{3,}$/.test(line) || !line) return;
      const m = line.match(/^([^:\t]{2,100}?)\s*:\s+(.+)$/) ?? line.match(/^([^\t]+)\t+(.+)$/) ?? line.match(/^(.{2,80}?) {2,}(\S.*)$/);
      if (!m) return;
      const label = m[1].trim(), value = m[2].trim();
      if (/^item$/i.test(label) && /^value/i.test(value)) return;
      if (hardwareKeys.test(label) || systemKeys.test(label) || /software|application|running task|process|startup|service/i.test(section)) {
        record(classify(label, section), section, label, value, 'Line ' + (i + 1));
        if (/\.exe$/i.test(label)) process(label, value.match(/[a-z]:\\.*?\.exe/i)?.[0] ?? '', '', '', 'Line ' + (i + 1));
      }
    });
  }
  function consumeText(chunk, offset = 0, count) {
    content = chunk;
    lines = chunk.split(/\r?\n/);
    lineOffset = offset;
    processCount = count ?? lines.length;
    result.lineCount = Math.max(result.lineCount, offset + processCount);
    if (/dxdiag/i.test(name) || /DirectX Version:/.test(content)) result.format = 'DXDIAG text';
    else if (/msinfo|\.nfo$/i.test(name) || /OS Name\t|System Manufacturer\t/.test(content)) result.format = 'MSINFO text';
    else if (/\.wer$/i.test(name) || /^EventType=APPCRASH/m.test(content)) result.format = 'Windows Error Reporting';
    else if (/CBS|CSI.*\[SR\]/i.test(content) || /cbs|dism/i.test(name)) result.format = /dism/i.test(name) ? 'DISM log' : 'CBS log';
    if (['MSINFO text','DXDIAG text'].includes(result.format)) textInventory();
    if (result.format === 'Windows Error Reporting') {
      const values = Object.fromEntries(lines.map(l => { const k = l.indexOf('='); return k > 0 ? [l.slice(0,k),l.slice(k+1)] : []; }).filter(v => v.length));
      if (values.AppName || values.AppPath) process(values.AppName ?? values.AppPath.split('\\').at(-1),values.AppPath ?? '','','','WER AppName / AppPath');
      finding('wer-report','Windows error report: ' + (values.EventType ?? 'unclassified'),'medium','high',
        'This is a recorded incident. Faulting modules and exception information are clues, not a confirmed cause.',
        'Compare the report timestamp, application version, exception code, and matching events.','WER fields',
        lines.filter(l => /^(EventType|AppName|AppPath|Sig\[\d+\]\.(Name|Value))=/.test(l)).join('\n'));
    }
    lines.forEach((line,i) => {
      if (i >= processCount) return;
      const loc = 'Line ' + (i + 1);
      if (/\[SR\].*Cannot repair member file/i.test(line)) finding('cbs-corruption','System-file corruption reported','medium','high',
        'An SFC entry reports a file that could not be repaired at that point. Later repair activity may have resolved it.',
        'Check this scan’s completion and later scans before treating the corruption as current.',loc,line);
      else if (/HRESULT.*0x800f081f|error\s*:\s*0x800f081f|CBS_E_SOURCE_MISSING/i.test(line)) finding('repair-source-missing','Repair source was unavailable','medium','high',
        'A servicing operation reports missing repair source files. This is historical evidence, not current system health.',
        'Check the operation timestamp, completion status, Windows build, and configured repair source.',loc,line);
      else if (/Unhandled (?:exception|rejection)|Traceback \(most recent call last\)|FATAL EXCEPTION|^Caused by:\s+\S+|^panic:/i.test(line)) finding('stacktrace','Exception or stack trace recorded','medium','high',
        'Stack frames show the execution path and may require symbols or source maps for useful attribution.',
        'Inspect the exception message and first relevant application frame; compare matching incidents.',loc,
        lines.slice(Math.max(0,i-1),i+12).join('\n'),'stack:' + line.trim().slice(0,160));
      else if (/\b(error|failed|failure|fatal)\b/i.test(line) && !/\b(no errors?|0 errors?|errors?\s*[:=]\s*0|failed\s*[:=]\s*0|failure\s*[:=]\s*0|success(?:ful(?:ly)?)?)\b/i.test(line) &&
        !/\[SR\]|^Sig\[\d+\]\.Name=|^EventType=/i.test(line) && (/\b0x[89a-f][0-9a-f]{7}\b/i.test(line) || /\bERROR\b.*\S/i.test(line))) finding('log-error','Error entry requires context','low','medium',
        'A single error line does not establish severity or a current fault.','Review nearby entries, the timestamp, and whether a later operation succeeded.',loc,line,
        'error:' + (line.match(/0x[89a-f][0-9a-f]{7}/i)?.[0] ?? line.replace(/\d+/g,'#').slice(0,140)));
    });

  }

  function finish() {
  if (result.records.length >= MAX_RECORDS || result.processes.length >= MAX_RECORDS) result.warnings.push('Inventory reached the 12,000-entry limit; import a smaller report for complete coverage.');
  if (result.findings.length >= 500) result.warnings.push('Finding groups reached the 500-group limit.');
  if (!result.records.length && !result.processes.length && !result.findings.length) result.warnings.push('No supported patterns found. This does not mean the machine is healthy or free of malware.');
  const order = { high:0,medium:1,low:2,info:3 };
  result.findings.sort((a,b) => order[a.severity] - order[b.severity]);
  return result;
  }
  if (input._stream) return { consume: consumeText, finish };
  if (content.trimStart().startsWith('<')) {
    if (new TextEncoder().encode(content).length > MAX_STRUCTURED_BYTES) throw new Error('Structured XML reports support up to 128 MiB. Text logs support up to 1 GiB.');
    const safe = content.replace(/<!DOCTYPE\s+plist\s+PUBLIC\s+"-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN"\s+"https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd"\s*>/i, '');
    if (/<!DOCTYPE|<!ENTITY/i.test(safe)) throw new Error('XML DTDs and entity declarations are unsupported.');
    let depth = 0, count = 0;
    for (const m of safe.matchAll(/<[^>]*>/g)) {
      if (/^<\//.test(m[0])) depth--;
      else if (!/^<[!?]/.test(m[0]) && !/\/>$/.test(m[0])) depth++;
      if (depth > 96 || ++count > 2000000) throw new Error('XML report exceeds parser complexity limits.');
    }
    if (XMLValidator.validate(safe) !== true) throw new Error('Malformed XML report.');
    const tree = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: true }).parse(safe);
    if (descendants(tree, 'MsInfo').length || descendants(tree, 'Category').length) {
      result.format = 'MSINFO XML';
      function categories(nodes, trail = []) {
        for (const node of nodes) {
          if (is(node, 'Category')) categories(kids(node), [...trail, text(attrs(node)['@_name'] ?? attrs(node)['@_Name'] ?? 'Category')]);
          else if (is(node, 'Data')) {
            const bag = Object.fromEntries(kids(node).filter(n => tag(n)).map(n => [tag(n), scalar(kids(n))]));
            const section = trail.join(' / ') || 'System summary', loc = section + ' / Data ' + (result.records.length + 1);
            if (bag.Item !== undefined && bag.Value !== undefined) record(classify(bag.Item, section), section, bag.Item, bag.Value, loc);
            else {
              const label = bag.Name ?? bag.Description ?? bag.Device ?? 'Entry';
              for (const [k,v] of Object.entries(bag)) record(classify(k, section), section, label + ' · ' + k, v, loc + ' / ' + k);
              if (/running task|process|startup|program|application|service/i.test(section)) process(label, bag.Path ?? bag.Command ?? '', bag.Manufacturer ?? bag.Publisher ?? '', bag.Version ?? '', loc, { pid: bag.ProcessID ?? '' });
            }
          } else categories(kids(node), trail);
        }
      }
      categories(tree);
    } else if (descendants(tree, 'DxDiag').length) {
      result.format = 'DXDIAG XML';
      function walk(nodes, trail = []) {
        for (const n of nodes) {
          const name = tag(n); if (!name) continue;
          const next = [...trail, name];
          if (kids(n).some(c => tag(c))) walk(kids(n), next);
          else {
            const label = name.replace(/([a-z])([A-Z])/g, '$1 $2');
            record(/SystemInformation/.test(next.join('/')) ? classify(label, 'System summary') : 'hardware', trail.at(-1) ?? 'DXDIAG', label, scalar(kids(n)), '/' + next.join('/'));
          }
        }
      }
      walk(tree);
    } else if (descendants(tree, 'plist').length) {
      result.format = 'SPX / plist';
      function plist(node) {
        if (is(node, 'dict')) {
          const out = Object.create(null), list = kids(node).filter(n => tag(n));
          for (let i = 0; i < list.length; i += 2) {
            if (!is(list[i], 'key') || !list[i + 1]) throw new Error('Invalid property-list dictionary.');
            out[scalar(kids(list[i]))] = plist(list[i + 1]);
          }
          return out;
        }
        if (is(node, 'array')) return kids(node).filter(n => tag(n)).map(plist);
        return scalar(kids(node));
      }
      function walk(value, section = 'System report', trail = 'plist') {
        if (Array.isArray(value)) { value.forEach((v,i) => walk(v, section, trail + '/' + i)); return; }
        if (value && typeof value === 'object') {
          const category = text(value._dataType) || section;
          if (/SPApplicationsDataType/.test(category) && value._name) process(value._name, value.path ?? '', value.obtained_from ?? '', value.version ?? '', trail);
          for (const [key,v] of Object.entries(value)) {
            if (v && typeof v === 'object') walk(v, category, trail + '/' + key);
            else if (!key.startsWith('_')) record(/Applications|Software|Startup/.test(category) ? 'software' : /Hardware|Memory|Storage|Displays|NVMe|SerialATA|Audio/.test(category) ? 'hardware' : 'system', category, key.replaceAll('_', ' '), v, trail + '/' + key);
          }
        }
      }
      walk(plist(kids(descendants(tree, 'plist')[0]).find(n => tag(n))));
    } else if (descendants(tree, 'Event').length) {
      result.format = 'Windows Event XML';
      const descriptions = {
        41: ['Unexpected restart recorded', 'Windows recorded an unclean restart. This event alone does not identify a power supply, driver, or hardware cause.'],
        1000: ['Application crash recorded', 'The event reports an application crash. A faulting module is not necessarily the root cause.'],
        1001: ['Error report recorded', 'An error-reporting event is present. Correlate its report ID and timestamp with surrounding events.'],
        4101: ['Display driver recovery recorded', 'The event reports a display driver timeout or recovery. It does not by itself prove defective graphics hardware.'],
        6008: ['Unexpected shutdown recorded', 'Windows reports that an earlier shutdown was unexpected. Check preceding events.'],
      };
      descendants(tree, 'Event').forEach((event,i) => {
        const system = direct(event,'System'), eventId = get(system,'EventID'), provider = text(attrs(direct(system,'Provider'))['@_Name']);
        const time = text(attrs(direct(system,'TimeCreated'))['@_SystemTime']), level = get(system,'Level');
        const message = get(direct(event,'RenderingInfo'),'Message') || scalar(kids(direct(event,'EventData')));
        const known = ((eventId === '41' && /Kernel-Power/i.test(provider)) || (eventId === '1000' && /Application Error/i.test(provider)) ||
          (eventId === '1001' && /Windows Error Reporting|WER-SystemErrorReporting/i.test(provider)) || (eventId === '4101' && /^Display$/i.test(provider)) ||
          (eventId === '6008' && /^EventLog$/i.test(provider))) ? descriptions[eventId] : undefined;
        if (known || ['1','2','3'].includes(level)) finding('windows-event', known?.[0] ?? 'Windows event requires review', level === '1' ? 'high' : 'medium', 'high',
          known?.[1] ?? 'The source marks this event as a warning or error. The provider and surrounding events determine its meaning.',
          'Review the provider, event data, timestamp, and nearby events on the same machine.', '/Events/Event[' + (i + 1) + ']',
          [time,provider,'Event ' + eventId,message].join(' · '), provider + ':' + eventId + ':' + message.slice(0,150));
      });
    } else result.warnings.push('Valid XML, but this schema is unsupported. No inventory or diagnosis was inferred.');
  } else if (/\.json$/i.test(name) && content.trimStart().startsWith('{')) {
    const snapshot = JSON.parse(content);
    if (snapshot.schema !== 'stackscope.snapshot.v1') throw new Error('Unsupported JSON. Import a StackScope computer snapshot or a text diagnostic report.');
    result.format = 'Computer snapshot';
    for (const [i, item] of (Array.isArray(snapshot.records) ? snapshot.records : []).entries()) {
      if (['hardware', 'software', 'system'].includes(item.kind)) record(item.kind, text(item.category), text(item.label), item.value, '/records/' + i);
    }
    for (const [i, item] of (Array.isArray(snapshot.processes) ? snapshot.processes : []).entries()) {
      process(item.name, item.path, item.publisher, item.version, '/processes/' + i, { pid: text(item.pid), memoryMB: Number.isFinite(item.memoryMB) ? item.memoryMB : null, measuredAt: text(snapshot.collectedAt) });
    }
    for (const warning of (Array.isArray(snapshot.warnings) ? snapshot.warnings : []).slice(0, 100)) result.warnings.push(text(warning).slice(0, 1000));
  } else if (/\.csv$/i.test(name)) {
    result.format = 'Performance CSV';
    const rows = parseCSV(content), headers = rows.shift()?.map(h => h.trim().toLowerCase()) ?? [];
    const index = key => headers.indexOf(key.toLowerCase());
    if (index('name') < 0 || index('cpuPercent') < 0 || index('sampleSeconds') < 0) throw new Error('Performance CSV requires name,cpuPercent,sampleSeconds; optional: pid,memoryMB,path,publisher,version,measuredAt.');
    rows.forEach((row,i) => {
      const field = k => row[index(k)] ?? '', c = field('cpuPercent'), s = field('sampleSeconds'), m = field('memoryMB');
      const cpu = Number(c), seconds = Number(s), memory = m === '' ? null : Number(m);
      if (!c.trim() || !s.trim() || !Number.isFinite(cpu) || cpu < 0 || cpu > 100 || !Number.isFinite(seconds) || seconds <= 0 || (memory !== null && (!Number.isFinite(memory) || memory < 0))) {
        result.warnings.push('CSV row ' + (i + 2) + ' has invalid measurements and was skipped.'); return;
      }
      process(field('name'),field('path'),field('publisher'),field('version'),'CSV row ' + (i + 2), { pid: field('pid'),cpuPercent: cpu,sampleSeconds: seconds,memoryMB: memory,measuredAt: field('measuredAt') });
      if (cpu >= 80 && seconds >= 30) finding('high-cpu','High CPU use measured: ' + field('name'),'medium','high',
        'The sample reports ' + cpu + '% CPU across ' + seconds + ' seconds. High utilization can be expected during demanding work and does not establish causation.',
        'Compare process use, workload, and responsiveness during the same interval.','CSV row ' + (i + 2),row.join(', '),'cpu:' + field('name') + ':' + field('pid'));
    });
  } else consumeText(content);

  return finish();

}
export function parseCSV(input) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i+1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\n' && !quoted) { row.push(value.replace(/\r$/,'')); if (row.some(x => x.trim())) rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(value.replace(/\r$/,'')); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
export function redactReport(value) {
  const sensitive = /serial|uuid|system name|machine name|host name|user name|username|computer name|mac address/i;
  if (typeof value === 'string') return value.replace(/([a-z]:\\Users\\)[^\\\s"']+/gi,'$1[USER]')
    .replace(/(\/Users\/|\/home\/)[^/\s"']+/g,'$1[USER]').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[IP]').replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi,'[MAC]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'[UUID]')
    .replace(/(serial(?: number)?|machine name|system name|host name|computer name)\s*[:=]\s*[^\r\n|·]+/gi,'$1: [REDACTED]');
  if (Array.isArray(value)) return value.map(redactReport);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = (sensitive.test(k) || (k === 'value' && sensitive.test(String(value.label ?? '')))) ? '[REDACTED]' : redactReport(v);
    return out;
  }
  return value;
}

export function createTextAnalysis(name, id) {
  return parseDiagnostic({ name, id, text: '[stream]', _stream: true });
}
