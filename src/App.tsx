import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_CASE_BYTES, MAX_FILE_BYTES, MAX_FILES, redactReport } from './engine.mjs';
import { importFile } from './import';
import SourceViewer from './SourceViewer';
import DesktopControls from './DesktopControls';
import { samples } from './samples';
import { api, onSessionExpired } from './api';
import Dialog from './Dialog';
import Preferences from './Preferences';
import Icon, { type IconName } from './Icon';
import ServicePanel, { type Session } from './ServicePanel';
import type { Source, Evidence, Finding, CollectionOptions } from './types';

type View='overview'|'hardware'|'software'|'findings'|'logs'|'community';
const views: [Exclude<View,'community'>,string,IconName][]=[['overview','Overview','overview'],['hardware','Hardware','hardware'],['software','Software & processes','software'],['findings','Findings','findings'],['logs','Source logs','logs']];
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
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('stackscope.theme')==='light'?'light':'dark';}catch{return 'dark';}}),[isDemo,setIsDemo]=useState(false),[session,setSession]=useState<Session|null>(null);
  const [exportOpen,setExportOpen]=useState(false),[redact,setRedact]=useState(true),[title,setTitle]=useState('Diagnostic case'),[exportStatus,setExportStatus]=useState('');
  const [logStart,setLogStart]=useState(0),[focusLine,setFocusLine]=useState(0),[logQuery,setLogQuery]=useState('');
  const [rowLimit,setRowLimit]=useState(200),[progress,setProgress]=useState('');
  const operation=useRef<AbortController|null>(null);
  const [collectOpen,setCollectOpen]=useState(false),[preferencesOpen,setPreferencesOpen]=useState(false);
  const currentSession=useRef(session);currentSession.current=session;
  const commandRef=useRef<(command:string)=>void>(()=>{});
  useEffect(()=>onSessionExpired(token=>{if(currentSession.current?.token===token){setSession(null);setErrors(['Your session expired. Sign in again from Community & account. Your local case is unchanged.']);}}),[]);
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem('stackscope.theme',theme);}catch{}
    void window.stackscope?.setAppearance(theme).catch(()=>{});
  },[theme]);
  useEffect(()=>window.stackscope?.onDesktopEvent(event=>{
    if(event.type==='progress')setProgress(event.message??'Collecting diagnostics…');
    else commandRef.current(event.type);
  }),[]);
  useEffect(()=>{
    if(window.stackscope)return;
    const listener=(event:KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey))return;
      const key=event.key.toLowerCase();
      const command=key==='o'?'import':key==='e'&&event.shiftKey?'export':key===','?'preferences':null;
      if(command){event.preventDefault();commandRef.current(command);}
    };
    window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);
  },[]);
  const input=useRef<HTMLInputElement>(null),inFlight=useRef(false);
  const selected=useMemo(()=>sources.filter(s=>sourceId==='all'||s.id===sourceId),[sources,sourceId]);
  const matches=(value:unknown)=>!query||JSON.stringify(value).toLowerCase().includes(query.toLowerCase());
  const records=selected.flatMap(s=>s.report.records),processes=selected.flatMap(s=>s.report.processes),findings=selected.flatMap(s=>s.report.findings);
  const filteredFindings=findings.filter(f=>(severity==='all'||f.severity===severity)&&matches(f));
  const warnings=selected.flatMap(s=>s.report.warnings.map(w=>s.name+': '+w));
  const visibleRecords=records.filter(r=>(view==='hardware'?r.kind!=='software':r.kind==='software')&&matches(r));
  const visibleProcesses=processes.filter(matches);
  const report=useMemo(()=>({schemaVersion:1,application:'StackScope',caseTitle:title,syntheticDemo:isDemo,exportedAt:new Date().toISOString(),redaction:redact?'Common identifiers removed; manual review still required.':'Identifiers retained by user choice.',sources:sources.map(s=>s.report)}),[sources,title,isDemo,redact]);
  const exportText=useMemo(()=>exportOpen?JSON.stringify(redact?redactReport(report):report,null,2):'',[report,redact,exportOpen]);
  const currentLog=sources.find(s=>s.id===sourceId)??sources[0];
  function navigate(next:View){setView(next);setQuery('');setRowLimit(200);}
  async function importFiles(files: File[], demo=false, notices: string[]=[], controller=new AbortController()) {
    if(inFlight.current)return;
    if(!files.length)return;
    const base=demo?[]:sources;
    if(base.length+files.length>MAX_FILES){setErrors(['A case can contain at most 24 files. Clear the case or select fewer files.']);return;}
    if(files.some(f=>f.size>MAX_FILE_BYTES)){setErrors(['Each file must be 1 GiB or smaller.']);return;}
    if(base.reduce((sum,s)=>sum+s.bytes,0)+files.reduce((sum,f)=>sum+f.size,0)>MAX_CASE_BYTES){setErrors(['The case exceeds the 2 GiB import limit.']);return;}
    inFlight.current=true;operation.current=controller;setBusy(true);setErrors([]);
    const added:Source[]=[],failures:string[]=[...notices];
    for(const file of files){if(controller.signal.aborted)break;try{added.push(await importFile(file,controller.signal,percent=>setProgress(file.name+' · '+percent+'% read')));}catch(error){failures.push(error instanceof Error?error.message:'Import failed.');}}
    setSources([...base,...added]);setErrors(failures);setIsDemo(demo||(isDemo&&base.length>0));setSourceId('all');setLogStart(0);
    setBusy(false);operation.current=null;inFlight.current=false;setView('overview');
  }
  async function collectComputer(options: CollectionOptions) {
    if(inFlight.current||!window.stackscope)return;
    const controller=new AbortController();operation.current=controller;inFlight.current=true;setBusy(true);setErrors([]);setProgress('Starting collection…');
    try {
      const result=await window.stackscope.collect(options);
      const files:File[]=[];
      for(const item of result.files){
        setProgress('Preparing '+item.name+' for analysis…');
        const response=await fetch(item.url,{signal:controller.signal});
        if(!response.ok)throw new Error(item.name+': could not read collected report.');
        files.push(new File([await response.blob()],item.name));
      }
      inFlight.current=false;
      await importFiles(files,false,result.warnings,controller);
    } catch(error){setErrors([controller.signal.aborted?'Collection cancelled.':error instanceof Error?error.message:'Collection failed.']);}
    finally {await window.stackscope.releaseCollection().catch(()=>{});setBusy(false);operation.current=null;inFlight.current=false;}
  }
  function cancelOperation(){operation.current?.abort();void window.stackscope?.cancelCollection();}
  function openEvidence(e:Evidence) {
    setSourceId(e.sourceId);setView('logs');setLogQuery('');
    const line=Number(e.locator.match(/^Line (\d+)/)?.[1]??0);setFocusLine(line);setLogStart(line?Math.floor((line-1)/500)*500:0);
  }
  function downloadReport() {
    const url=URL.createObjectURL(new Blob([exportText],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='stackscope-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function clearCase() {
    if(busy)return;
    if(sources.length&&!window.confirm('Clear this case from the current session? Export any results you want to keep first.'))return;
    setSources([]);setIsDemo(false);setSourceId('all');setTitle('Diagnostic case');setErrors([]);setView('overview');
  }
  commandRef.current=command=>{
    if(document.querySelector('dialog[open]'))return;
    if(command==='import'&&!busy)input.current?.click();
    else if(command==='export'&&sources.length&&!busy){setExportOpen(true);setExportStatus('');}
    else if(command==='new-case')clearCase();
    else if(command==='open-collection'&&!busy)setCollectOpen(true);
    else if(command==='preferences')setPreferencesOpen(true);
    else if(command==='account')setView('community');
    else if(command.startsWith('view:')){const next=command.slice(5);if(views.some(([key])=>key===next))navigate(next as View);}
  };
  const heading=view==='community'?'Community & account':views.find(v=>v[0]===view)![1];
  const totalFindings=sources.reduce((total,source)=>total+source.report.findings.length,0);
  return <div className="app-shell" data-platform={window.stackscope?.platform??'web'}>
    <a className="skip-link" href="#main">Skip to workspace</a>
    <header className="titlebar"><div className="titlebar-safe">
      {window.stackscope&&<button className="icon-button" aria-label="Application menu" onClick={()=>void window.stackscope!.showMenu()}><Icon name="menu" size={16}/></button>}
      <span className="app-brand"><Icon name="stack" size={19}/><strong>StackScope</strong></span>
      <span className="window-title">{title}</span><span className="titlebar-mode">{window.stackscope?'Desktop':'Browser'} workspace</span>
    </div></header>
    <div className="commandbar" aria-label="Case commands">
      <div className="command-group"><button disabled={busy} aria-label="New case" onClick={clearCase} title="New case (Ctrl+N)"><Icon name="plus"/><span>New case</span></button>
      <button className="primary" disabled={busy} onClick={()=>input.current?.click()} title="Import files (Ctrl+O)"><Icon name="import"/><span>Import files</span></button>
      {window.stackscope&&<button disabled={busy} onClick={()=>setCollectOpen(true)}><Icon name="collect"/><span>Collect this computer</span></button>}
      <button disabled={!sources.length||busy} onClick={()=>{setExportOpen(true);setExportStatus('');}} title="Export report (Ctrl+Shift+E)"><Icon name="export"/><span>Export report</span></button></div>
      <button className={'account-button '+(view==='community'?'active':'')} aria-label="Community & account" aria-pressed={view==='community'} onClick={()=>setView('community')}><Icon name="user"/><span>{session?session.user.username:'Community & account'}</span>{session&&<small>{session.user.pro?'Pro':'Personal'}</small>}</button>
    </div>
    <input id="diagnostic-files" className="visually-hidden" ref={input} type="file" disabled={busy} multiple accept=".txt,.log,.nfo,.xml,.spx,.wer,.csv,.ips,.crash,.stacktrace,.json" onChange={e=>{void importFiles(Array.from(e.target.files??[]));e.target.value='';}} aria-label="Diagnostic files" />
    <div className="application-body">
      <aside className="sidebar" aria-label="Case explorer">
        <div className="pane-label">DIAGNOSTICS</div>
        <nav aria-label="Workspace">{views.map(([key,label,icon])=><button className={'nav-item '+(view===key?'active':'')} key={key} aria-label={label} title={label} aria-current={view===key?'page':undefined} onClick={()=>navigate(key)}><Icon name={icon}/><span>{label}</span>{key==='findings'&&totalFindings>0&&<b>{totalFindings}</b>}</button>)}</nav>
        <section className="case-explorer"><div className="pane-heading"><h2>Case files</h2><span>{sources.length}</span></div>
          <div className="case-file-list">{sources.map(source=><div className={'source-item '+(sourceId===source.id?'selected':'')} key={source.id}>
            <button title={source.name} onClick={()=>{setSourceId(source.id);setView('logs');setLogQuery('');setLogStart(0);}}><Icon name="logs" size={16}/><span><strong>{source.name}</strong><small>{source.report.format}</small></span></button>
            <button className="icon-button" disabled={busy} aria-label={'Remove '+source.name} onClick={()=>{setSources(previous=>previous.filter(item=>item.id!==source.id));if(sourceId===source.id)setSourceId('all');}}><Icon name="close" size={13}/></button>
          </div>)}{!sources.length&&<p className="explorer-empty">Imported and collected reports appear here.</p>}</div>
        </section>
        <div className="sidebar-bottom"><button aria-label="Preferences" onClick={()=>setPreferencesOpen(true)}><Icon name="settings"/><span>Preferences</span><kbd>Ctrl+,</kbd></button><span className="local-status"><span className="status-dot"/>Local analysis</span></div>
      </aside>
      <section className="workspace" aria-label={heading}>
        <div className="workspace-heading"><h1>{view==='overview'?'Diagnostic overview':heading}</h1><span>{view==='community'?'One StackScope account':sources.length+' reports in this case'}</span></div>
        {errors.length>0&&<div className="notice error" role="alert">{errors.map((error,i)=><p key={i}>{error}</p>)}<button className="text-button" onClick={()=>setErrors([])}>Dismiss</button></div>}
        {busy&&<div className="operation-bar" role="status"><span className="activity-dot"/><span>{progress||'Working…'}</span>{operation.current&&<button onClick={cancelOperation}>Cancel</button>}</div>}
        {isDemo&&<div className="demo-banner">SAMPLE CASE · Synthetic reports, not measurements from your computer.<button disabled={busy} onClick={()=>{setSources([]);setIsDemo(false);setSourceId('all');}}>Clear sample</button></div>}
        {sources.length>0&&view!=='community'&&<div className="filterbar"><label className="search-field"><Icon name="search" size={16}/><input type="search" placeholder="Search this view…" value={query} onChange={e=>{setQuery(e.target.value);setRowLimit(200);}} aria-label="Search workspace" /></label><label className="source-filter"><span>Source</span><select aria-label="Filter by source" value={sourceId} onChange={e=>{setSourceId(e.target.value);setLogStart(0);setRowLimit(200);}}><option value="all">All reports ({sources.length})</option>{sources.map(source=><option value={source.id} key={source.id}>{source.name}</option>)}</select></label></div>}
        <main id="main" tabIndex={-1} className={'view-content '+(view==='logs'?'source-workspace':'')}>
          {view==='overview'&&<>
            {!sources.length?<section className="empty-workspace" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void importFiles(Array.from(e.dataTransfer.files));}}>
              <div className="empty-workspace-icon"><Icon name="stack" size={38}/></div><h2>No reports imported</h2><p>Drop diagnostic files here to begin a case.</p>
              <div className="button-row"><button onClick={()=>input.current?.click()} disabled={busy}><Icon name="import"/>Browse files</button><button className="text-button" disabled={busy} onClick={()=>void importFiles(samples.map(sample=>new File([sample.text],sample.name,{type:'text/plain'})),true)}>Open sample case</button></div>
              <div className="format-list"><span>MSINFO / DXDIAG / SPX</span><span>CBS / DISM / WER</span><span>Event XML / CSV / Stack traces</span></div>
              <p className="import-limits">Text logs up to 1 GiB · Structured reports up to 128 MiB<br/>24 files · 2 GiB per case · Processed locally</p>
            </section>:<>
              <div className="case-summary">{[['Reports',sources.length],['Inventory fields',records.length],['Processes',processes.length],['Finding groups',findings.length]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
              <section className="findings-summary"><div className="section-heading"><h2>Findings to review</h2><button className="text-button" onClick={()=>navigate('findings')}>View all findings</button></div>{filteredFindings.slice(0,3).map(finding=><FindingCard key={finding.id} finding={finding} onOpen={openEvidence}/>)}{!filteredFindings.length&&<div className="empty small"><Icon name="findings" size={24}/><h3>No matching findings</h3><p>Coverage depends on the imported reports. This does not establish that the system is healthy.</p></div>}</section>
              {warnings.length>0&&<details className="coverage panel"><summary>Import coverage · {warnings.length} notes</summary>{warnings.map((warning,i)=><p key={i}>{warning}</p>)}</details>}
              <div className="add-reports" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void importFiles(Array.from(e.dataTransfer.files));}}><span>Drop more files to add to this case.</span><button className="text-button" disabled={busy} onClick={()=>input.current?.click()}>Browse files</button></div>
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
        {view==='logs'&&<SourceViewer source={currentLog} start={logStart} onStart={setLogStart} focusLine={focusLine} query={logQuery} onQuery={setLogQuery}/>}
          <div hidden={view!=='community'}><ServicePanel active={view==='community'} session={session} onSession={setSession}/></div>
        </main>
      </section>
    </div>
    <footer className="statusbar"><span><span className="status-dot"/>{busy?'Working':sources.length?'Case ready':'Ready'}</span><span>{sources.length} reports · {totalFindings} findings</span><span className="statusbar-privacy">No automatic uploads</span><span className="version">v0.3</span></footer>
    <DesktopControls open={collectOpen} onClose={()=>setCollectOpen(false)} busy={busy} collect={options=>void collectComputer(options)}/>
    {preferencesOpen&&<Preferences theme={theme} setTheme={setTheme} onClose={()=>setPreferencesOpen(false)}/>}
    {exportOpen&&<Dialog title="Review your report" className="export-dialog" onClose={()=>setExportOpen(false)}>
      <label>Case title<input autoFocus maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="checkbox-label"><input type="checkbox" checked={redact} onChange={e=>setRedact(e.target.checked)}/>Remove common identifiers</label>
      <p className="muted">Redaction is best effort. Review filenames, paths, identifiers, and evidence before sharing. Original full logs are not included.</p>
      <textarea className="export-preview" readOnly value={exportText} aria-label="Report export preview" />
      {exportStatus&&<p role="status" className="notice">{exportStatus}</p>}
      <div className="button-row"><button className="primary" onClick={downloadReport}>Download JSON</button><button disabled={!session?.user.pro||busy} onClick={async()=>{setBusy(true);try{await api('/api/cases',{method:'POST',token:session!.token,body:{title:JSON.parse(exportText).caseTitle,report:JSON.parse(exportText)}});setExportStatus('Report saved to your hosted account.');}catch(error){setExportStatus(error instanceof Error?error.message:'Save failed.');}finally{setBusy(false);}}}>Save hosted case (Pro)</button><button onClick={()=>setExportOpen(false)}>Close</button></div>
    </Dialog>}
  </div>;
}
