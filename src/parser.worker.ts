import { decodeDiagnostic, parseDiagnostic } from './engine.mjs';
self.onmessage = event => {
  const { id, name, buffer } = event.data;
  try {
    const text = decodeDiagnostic(buffer);
    self.postMessage({ id, text, report: parseDiagnostic({ id, name, text }) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Could not parse this file.' });
  }
};
