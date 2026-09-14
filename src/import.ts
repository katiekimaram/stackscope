import type { Source } from './types';
export function importFile(file: File): Promise<Source> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error(file.name + ': parser timed out after 15 seconds.')); }, 15000);
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = event => {
      finish();
      if (event.data.error) reject(new Error(file.name + ': ' + event.data.error));
      else resolve({ id, name: file.name, bytes: file.size, text: event.data.text, report: event.data.report });
    };
    worker.onerror = () => { finish(); reject(new Error(file.name + ': parser could not start.')); };
    file.arrayBuffer().then(buffer => worker.postMessage({ id, name: file.name, buffer }, [buffer])).catch(error => { finish(); reject(error); });
  });
}
