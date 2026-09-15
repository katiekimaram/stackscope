import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import Dialog from './Dialog';
import Icon from './Icon';
export type Session = { token: string; user: { id: string; username: string; pro: boolean; moderator: boolean } };
type Entry = { id: string; name: string; publisher: string; version: string; descriptions: { id: string; body: string; username: string }[]; votes: { dimension: string; score: number; voters: number }[] };
type Tab = 'community' | 'reports' | 'account' | 'moderation';
export default function ServicePanel({ active, session, onSession }: { active: boolean; session: Session | null; onSession: (session: Session | null) => void }) {
  const [tab, setTab] = useState<Tab>('community'), [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const [register, setRegister] = useState(false), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [contribute, setContribute] = useState(false), [name, setName] = useState(''), [publisher, setPublisher] = useState(''), [version, setVersion] = useState(''), [description, setDescription] = useState('');
  const [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState('');
  const [pending, setPending] = useState<any[]>([]), [reports, setReports] = useState<any[]>([]), [cases, setCases] = useState<any[]>([]);
  const [billingUrl, setBillingUrl] = useState(''), [billingReady, setBillingReady] = useState(false);
  const generation = useRef(0), actionGeneration = useRef(0), identity = useRef(session?.token), isActive = useRef(active);
  identity.current = session?.token; isActive.current = active;
  async function refresh() {
    const request = ++generation.current, token = session?.token;
    const current = () => request === generation.current && token === identity.current && isActive.current;
    try {
      const [health, library] = await Promise.all([api('/api/health'), api('/api/community')]);
      if (!current()) return;
      setBillingReady(health.billingConfigured); setEntries(library.entries); setConnected(true);
      if (session) {
        const me = await api('/api/me', { token });
        if (!current()) return;
        onSession({ token: session.token, user: me.user });
        const saved = await api('/api/cases', { token });
        if (!current()) return;
        setCases(saved.cases);
        if (me.user.moderator) {
          const queue = await api('/api/moderation', { token });
          if (current()) { setPending(queue.pending); setReports(queue.reports); }
        }
      }
    } catch (error) { if (current()) { setConnected(false); throw error; } }
  }
  async function action(fn: () => Promise<void>) {
    const request = ++actionGeneration.current;
    setBusy(true); setStatus('');
    try { await fn(); } catch (error) { if (request === actionGeneration.current) setStatus(error instanceof Error ? error.message : 'The account service is unavailable.'); }
    finally { if (request === actionGeneration.current) setBusy(false); }
  }
  useEffect(() => {
    setCases([]); setPending([]); setReports([]); setBillingUrl(''); setContribute(false); setPassword('');
    if (tab === 'moderation' && !session?.user.moderator) setTab('community');
  }, [session?.token]);
  useEffect(() => {
    if (active) void action(refresh);
    return () => { generation.current++; };
  }, [active, session?.token]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    await action(async () => {
      const deviceFingerprint = window.stackscope ? await window.stackscope.deviceIdentity() : undefined;
      const result = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: { username, password, deviceFingerprint } });
      onSession(result); setPassword(''); setRegister(false);
    });
  }
  async function signOut() {
    if (!session) return;
    const token = session.token;
    // End the local session even when the service cannot be reached.
    onSession(null); setPassword(''); setBillingUrl(''); setCases([]); setPending([]); setReports([]);
    try { await api('/api/auth/logout', { method: 'POST', body: {}, token }); }
    catch { setStatus('Signed out on this device. The service could not be reached to revoke the remote session.'); }
  }
  async function billing() {
    if (!session) return;
    await action(async () => {
      const result = await api('/api/billing/' + (session.user.pro ? 'portal' : 'checkout'), { method: 'POST', body: {}, token: session.token });
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw new Error('Unexpected billing destination.');
      setBillingUrl(url.href);
    });
  }
  function download(value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'stackscope-case.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filtered = entries.filter(entry => (entry.name + ' ' + entry.publisher + ' ' + entry.version).toLowerCase().includes(query.toLowerCase()));
  const entry = filtered.find(item => item.id === selectedId) ?? filtered[0];
  const tabs: [Tab, string][] = [['community', 'Community'], ['reports', 'Saved reports'], ['account', 'Account']];
  if (session?.user.moderator) tabs.push(['moderation', 'Moderation']);
  return <div className="account-hub">
    <div className="identity-bar"><span className="avatar"><Icon name="user" size={19}/></span><div>{session ? <><strong>Signed in as {session.user.username}</strong><small>{session.user.pro ? 'Pro' : 'Personal'} · Community, reports, and billing</small></> : <><strong>Your StackScope account</strong><small>One sign-in for community, saved reports, and billing.</small></>}</div><span className={'connection-state ' + (connected ? 'online' : '')}>{busy ? 'Connecting…' : connected ? 'Connected' : 'Offline'}</span><button disabled={busy} aria-label="Refresh service" onClick={() => void action(refresh)}>Refresh</button>{session && <button disabled={busy} onClick={() => void signOut()}>Sign out</button>}</div>
    {status && <p className="notice" role="status">{status}</p>}
    {!session && <section className="sign-in-panel"><div><h2>{register ? 'Create your StackScope account' : 'Sign in to StackScope'}</h2><p>The same account handles your contributions, votes, saved reports, and subscription. Local diagnostics remain available without signing in.</p>{register && <p className="muted">Registration links this desktop to your account. Device transfers currently require administrator support.</p>}</div>
      <form onSubmit={signIn} aria-label="StackScope sign in"><label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} minLength={3} maxLength={32} required /></label><label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} minLength={register ? 12 : 1} maxLength={128} required /></label><div className="button-row"><button className="primary" disabled={busy || register && !window.stackscope}>{register ? 'Create account' : 'Sign in'}</button>{window.stackscope && <button type="button" className="text-button" disabled={busy} onClick={() => setRegister(!register)}>{register ? 'Use an existing account' : 'Create account'}</button>}</div>{!window.stackscope && <small>Create a new account in the desktop app, then use that account here.</small>}</form>
    </section>}
    <div className="hub-tabs" role="tablist" aria-label="Account sections">{tabs.map(([key, label]) => <button key={key} id={'hub-tab-' + key} role="tab" aria-selected={tab === key} aria-controls={'hub-panel-' + key} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = tabs.findIndex(([id]) => id === tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setTab(tabs[next][0]); document.getElementById('hub-tab-' + tabs[next][0])?.focus();
    }}>{label}</button>)}</div>
    <section role="tabpanel" id={'hub-panel-' + tab} aria-labelledby={'hub-tab-' + tab} className="hub-panel">
      {tab === 'community' && <>
        <div className="section-heading"><h2>Application library</h2><button disabled={!session || busy} onClick={() => setContribute(true)}><Icon name="plus" size={16}/>Add description</button></div>
        <p className="context-note">Community reports are user opinions. Votes do not establish whether an executable is safe or malicious.</p>
        <div className="community-split"><div className="community-list"><label className="search-field"><Icon name="search" size={15}/><input type="search" aria-label="Filter community entries" placeholder="Filter loaded entries…" value={query} onChange={e => setQuery(e.target.value)}/></label><small className="list-count">{filtered.length} of {entries.length} loaded entries</small><div className="entry-list">{filtered.map(item => <button key={item.id} className={entry?.id === item.id ? 'selected' : ''} aria-pressed={entry?.id === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.name}</strong><small>{item.publisher || 'Publisher unspecified'}</small></button>)}</div></div>
          <div className="entry-detail">{entry ? <><div className="entry-heading"><Icon name="software" size={24}/><div><h3>{entry.name}</h3><small>{entry.publisher || 'Publisher unspecified'} · {entry.version || 'Version unspecified'}</small></div></div>{entry.descriptions.length ? entry.descriptions.map(description => <blockquote key={description.id}>{description.body}<footer>{description.username}</footer></blockquote>) : <p>No approved description yet.</p>}
            <div className="vote-grid">{[['usefulness', 'Useful for its purpose'], ['performance', 'Performance concerns'], ['suspicious', 'Suspicious behavior']].map(([dimension, label]) => { const tally = entry.votes.find(vote => vote.dimension === dimension); return <div className="vote" key={dimension}><div><strong>{label}</strong><small>{tally?.score ?? 0} net · {tally?.voters ?? 0} voters</small></div><div className="button-row">{[[-1, 'Disagree'], [1, 'Agree'], [0, 'Remove vote']].map(([value, title]) => <button key={value} disabled={!session || busy} onClick={() => void action(async () => { await api('/api/community/vote', { method: 'POST', token: session!.token, body: { entryId: entry.id, dimension, value } }); await refresh(); })}>{title}</button>)}</div></div>; })}</div>
            {!session && <p className="muted">Sign in above to vote or contribute.</p>}<button className="text-button" disabled={!session || busy} onClick={() => { const reason = window.prompt('Why are you reporting this entry? Do not include private diagnostic data.'); if (reason) void action(async () => { await api('/api/community/report', { method: 'POST', token: session!.token, body: { entryId: entry.id, reason } }); setStatus('Report submitted to moderators.'); }); }}>Report entry</button>
          </> : <div className="empty small"><Icon name="software" size={28}/><h3>{entries.length ? 'No matching entries' : 'No community entries loaded'}</h3><p>{entries.length ? 'Try a different filter.' : connected ? 'Add the first application description.' : 'Connect to the account service to browse community contributions.'}</p></div>}</div>
        </div>
      </>}
      {tab === 'reports' && <><div className="section-heading"><h2>Saved reports</h2><span className="muted">{session ? cases.length + ' / 100' : 'Account storage'}</span></div><p className="context-note">Use Export report → Save hosted case to upload a reviewed report. Reports remain readable after a subscription ends.</p>{!session ? <p className="empty small">Sign in above to access your saved reports.</p> : !cases.length ? <div className="empty small"><Icon name="logs" size={28}/><h3>No saved reports</h3><p>{session.user.pro ? 'Export a case and choose Save hosted case to add it here.' : 'A Pro subscription enables hosted storage. Local analysis and export are free.'}</p></div> : <div className="saved-reports">{cases.map(item => <div className="saved-row" key={item.id}><Icon name="logs"/><span><strong>{item.title}</strong><small>{new Date(item.created).toLocaleString()}</small></span><div className="button-row"><button disabled={busy} onClick={() => void action(async () => download((await api('/api/cases/' + item.id, { token: session.token })).report))}>Download</button><button disabled={busy} onClick={() => { if (window.confirm('Delete this saved report?')) void action(async () => { await api('/api/cases/' + item.id, { method: 'DELETE', body: {}, token: session.token }); await refresh(); }); }}>Delete</button></div></div>)}</div>}</>}
      {tab === 'account' && <><h2>Account settings</h2><div className="settings-row"><div><strong>Account</strong><p>{session ? session.user.username : 'Sign in above to manage your account.'}</p></div><span className="pill">{session?.user.pro ? 'Pro' : 'Personal'}</span></div><div className="settings-row"><div><strong>Subscription</strong><p>{session?.user.pro ? 'Hosted case storage is active.' : 'Local diagnostics and JSON export are free. Pro adds hosted case storage.'}</p><small>Up to 100 reports · 32 MiB per saved report request</small></div><button disabled={!session || !billingReady || busy} onClick={() => void billing()}>{session?.user.pro ? 'Manage subscription' : 'View checkout'}</button></div>{!billingReady && <p className="context-note">Subscription checkout is not available on this service.</p>}{billingUrl && <section className="panel"><p>Continue to Stripe to review pricing and payment details.</p><a className="button primary" href={billingUrl} onClick={event => { if (window.stackscope) { event.preventDefault(); navigator.clipboard.writeText(billingUrl).then(() => setStatus('Billing link copied. Open it in your browser.')).catch(() => setStatus('Copy the billing URL below into your browser.')); } }}>{window.stackscope ? 'Copy secure billing link' : 'Open secure billing page'}</a><input aria-label="Secure billing URL" readOnly value={billingUrl}/></section>}
        {session && <details className="account-danger"><summary>Delete account</summary><p>Permanently removes your account, contributions, votes, and saved reports. Accounts with billing history require administrator assistance.</p><button disabled={busy} onClick={() => { if (window.confirm('Permanently delete your account and stored data?')) void action(async () => { await api('/api/me', { method: 'DELETE', body: {}, token: session.token }); onSession(null); }); }}>Delete my account</button></details>}
      </>}
      {tab === 'moderation' && session?.user.moderator && <><h2>Moderation queue</h2>{!pending.length && <p>No descriptions awaiting review.</p>}{pending.map(item => <div className="moderation-row" key={item.id}><strong>{item.name} · {item.username}</strong><p>{item.body}</p><div className="button-row">{['approved', 'rejected'].map(status => <button disabled={busy} key={status} onClick={() => void action(async () => { await api('/api/moderation', { method: 'POST', token: session.token, body: { id: item.id, status } }); await refresh(); })}>{status === 'approved' ? 'Approve' : 'Reject'}</button>)}</div></div>)}<h3>Reported entries</h3>{reports.map(item => <p key={item.id}>{item.entry_id.slice(0, 12)}: {item.reason}</p>)}{!reports.length && <p>No reports.</p>}</>}
    </section>
    {contribute && session && <Dialog title="Describe an application" onClose={() => setContribute(false)}><form onSubmit={event => { event.preventDefault(); void action(async () => { const result = await api('/api/community', { method: 'POST', token: session.token, body: { name, publisher, version, description } }); setDescription(''); setContribute(false); setSelectedId(result.id); await refresh(); setStatus('Description submitted for moderation.'); }); }}><div className="form-grid"><label>Name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)}/></label><label>Publisher<input maxLength={200} value={publisher} onChange={e => setPublisher(e.target.value)}/></label><label>Version<input maxLength={100} value={version} onChange={e => setVersion(e.target.value)}/></label></div><label>What does it do?<textarea required maxLength={600} rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe its purpose and the context you observed. Do not include private logs or personal information."/></label>{status && <p role="status">{status}</p>}<div className="dialog-actions"><button type="button" onClick={() => setContribute(false)}>Cancel</button><button className="primary" disabled={busy}>Submit for review</button></div></form></Dialog>}
  </div>;
}
