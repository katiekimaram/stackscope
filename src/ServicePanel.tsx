import { useEffect, useState } from 'react';
import { api } from './api';
export type Session = { token: string; user: { id: string; username: string; pro: boolean; moderator: boolean } };
type Entry = { id: string; name: string; publisher: string; version: string; descriptions: { id: string; body: string; username: string }[]; votes: { dimension: string; score: number; voters: number }[] };
export default function ServicePanel({ mode, session, onSession }: { mode: 'community' | 'account'; session: Session | null; onSession: (s: Session | null) => void }) {
  const [entries,setEntries]=useState<Entry[]>([]),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [register,setRegister]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [name,setName]=useState(''),[publisher,setPublisher]=useState(''),[version,setVersion]=useState(''),[description,setDescription]=useState('');
  const [pending,setPending]=useState<any[]>([]),[reports,setReports]=useState<any[]>([]),[cases,setCases]=useState<any[]>([]);
  const [billingUrl,setBillingUrl]=useState(''),[billingReady,setBillingReady]=useState(false);
  async function refresh() {
    const health=await api('/api/health');setBillingReady(health.billingConfigured);
    if(mode==='community')setEntries((await api('/api/community')).entries);
    if(session) {
      const me=await api('/api/me',{token:session.token});onSession({...session,user:me.user});
      if(mode==='account')setCases((await api('/api/cases',{token:session.token})).cases);
      if(me.user.moderator&&mode==='community') {const queue=await api('/api/moderation',{token:session.token});setPending(queue.pending);setReports(queue.reports);}
    }
  }
  async function action(fn:()=>Promise<void>) {setBusy(true);setStatus('');try{await fn();}catch(error){setStatus(error instanceof Error?error.message:'Service unavailable.');}finally{setBusy(false);}}
  useEffect(()=>{void action(refresh);},[mode,session?.token]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    await action(async()=>{
      const deviceFingerprint=window.stackscope?await window.stackscope.deviceIdentity():undefined;
      const result=await api(register?'/api/auth/register':'/api/auth/login',{method:'POST',body:{username,password,deviceFingerprint}});
      onSession(result);setPassword('');setStatus('Signed in. Your diagnostic files have not been uploaded.');
    });
  }
  async function billing(kind: 'checkout' | 'portal') {
    if(!session)return;
    await action(async()=>{
      const result=await api('/api/billing/'+kind,{method:'POST',body:{},token:session.token});
      const url=new URL(result.url);
      if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw new Error('Unexpected billing destination.');
      setBillingUrl(url.href);
    });
  }
  function download(value: unknown,filename: string) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <div className="service-layout">
    <div className="section-heading"><div><p className="eyebrow">CONNECTED FEATURES</p><h2>{mode==='community'?'Community knowledge':'Account & plans'}</h2></div><button disabled={busy} onClick={()=>void action(refresh)}>Refresh service</button></div>
    {status&&<p className="notice" role="status">{status}</p>}
    {!session?<section className="panel account-form"><div><h3>{register?'Register this desktop':'Sign in to the community'}</h3><p>Local analysis works without an account. An account enables voting and contributions.</p><p className="muted">Create accounts in the desktop app. One registered device per account; device transfers currently require administrator support. A browser can sign in afterwards.</p></div>
      <form onSubmit={signIn}><label>Username<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} minLength={3} maxLength={32} required /></label>
      <label>Password<input type="password" autoComplete={register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={register?12:1} maxLength={128} required /></label>
      <button className="primary" disabled={busy||register&&!window.stackscope}>{register?'Create account':'Sign in'}</button>
      <button type="button" className="text-button" disabled={!window.stackscope||busy} onClick={()=>setRegister(!register)}>{register?'Use an existing account':'Register this desktop'}</button></form></section>
      :<div className="signed-in"><span>Signed in as <strong>{session.user.username}</strong> · {session.user.pro?'Pro':'Personal'}</span><button disabled={busy} onClick={()=>void action(async()=>{await api('/api/auth/logout',{method:'POST',body:{},token:session.token});onSession(null);setBillingUrl('');})}>Sign out</button></div>}
    {mode==='community'?<>
      <p className="notice neutral">Community opinions are separate from diagnostic findings. Product names and publishers are user supplied, not verified identities. Votes do not establish whether a file is safe or malicious.</p>
      {session&&<form className="panel" onSubmit={e=>{e.preventDefault();void action(async()=>{await api('/api/community',{method:'POST',token:session.token,body:{name,publisher,version,description}});setDescription('');await refresh();setStatus('Description submitted for moderation.');});}}>
        <h3>Describe an application or process</h3><div className="form-grid"><label>Name<input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} /></label><label>Publisher<input maxLength={200} value={publisher} onChange={e=>setPublisher(e.target.value)} /></label><label>Version<input maxLength={100} value={version} onChange={e=>setVersion(e.target.value)} /></label></div>
        <label>What does it do?<textarea required maxLength={600} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe its purpose and the context you observed. Do not include private logs or personal information." /></label>
        <button className="primary" disabled={busy}>Submit for review</button>
      </form>}
      {!entries.length&&<div className="empty small"><h3>No community entries loaded</h3><p>Connect the service and contribute the first description. StackScope does not invent votes or reputation scores.</p></div>}
      {entries.map(entry=><article className="panel community-entry" key={entry.id}><div className="entry-heading"><div><h3>{entry.name}</h3><p className="muted">{entry.publisher||'Publisher unspecified'} · {entry.version||'Version unspecified'}</p></div><span className="pill">Community entry</span></div>
        {entry.descriptions.length?entry.descriptions.map(d=><blockquote key={d.id}>{d.body}<footer>Contribution by {d.username}</footer></blockquote>):<p className="muted">No approved description yet.</p>}
        <div className="vote-grid">{[['usefulness','Useful for its purpose'],['performance','Performance concerns'],['suspicious','Suspicious behavior reported']].map(([dimension,label])=>{
          const tally=entry.votes.find(v=>v.dimension===dimension);
          return <div className="vote" key={dimension}><span>{label}</span><strong>{tally?.score??0}<small> net · {tally?.voters??0} voters</small></strong><div className="button-row">{[[-1,'Disagree'],[1,'Agree'],[0,'Remove vote']].map(([value,title])=><button key={value} disabled={!session||busy} onClick={()=>void action(async()=>{await api('/api/community/vote',{method:'POST',token:session!.token,body:{entryId:entry.id,dimension,value}});await refresh();})}>{title}</button>)}</div></div>;
        })}</div>
        <button className="text-button" disabled={!session||busy} onClick={()=>{const reason=window.prompt('Reason for reporting this entry (no private diagnostic data):');if(reason)void action(async()=>{await api('/api/community/report',{method:'POST',token:session!.token,body:{entryId:entry.id,reason}});setStatus('Report submitted to moderators.');});}}>Report entry</button>
      </article>)}
      {session?.user.moderator&&<section className="panel"><h3>Moderation queue</h3>{pending.length===0&&<p>No descriptions awaiting review.</p>}{pending.map(item=><div className="moderation-row" key={item.id}><strong>{item.name} · {item.username}</strong><p>{item.body}</p><div className="button-row">{['approved','rejected'].map(status=><button disabled={busy} key={status} onClick={()=>void action(async()=>{await api('/api/moderation',{method:'POST',token:session.token,body:{id:item.id,status}});await refresh();})}>{status==='approved'?'Approve':'Reject'}</button>)}</div></div>)}<h3>Reported entries</h3>{reports.map(item=><p key={item.id}>{item.entry_id.slice(0,12)}: {item.reason}</p>)}{!reports.length&&<p>No reports.</p>}</section>}
    </>:<>
      <div className="plan-grid"><section className="panel plan"><p className="eyebrow">PERSONAL</p><h3>Local diagnostics</h3><p className="plan-price">Free</p><ul><li>Diagnostic file imports</li><li>Hardware, software, and findings</li><li>Source evidence and JSON export</li><li>Open source under AGPLv3</li></ul><p className="muted">No account needed for local analysis.</p></section>
      <section className="panel plan featured"><p className="eyebrow">PRO</p><h3>Hosted case storage</h3><p className="plan-price">{session?.user.pro?'Active subscription':'Subscription'}</p><ul><li>Save up to 100 reports to your account</li><li>Access saved reports across sessions</li><li>Manage payments through Stripe</li></ul><p className="muted">Pricing is configured by the host. Team workspaces and branded PDF reports are planned.</p>
      <button className="primary" disabled={!session||!billingReady||busy} onClick={()=>void billing(session?.user.pro?'portal':'checkout')}>{session?.user.pro?'Manage subscription':'View checkout'}</button>
      {!billingReady&&<p className="muted">Billing is not configured on this service.</p>}</section></div>
      {billingUrl&&<section className="panel"><p>Continue to Stripe to review pricing and payment details.</p><a className="button primary" href={billingUrl} onClick={e=>{if(window.stackscope){e.preventDefault();navigator.clipboard.writeText(billingUrl).then(()=>setStatus('Billing link copied. Open it in your browser to continue.')).catch(()=>setStatus('Copy the billing URL below into your browser.'));}}>{window.stackscope?'Copy secure billing link':'Open secure billing page'}</a><input aria-label="Secure billing URL" readOnly value={billingUrl} /></section>}
      {session&&<section className="panel"><h3>Saved reports</h3><p className="muted">Reports are uploaded only when you choose “Save hosted case” from the export preview. Previously saved reports remain readable after a subscription ends.</p>
        {!cases.length&&<p>No saved reports.</p>}{cases.map(item=><div className="saved-row" key={item.id}><span>{item.title}<small>{new Date(item.created).toLocaleString()}</small></span><div className="button-row"><button disabled={busy} onClick={()=>void action(async()=>download((await api('/api/cases/'+item.id,{token:session.token})).report,'stackscope-case.json'))}>Download</button><button disabled={busy} onClick={()=>{if(window.confirm('Delete this saved report?'))void action(async()=>{await api('/api/cases/'+item.id,{method:'DELETE',body:{},token:session.token});await refresh();});}}>Delete</button></div></div>)}
      </section>}
      {session&&<section className="panel"><h3>Delete account</h3><p>Removes the account, sessions, votes, contributions, and saved reports. Accounts with a billing history require administrator assistance.</p><button disabled={busy} onClick={()=>{if(window.confirm('Permanently delete your account and stored data?'))void action(async()=>{await api('/api/me',{method:'DELETE',body:{},token:session.token});onSession(null);});}}>Delete my account</button></section>}
    </>}
  </div>;
}
