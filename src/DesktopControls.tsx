import { useEffect, useState } from 'react';
import type { CollectionOptions } from './types';
export default function DesktopControls({ busy, collect }: { busy: boolean; collect: (options: CollectionOptions) => void }) {
  const [open, setOpen] = useState(false), [tray, setTray] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [options, setOptions] = useState<CollectionOptions>({ performance: true, events: true, servicing: true, fullReports: false });
  useEffect(() => {
    const desktop = window.stackscope;
    if (!desktop) return;
    desktop.preferences().then(value => setTray(value.trayEnabled)).catch(error => setError(error.message));
    return desktop.onDesktopEvent(event => { if (event.type === 'open-collection') setOpen(true); });
  }, []);
  if (!window.stackscope) return null;
  const windows = window.stackscope.platform === 'win32';
  return <section className="panel desktop-controls" aria-label="Desktop options">
    <div className="section-heading"><div><h2>This computer</h2><p className="muted">Collect diagnostics directly into your current case.</p></div><button aria-expanded={open} onClick={() => setOpen(!open)}>Collect this computer</button></div>
    {open && <div className="collection-options"><p>{windows ? 'Hardware, Windows, installed applications, and running processes are included.' : window.stackscope.platform === 'darwin' ? 'Includes hardware and applications from macOS System Profiler.' : 'Includes basic Linux OS, CPU, and memory inventory. Import additional logs for deeper analysis.'}</p>
      {windows && <div className="collection-checks">{([
        ['performance', 'Measure CPU and memory over 30 seconds'], ['events', 'Recent System and Application warnings / errors (7 days)'], ['servicing', 'Readable CBS and DISM logs'], ['fullReports', 'Full MSINFO and DXDIAG exports (may take several minutes)'],
      ] as [keyof CollectionOptions, string][]).map(([key, label]) => <label className="checkbox-label" key={key}><input type="checkbox" checked={options[key]} disabled={busy} onChange={e => setOptions({ ...options, [key]: e.target.checked })} />{label}</label>)}</div>}
      <p className="muted">Collection starts when you click below. Reports remain local. Inaccessible logs are listed in the collection results.</p><button className="primary" disabled={busy} onClick={() => collect(options)}>Start collection</button>
    </div>}
    <label className="checkbox-label"><input type="checkbox" checked={tray} disabled={saving} onChange={async e => { setSaving(true); setError(''); try { setTray((await window.stackscope!.setTray(e.target.checked)).trayEnabled); } catch (error) { setError(error instanceof Error ? error.message : 'Could not save tray preference.'); } finally { setSaving(false); } }} />Keep StackScope in the tray when I close the window</label>
    {error && <p role="alert">{error}</p>}
  </section>;
}
