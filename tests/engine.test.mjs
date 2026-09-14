import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiagnostic as parse,decodeDiagnostic,redactReport,MAX_FILE_BYTES } from '../src/engine.mjs';
test('DXDIAG text extracts hardware with original line evidence',()=>{
 const r=parse({name:'DxDiag.txt',text:'System Information\nProcessor: Test CPU\nMemory: 32768MB RAM\nDirectX Version: DirectX 12\nDisplay Devices\nCard name: Example GPU'});
 assert.equal(r.format,'DXDIAG text');assert.equal(r.records.find(x=>x.label==='Processor').value,'Test CPU');
 assert.equal(r.records.find(x=>x.label==='Processor').evidence.locator,'Line 2');
});
test('MSINFO XML extracts repeated rows and process paths',()=>{
 const r=parse({name:'system.nfo',text:'<MsInfo><Category name="System Summary"><Data><Item>Processor</Item><Value>CPU A</Value></Data><Data><Item>Processor</Item><Value>CPU B</Value></Data></Category><Category name="Running Tasks"><Data><Name>svchost.exe</Name><Path>C:\\Users\\Example\\svchost.exe</Path><ProcessID>42</ProcessID></Data></Category></MsInfo>'});
 assert.equal(r.records.filter(x=>x.label==='Processor').length,2);assert.equal(r.processes[0].pid,'42');
 assert.equal(r.findings[0].code,'unexpected-system-path');assert.match(r.findings[0].explanation,/not a malware verdict/);
});
test('a system-like name alone and standard path do not imply malware',()=>{
 const r=parse({name:'tasks.nfo',text:'<MsInfo><Category name="Running Tasks"><Data><Name>svchost.exe</Name><Path>C:\\Windows\\System32\\svchost.exe</Path></Data><Data><Name>lsass.exe</Name></Data></Category></MsInfo>'});
 assert.equal(r.findings.length,0);
});
test('DXDIAG XML keeps separate adapters',()=>{
 const r=parse({name:'dx.xml',text:'<DxDiag><SystemInformation><OperatingSystem>Windows 11</OperatingSystem></SystemInformation><DisplayDevices><DisplayDevice><CardName>GPU A</CardName></DisplayDevice><DisplayDevice><CardName>GPU B</CardName></DisplayDevice></DisplayDevices></DxDiag>'});
 assert.equal(r.format,'DXDIAG XML');assert.equal(r.records.filter(x=>x.label==='Card Name').length,2);
});
test('SPX accepts standard Apple DOCTYPE without external resolution',()=>{
 const xml='<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array><dict><key>_dataType</key><string>SPHardwareDataType</string><key>_items</key><array><dict><key>chip_type</key><string>Apple M4</string><key>physical_memory</key><string>16 GB</string></dict></array></dict><dict><key>_dataType</key><string>SPApplicationsDataType</string><key>_items</key><array><dict><key>_name</key><string>Example App</string><key>version</key><string>1.2</string></dict></array></dict></array></plist>';
 const r=parse({name:'mac.spx',text:xml});assert.equal(r.records.find(x=>x.label==='chip type').value,'Apple M4');assert.equal(r.processes[0].name,'Example App');
});
test('entity payloads, excessive depth, malformed XML, binary files, oversized input rejected',()=>{
 for(const text of ['<!DOCTYPE x [<!ENTITY x "boom">]><x>&x;</x>','<x>'.repeat(100)+'</x>'.repeat(100),'<MsInfo><Data></MsInfo>'])assert.throws(()=>parse({name:'input.xml',text}));
 assert.throws(()=>parse({name:'events.evtx',text:'binary-looking content'}),/Binary/);
 assert.throws(()=>parse({name:'binary.spx',text:'bplist00test'}),/Binary/);
 assert.throws(()=>decodeDiagnostic(new Uint8Array(MAX_FILE_BYTES+1)),/10 MiB/);
});
test('CBS errors remain historical even when repair follows',()=>{
 const r=parse({name:'CBS.log',text:'2026-09-14 Info CSI [SR] Cannot repair member file foo.dll\n2026-09-14 Info CSI [SR] Repairing corrupted file foo.dll from store\n2026-09-14 Info CSI [SR] Repair complete'});
 assert.equal(r.findings.length,1);assert.match(r.findings[0].explanation,/Later repair activity may have resolved/);
});
test('generic success and zero error counters do not become errors',()=>{
 const r=parse({name:'app.log',text:'INFO No errors found\nERROR count: 0 errors\nERROR operation completed successfully\nErrors: 0'});
 assert.equal(r.findings.length,0);assert.ok(r.warnings.length);
});
test('performance requires valid duration and CPU fields',()=>{
 const r=parse({name:'perf.csv',text:'name,cpuPercent,sampleSeconds,memoryMB\nbuild.exe,95,60,2048\nburst.exe,99,1,100\nmissing.exe,,60,20\nbad.exe,101,60,20'});
 assert.equal(r.processes.length,2);assert.equal(r.findings.length,1);assert.equal(r.findings[0].code,'high-cpu');assert.equal(r.warnings.length,2);
});
test('WER parses application and exception evidence',()=>{
 const r=parse({name:'Report.wer',text:'Version=1\nEventType=APPCRASH\nAppName=example.exe\nAppPath=C:\\Program Files\\Example\\example.exe\nSig[6].Name=Exception Code\nSig[6].Value=c0000005'});
 assert.equal(r.processes[0].name,'example.exe');assert.match(r.findings[0].evidence[0].excerpt,/c0000005/);
});
test('event IDs are interpreted in provider context',()=>{
 const event=provider=>'<Events><Event><System><Provider Name="'+provider+'"/><EventID>41</EventID><Level>1</Level><TimeCreated SystemTime="2026-09-14T10:00:00Z"/></System><EventData><Data Name="Code">0</Data></EventData></Event></Events>';
 assert.match(parse({name:'events.xml',text:event('Microsoft-Windows-Kernel-Power')}).findings[0].title,/Unexpected restart/);
 assert.equal(parse({name:'events.xml',text:event('Other Provider')}).findings[0].title,'Windows event requires review');
});
test('UTF-16 Windows reports are decoded without losing text',()=>{
 const expected='Memory: 16 GB',bytes=Buffer.from(expected,'utf16le');
 assert.equal(decodeDiagnostic(Buffer.concat([Buffer.from([255,254]),bytes])),expected);
 assert.equal(decodeDiagnostic(bytes),expected);
});
test('redaction covers nested values, paths, emails, UUIDs, and serial fields',()=>{
 const input={records:[{label:'Serial Number',value:'PRIVATE123',evidence:{excerpt:'Serial Number: PRIVATE123'}}],text:'C:\\Users\\Katie\\a.log katie@example.com 192.168.1.1 12345678-1234-1234-1234-123456789abc'};
 const s=JSON.stringify(redactReport(input));
 for(const secret of ['PRIVATE123','Katie','katie@example.com','192.168.1.1','12345678-1234'])assert.ok(!s.includes(secret));
 assert.equal(input.records[0].value,'PRIVATE123');
});
test('unknown XML is reported as unsupported instead of silently healthy',()=>{
 const r=parse({name:'unknown.xml',text:'<other><x>test</x></other>'});
 assert.equal(r.records.length,0);assert.ok(r.warnings.some(w=>/unsupported/.test(w)));
});
