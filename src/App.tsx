import { useMemo, useRef, useState } from 'react';
import { MAX_CASE_BYTES, MAX_FILE_BYTES, MAX_FILES, redactReport } from './engine.mjs';
import { importFile } from './import';
import { samples } from './samples';
import { api } from './api';
import ServicePanel, { type Session } from './ServicePanel';
import type { Source, Evidence, Finding } from './types';

type View='overview'|'hardware'|'software'|'findings'|'logs'|'community'|'account';
const views: [View,string,string][]=[['overview','Overview','◫'],['hardware','Hardware','▦'],['software','Software & processes','▤'],['findings','Findings','◇'],['logs','Source logs','≡'],['community','Community','◎'],['account','Account & plans','⊞']];
function EvidenceLink({evidence,onOpen}:{evidence:Evidence;onOpen:(e:Evidence)=>void}) {
  return <button className="source-link" title={evidence.excerpt} onClick={()=>onOpen(evidence)}>{evidence.source} <span>· {evidence.locator}</span></button>;
}
function FindingCard({finding,onOpen}:{finding:Finding;onOpen:(e:Evidence)=>void}) {
  return <article className="finding-card"><div className={'severity-mark '+finding.severity} aria-hidden="true">!</div><div className="finding-body">
    <div className="entry-heading"><h3>{finding.title}</h3><span className={'pill '+finding.severity}>{finding.severity}</span></div>
    <p>{finding.explanation}</p><div className="next-step"><strong>Next check</strong><span>{finding.nextStep}</span></div>
    <div className="finding-meta"><span>{finding.confidence} confidence in the evidence</span><span>{finding.occurrences} occurrence{finding.occurrences===1?'':'s'}</span></div>
    <details><summary>Source evidence</summary>{finding.evidence.map((e,i)=><div className="evidence-block" key={i}><EvidenceLink evidence={e} onOpen={onOpen}/><pre>{e.excerpt}</pre></div>)}</details>
  </div></article>;
}
export default function App() {
  const [view,setView]=useState<View>('overview'),[sources,setSources]=useState<Source[]>([]),[sourceId,setSourceId]=useState('all');
  const [query,setQuery]=useState(''),[severity,setSeverity]=useState('all'),[busy,setBusy]=useState(false),[errors,setErrors]=useState<string[]>([]);
  const [theme,setTheme]=useState('dark'),[isDemo,setIsDemo]=useState(false),[session,setSession]=useState<Session|null>(null);
  const [exportOpen,setExportOpen]=useState(false),[redact,setRedact]=useState(true),[title,setTitle]=useState('Diagnostic case'),[exportStatus,setExportStatus]=useState('');
  const [logStart,setLogStart]=useState(0),[focusLine,setFocusLine]=useState(0),[logQuery,setLogQuery]=useState('');
  const [rowLimit,setRowLimit]=useState(200);
  const input=useRef<HTMLInputElement>(null),inFlight=useRef(false);
  const selected=sources.filter(s=>sourceId==='all'||s.id===sourceId);
  const matches=(value:unknown)=>JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
  const records=selected.flatMap(s=>s.report.records),processes=selected.flatMap(s=>s.report.processes),findings=selected.flatMap(s=>s.report.findings);
  const filteredFindings=findings.filter(f=>(severity==='all'||f.severity===severity)&&matches(f));
  const warnings=selected.flatMap(s=>s.report.warnings.map(w=>s.name+': '+w));
  const visibleRecords=records.filter(r=>(view==='hardware'?r.kind!=='software':r.kind==='software')&&matches(r));
  const visibleProcesses=processes.filter(matches);
  const report=useMemo(()=>({schemaVersion:1,application:'StackScope',caseTitle:title,syntheticDemo:isDemo,exportedAt:new Date().toISOString(),redaction:redact?'Common identifiers removed; manual review still required.':'Identifiers retained by user choice.',sources:sources.map(s=>s.report)}),[sources,title,isDemo,redact]);
  const exportText=JSON.stringify(redact?redactReport(report):report,null,2);
  const currentLog=sources.find(s=>s.id===sourceId)??sources[0];
  const logLines=(currentLog?.text.split(/\r?\n/)??[]).map((text,index)=>({text,line:index+1})).filter(l=>!logQuery||l.text.toLowerCase().includes(logQuery.toLowerCase()));
  function navigate(next:View){setView(next);setQuery('');setRowLimit(200);}
  async function importFiles(files: File[], demo=false) {
    if(inFlight.current)return;
    if(!files.length)return;
    const base=demo?[]:sources;
    if(base.length+files.length>MAX_FILES){setErrors(['A case can contain at most 12 files. Clear the case or select fewer files.']);return;}
    if(files.some(f=>f.size>MAX_FILE_BYTES)){setErrors(['Each file must be 10 MiB or smaller. Export a smaller time range.']);return;}
    if(base.reduce((sum,s)=>sum+s.bytes,0)+files.reduce((sum,f)=>sum+f.size,0)>MAX_CASE_BYTES){setErrors(['The case exceeds the 40 MiB import limit.']);return;}
    inFlight.current=true;setBusy(true);setErrors([]);
    const added:Source[]=[],failures:string[]=[];
    for(const file of files){try{added.push(await importFile(file));}catch(error){failures.push(error instanceof Error?error.message:'Import failed.');}}
    setSources([...base,...added]);setErrors(failures);setIsDemo(demo||(isDemo&&base.length>0));setSourceId('all');setLogStart(0);
    setBusy(false);inFlight.current=false;setView('overview');
  }
  function openEvidence(e:Evidence) {
    setSourceId(e.sourceId);setView('logs');setLogQuery('');
    const line=Number(e.locator.match(/^Line (\d+)/)?.[1]??0);setFocusLine(line);setLogStart(line?Math.floor((line-1)/500)*500:0);
  }
  function downloadReport() {
    const url=URL.createObjectURL(new Blob([exportText],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='stackscope-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const heading=views.find(v=>v[0]===view)![1];
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <aside className="sidebar"><a href="#" className="brand" onClick={e=>{e.preventDefault();navigate('overview');}}><span className="brand-mark">S</span><span>Stack<span className="brand-light">Scope</span><small>DIAGNOSTIC WORKSPACE</small></span></a>
      <p className="nav-label">WORKSPACE</p><nav aria-label="Workspace">{views.map(([key,label,icon])=><button className={'nav-item '+(view===key?'active':'')} key={key} aria-current={view===key?'page':undefined} onClick={()=>navigate(key)}><span aria-hidden="true">{icon}</span>{label}{key==='findings'&&findings.length>0&&<b>{findings.length}</b>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-status"><span className="status-dot"/>Analysis stays local</div><p>Files stay in this session until you export or explicitly save a hosted report.</p><div className="sidebar-version"><span>v0.1 · Early preview</span><button aria-label="Toggle color theme" onClick={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);document.documentElement.dataset.theme=next;}}>{theme==='dark'?'Light':'Dark'}</button></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{heading}</strong></div><div className="button-row"><span className="platform-label">{window.stackscope?'Desktop':'Web'} · {session?.user.pro?'Pro':'Personal'}</span><button onClick={()=>navigate('account')}>{session?.user.username??'Sign in'}</button></div></header>
      <main id="main">
        {!['community','account'].includes(view)&&<><div className="page-heading"><div><p className="eyebrow">FOLLOW THE EVIDENCE</p><h1>{view==='overview'?'Diagnostic overview':heading}</h1><p>{view==='overview'?'Bring your reports together. Find the details that deserve a closer look.':'Inspect the information extracted from your imported reports.'}</p></div><div className="button-row"><button disabled={!sources.length||busy} onClick={()=>{setExportOpen(true);setExportStatus('');}}>Export report</button><button className="primary" disabled={busy} onClick={()=>input.current?.click()}><span aria-hidden="true">＋</span> Import files</button></div></div>
        <input className="visually-hidden" ref={input} type="file" multiple accept=".txt,.log,.nfo,.xml,.spx,.wer,.csv,.ips,.crash,.stacktrace" onChange={e=>{void importFiles(Array.from(e.target.files??[]));e.target.value='';}} aria-label="Diagnostic files" />
        {errors.length>0&&<div className="notice" role="alert">{errors.map((e,i)=><p key={i}>{e}</p>)}<button onClick={()=>setErrors([])}>Dismiss</button></div>}
        {busy&&<p className="notice neutral" role="status">Reading and analyzing files on your device…</p>}
        {isDemo&&<p className="demo-banner">SAMPLE CASE · Synthetic reports, not measurements from your computer.<button disabled={busy} onClick={()=>{setSources([]);setIsDemo(false);setSourceId('all');}}>Clear sample</button></p>}
        {sources.length>0&&<div className="toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search findings, components, or processes…" value={query} onChange={e=>{setQuery(e.target.value);setRowLimit(200);}} aria-label="Search workspace" /></label><label className="source-filter"><span>Source</span><select aria-label="Filter by source" value={sourceId} onChange={e=>{setSourceId(e.target.value);setLogStart(0);setRowLimit(200);}}><option value="all">All reports ({sources.length})</option>{sources.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label></div>}
        </>}
        {view==='overview'&&<>
          <section className={'import-zone '+(sources.length?'compact':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void importFiles(Array.from(e.dataTransfer.files));}}>
            <div className="import-icon" aria-hidden="true">↥</div><div><h2>{sources.length?'Add another report':'Start with a diagnostic report'}</h2><p>Drop MSINFO, DXDIAG, SPX, CBS, WER, event XML, performance CSV, or text logs here.</p><p className="muted">Up to 12 files · 10 MiB per file · Parsed locally</p></div><button disabled={busy} onClick={()=>input.current?.click()}>Browse files</button>
          </section>
          {!sources.length?<section className="empty-start"><div><p className="eyebrow">NO REPORTS IMPORTED</p><h2>Your investigation starts here.</h2><p>Import reports to inspect hardware, identify software, and explore errors with their original context.</p><button className="primary" disabled={busy} onClick={()=>void importFiles(samples.map(s=>new File([s.text],s.name,{type:'text/plain'})),true)}>Open sample case</button></div><div className="capability-list"><div><span>01</span><div><h3>Know what’s in the system</h3><p>Hardware and software details, traced to their source.</p></div></div><div><span>02</span><div><h3>Understand what happened</h3><p>Grouped findings with evidence and next checks.</p></div></div><div><span>03</span><div><h3>Keep control of your data</h3><p>Review a report before exporting or sharing it.</p></div></div></div></section>:<>
          <div className="stats-grid">{[['Imported reports',sources.length,'Files in this case'],['Inventory fields',records.length,'Hardware, software & system'],['Processes',processes.length,'Reported by your sources'],['Findings',findings.length,'Evidence to review']].map(([label,value,note])=><div className="stat-card" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
          <div className="overview-grid"><section><div className="section-heading"><h2>Findings to review</h2><button className="text-button" onClick={()=>navigate('findings')}>View all findings →</button></div>{filteredFindings.slice(0,3).map(f=><FindingCard key={f.id} finding={f} onOpen={openEvidence}/>)}{!filteredFindings.length&&<div className="panel"><h3>No matching findings</h3><p>That does not establish that the system is healthy. Coverage depends on the reports and supported patterns.</p></div>}</section>
          <aside className="panel source-list"><h2>Case files</h2>{sources.map(s=><div className="source-item" key={s.id}><button onClick={()=>{setSourceId(s.id);setView('logs');setLogStart(0);}}><strong>{s.name}</strong><small>{s.report.format} · {s.report.lineCount.toLocaleString()} lines</small></button><button className="icon-button" disabled={busy} aria-label={'Remove '+s.name} onClick={()=>{setSources(sources.filter(x=>x.id!==s.id));if(sourceId===s.id)setSourceId('all');}}>×</button></div>)}<p className="muted">Reports may describe different machines or capture times. Use the source filter before drawing conclusions.</p></aside></div>
          {warnings.length>0&&<section className="panel"><h3>Import coverage</h3>{warnings.map((w,i)=><p className="muted" key={i}>{w}</p>)}</section>}
          <button className="text-button" disabled={busy} onClick={()=>{if(window.confirm('Clear this case from the current session?')){setSources([]);setIsDemo(false);setSourceId('all');}}}>Clear current case</button>
          </>}
        </>}
        {(view==='hardware'||view==='software')&&<>
          {view==='software'&&<><div className="section-heading"><h2>Applications & processes</h2><span className="muted">{visibleProcesses.length} entries</span></div><p className="notice neutral">Signatures, reputation, and current activity are unknown unless supplied by a supported report. Measurements are historical samples, not live monitoring.</p>
          <div className="table-wrap"><table><thead><tr><th>Name / path</th><th>Publisher / version</th><th>CPU sample</th><th>Memory</th><th>Source</th></tr></thead><tbody>{visibleProcesses.slice(0,rowLimit).map((p,i)=><tr key={i}><td><strong>{p.name}</strong><small className="mono">{p.path||'Path not reported'}{p.pid?' · PID '+p.pid:''}</small></td><td>{p.publisher||'Unknown'}<small>{p.version||'Version not reported'}</small></td><td>{p.cpuPercent!==undefined?p.cpuPercent+'%':'Not measured'}<small>{p.sampleSeconds?p.sampleSeconds+' second sample':''}</small></td><td>{p.memoryMB!==null&&p.memoryMB!==undefined?p.memoryMB+' MB':'Not measured'}</td><td><EvidenceLink evidence={p.evidence} onOpen={openEvidence}/></td></tr>)}</tbody></table>{!visibleProcesses.length&&<div className="empty small"><p>No matching processes were extracted. MSINFO running tasks, SPX applications, WER, or performance CSV can provide these fields.</p></div>}</div></>}
          <div className="section-heading"><h2>{view==='hardware'?'Hardware & system inventory':'Software inventory fields'}</h2><span className="muted">{visibleRecords.length} fields</span></div>
          <div className="table-wrap"><table><thead><tr><th>Component / field</th><th>Reported value</th><th>Category</th><th>Source</th></tr></thead><tbody>{visibleRecords.slice(0,rowLimit).map((r,i)=><tr key={i}><td><strong>{r.label}</strong></td><td>{r.value}</td><td><span className="muted">{r.category}</span></td><td><EvidenceLink evidence={r.evidence} onOpen={openEvidence}/></td></tr>)}</tbody></table>{!visibleRecords.length&&<div className="empty small"><p>No matching inventory fields. Import MSINFO, DXDIAG, or SPX to populate this view.</p></div>}</div>
          {(visibleRecords.length>rowLimit||visibleProcesses.length>rowLimit)&&<button onClick={()=>setRowLimit(rowLimit+200)}>Show 200 more entries</button>}
        </>}
        {view==='findings'&&<><div className="section-heading"><h2>{filteredFindings.length} finding groups</h2><label>Severity <select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">All severities</option>{['high','medium','low','info'].map(s=><option key={s}>{s}</option>)}</select></label></div><p className="notice neutral">Confidence describes how clearly the source supports the recorded observation. It does not establish a root cause or current fault.</p>{filteredFindings.slice(0,rowLimit).map(f=><FindingCard key={f.id} finding={f} onOpen={openEvidence}/>)}{!filteredFindings.length&&<div className="empty"><h3>No matching findings</h3><p>Import reports or adjust your filters. An empty result is not a clean bill of health.</p></div>}{filteredFindings.length>rowLimit&&<button onClick={()=>setRowLimit(rowLimit+200)}>Show more findings</button>}</>}
        {view==='logs'&&<><div className="section-heading"><div><h2>{currentLog?.name??'Source viewer'}</h2><p className="muted">Original content · XML evidence uses element paths; text evidence uses line numbers.</p></div><input type="search" aria-label="Search source lines" placeholder="Filter source lines…" value={logQuery} onChange={e=>{setLogQuery(e.target.value);setLogStart(0);}} /></div>
          <div className="log-view" role="region" aria-label="Source log lines" tabIndex={0}>{logLines.slice(logStart,logStart+500).map(l=><div className={'log-line '+(l.line===focusLine?'highlight':'')} key={l.line}><span>{l.line}</span><code>{l.text||' '}</code></div>)}{!logLines.length&&<p>No source lines to display.</p>}</div>
          <div className="pagination"><button disabled={logStart===0} onClick={()=>setLogStart(Math.max(0,logStart-500))}>Previous</button><span>{logLines.length?logStart+1:0}–{Math.min(logStart+500,logLines.length)} of {logLines.length.toLocaleString()} matching lines</span><button disabled={logStart+500>=logLines.length} onClick={()=>setLogStart(logStart+500)}>Next</button></div></>}
        {(view==='community'||view==='account')&&<ServicePanel mode={view} session={session} onSession={setSession}/>}
        <footer className="workspace-footer"><span>StackScope · Follow the evidence.</span><span>Local analysis · No automatic uploads</span></footer>
      </main>
    </div>
    {exportOpen&&<div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="export-heading" className="export-dialog" onKeyDown={e=>{if(e.key==='Escape')setExportOpen(false);}}>
      <div className="section-heading"><h2 id="export-heading">Review your report</h2><button aria-label="Close export" onClick={()=>setExportOpen(false)}>×</button></div>
      <label>Case title<input autoFocus maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="checkbox-label"><input type="checkbox" checked={redact} onChange={e=>setRedact(e.target.checked)}/>Remove common identifiers</label>
      <p className="muted">Redaction is best effort. Review filenames, paths, identifiers, and evidence before sharing. Original full logs are not included.</p>
      <textarea className="export-preview" readOnly value={exportText} aria-label="Report export preview" />
      {exportStatus&&<p role="status" className="notice">{exportStatus}</p>}
      <div className="button-row"><button className="primary" onClick={downloadReport}>Download JSON</button><button disabled={!session?.user.pro||busy} onClick={async()=>{setBusy(true);try{await api('/api/cases',{method:'POST',token:session!.token,body:{title,report:JSON.parse(exportText)}});setExportStatus('Report saved to your hosted account.');}catch(error){setExportStatus(error instanceof Error?error.message:'Save failed.');}finally{setBusy(false);}}}>Save hosted case (Pro)</button><button onClick={()=>setExportOpen(false)}>Close</button></div>
    </section></div>}
  </div>;
}
