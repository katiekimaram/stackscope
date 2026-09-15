import { useState } from 'react';
import Dialog from './Dialog';
import type { CollectionOptions } from './types';
export default function DesktopControls({ open, onClose, busy, collect }: { open: boolean; onClose: () => void; busy: boolean; collect: (options: CollectionOptions) => void }) {
  const [options, setOptions] = useState<CollectionOptions>({ performance: true, events: true, servicing: true, fullReports: false });
  if (!open || !window.stackscope) return null;
  const windows = window.stackscope.platform === 'win32';
  return <Dialog title="Collect this computer" onClose={onClose}>
    <p>{windows ? 'Hardware, Windows, installed applications, and running processes are included.' : window.stackscope.platform === 'darwin' ? 'Collect hardware and applications with macOS System Profiler.' : 'Collect basic Linux OS, CPU, and memory inventory. Import additional logs for deeper analysis.'}</p>
    {windows && <fieldset className="collection-checks"><legend>Include in this collection</legend>{([
      ['performance', 'CPU and memory sample', 'Measure process activity over 30 seconds.'],
      ['events', 'Recent Windows events', 'System and Application warnings / errors from the last 7 days.'],
      ['servicing', 'CBS and DISM logs', 'Copy readable Windows servicing logs.'],
      ['fullReports', 'Full MSINFO and DXDIAG exports', 'Additional detail; may take several minutes.'],
    ] as [keyof CollectionOptions, string, string][]).map(([key, label, hint]) => <label className="option-row" key={key}><input type="checkbox" checked={options[key]} disabled={busy} onChange={e => setOptions({ ...options, [key]: e.target.checked })} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset>}
    <p className="muted">Reports are added to this case and stay local. Inaccessible reports appear in the coverage notes.</p>
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => { collect(options); onClose(); }}>Start collection</button></div>
  </Dialog>;
}
