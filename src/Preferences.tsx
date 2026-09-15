import { useEffect, useState } from 'react';
import Dialog from './Dialog';
export default function Preferences({ theme, setTheme, onClose }: { theme: string; setTheme: (value: string) => void; onClose: () => void }) {
  const [tray, setTray] = useState(false), [saving, setSaving] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.stackscope?.preferences().then(value => { if (active) setTray(value.trayEnabled); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setSaving(false); });
    return () => { active = false; };
  }, []);
  return <Dialog title="Preferences" onClose={onClose}>
    <div className="settings-row"><div><strong>Appearance</strong><p>Choose the workspace color scheme.</p></div><select aria-label="Appearance" value={theme} onChange={e => setTheme(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></div>
    {window.stackscope && <div className="settings-row"><label className="option-row"><input type="checkbox" checked={tray} disabled={saving} onChange={async e => {
      const previous = tray, enabled = e.target.checked;
      setTray(enabled); setSaving(true); setError('');
      try { setTray((await window.stackscope!.setTray(enabled)).trayEnabled); }
      catch (error) { setTray(previous); setError(error instanceof Error ? error.message : 'Could not save preference.'); }
      finally { setSaving(false); }
    }} /><span><strong>Keep StackScope in the tray when I close the window</strong><small>The tray menu can reopen your case, start collection, or quit.</small></span></label></div>}
    {error && <p className="notice" role="alert">{error}</p>}
    <p className="muted">StackScope 0.3 · Local analysis is available without an account. Quitting ends the current case; export any results you want to keep.</p>
    <div className="dialog-actions"><button className="primary" onClick={onClose}>Done</button></div>
  </Dialog>;
}
