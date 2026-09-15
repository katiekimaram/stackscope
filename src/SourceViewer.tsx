import { useEffect, useState } from 'react';
import { runFileWorker } from './import';
import type { Source } from './types';
type Page = { rows: { line: number; text: string }[]; hasNext: boolean };
export default function SourceViewer({ source, start, onStart, focusLine, query, onQuery }: {
  source?: Source; start: number; onStart: (value: number) => void; focusLine: number; query: string; onQuery: (value: string) => void;
}) {
  const [page, setPage] = useState<Page>({ rows: [], hasNext: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setPage({ rows: [], hasNext: false }); setError('');
    if (!source) return;
    setBusy(true);
    const timer = setTimeout(() => {
      runFileWorker<Page>({ mode: 'page', file: source.file, start, query }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setPage(value); })
        .catch(error => { if (!controller.signal.aborted) setError(error.message); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, start, query]);
  return <><div className="section-heading"><div><h2>{source?.name ?? 'Source viewer'}</h2><p className="muted">Original source · 500 lines per page · Text evidence uses line numbers.</p></div><input type="search" aria-label="Search source lines" placeholder="Filter source lines…" value={query} onChange={e => { onQuery(e.target.value); onStart(0); }} /></div>
    {busy && <p role="status">Reading source lines…</p>}{error && <p role="alert">{error}</p>}
    <div className="log-view" role="region" aria-label="Source log lines" tabIndex={0}>{page.rows.map(row => <div className={'log-line ' + (row.line === focusLine ? 'highlight' : '')} key={row.line}><span>{row.line}</span><code>{row.text || ' '}</code></div>)}{!busy && !page.rows.length && <p>No source lines to display.</p>}</div>
    <div className="pagination"><button disabled={busy || start === 0} onClick={() => onStart(Math.max(0, start - 500))}>Previous</button><span>{page.rows.length ? start + 1 : 0}–{start + page.rows.length} {query ? 'matching lines' : 'of ' + (source?.report.lineCount.toLocaleString() ?? '0') + ' lines'}</span><button disabled={busy || !page.hasNext} onClick={() => onStart(start + 500)}>Next</button></div></>;
}
