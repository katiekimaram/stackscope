import type { Source, Report } from './types';
export function runFileWorker<T>(message: object, signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('Import cancelled.')); };
    const watchdog = () => { clearTimeout(timer); timer = setTimeout(() => { finish(); reject(new Error('The parser stopped responding for two minutes. Try exporting a smaller report.')); }, 120000); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    watchdog();
    worker.onmessage = event => {
      if (event.data.progress) { watchdog(); const p = event.data.progress; onProgress?.(Math.round(p.bytes / p.total * 100)); return; }
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = () => { finish(); reject(new Error('The file reader could not start. Restart StackScope and try again.')); };
    worker.postMessage(message);
  });
}
export async function importFile(file: File, signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<Source> {
  const id = crypto.randomUUID();
  try { return { id, name: file.name, bytes: file.size, file, report: await runFileWorker<Report>({ id, file }, signal, onProgress) }; }
  catch (error) { throw new Error(file.name + ': ' + (error instanceof Error ? error.message : 'Import failed.')); }
}
