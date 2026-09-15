import { analyzeFile, readSourcePage } from './file-reader.mjs';
self.onmessage = async event => {
  const { id, file, mode, start, query } = event.data;
  try {
    const progress = (bytes: number, total: number) => self.postMessage({ progress: { bytes, total } });
    const result = mode === 'page' ? await readSourcePage(file, start, query, 500, progress) : await analyzeFile(file, id, progress);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not read this file.' });
  }
};
