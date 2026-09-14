const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function run(command, args, { signal, progress, timeout = 600000, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const stop = () => {
      if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill('SIGTERM');
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on('data', chunk => {
      if (output) output.write(chunk);
      else { stdout = (stdout + chunk.toString()).slice(-8192); for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) progress?.(line.trim().slice(0, 180)); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (signal?.aborted) reject(new Error('Collection cancelled.'));
      else if (timedOut) reject(new Error('Collection timed out after ten minutes. Try without full MSINFO / DXDIAG exports.'));
      else if (code) reject(new Error(stderr.trim() || command + ' exited with code ' + code));
      else resolve(stdout);
    });
  });
}
async function collectComputer(directory, options, { signal, progress = () => {} } = {}) {
  const warnings = [];
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    // Execute only our bundled, fixed commands. No elevation or policy changes.
    // Passing the text also works inside ASAR and does not require enabling .ps1 files.
    const script = await fs.readFile(path.join(__dirname, 'scripts', 'collect-windows.ps1'), 'utf8');
    const flags = Object.entries({ performance: '-Performance', events: '-Events', servicing: '-Servicing', fullReports: '-FullReports' })
      .filter(([key]) => options[key] === true).map(([, flag]) => flag).join(' ');
    const command = '& { ' + script + " } -OutputDirectory '" + directory.replaceAll("'", "''") + "' " + flags;
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
    try { await run('powershell.exe', args, { signal, progress }); }
    catch (error) { if (signal?.aborted) throw error; warnings.push(error.message); }
  } else if (process.platform === 'darwin') {
    progress('Reading hardware and installed applications with System Profiler');
    const { createWriteStream } = require('node:fs');
    const { finished } = require('node:stream/promises');
    const output = createWriteStream(path.join(directory, 'system.spx'), { mode: 0o600 });
    const writing = finished(output);
    try { await run('/usr/sbin/system_profiler', ['SPHardwareDataType', 'SPMemoryDataType', 'SPDisplaysDataType', 'SPStorageDataType', 'SPApplicationsDataType', '-xml'], { signal, progress, output }); }
    catch (error) { if (signal?.aborted) throw error; warnings.push(error.message); }
    finally { output.end(); await writing; }
    warnings.push('macOS collection includes a System Profiler snapshot. Windows event logs and measured process CPU samples are available on Windows.');
  } else {
    progress('Reading basic system inventory');
    const record = (kind, category, label, value) => ({ kind, category, label, value: String(value) });
    const snapshot = { schema: 'stackscope.snapshot.v1', collectedAt: new Date().toISOString(), records: [
      record('system', 'Operating system', 'OS name', os.type()), record('system', 'Operating system', 'OS version', os.release()),
      record('hardware', 'Processor', 'Processor', os.cpus()[0]?.model ?? os.arch()), record('hardware', 'Processor', 'Logical processors', os.cpus().length),
      record('hardware', 'Memory', 'Installed physical memory', Math.round(os.totalmem() / 1048576) + ' MiB'),
    ], processes: [], warnings: ['Linux automatic collection currently includes basic OS, CPU, and memory inventory. Import additional diagnostic reports for processes, applications, and logs.'] };
    await fs.writeFile(path.join(directory, 'computer-snapshot.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  }
  if (signal?.aborted) throw new Error('Collection cancelled.');
  const { MAX_FILE_BYTES, MAX_CASE_BYTES } = await import('../shared/limits.mjs');
  const files = []; let total = 0;
  const entries = (await fs.readdir(directory)).filter(name => /\.(json|nfo|xml|spx|log|csv)$/i.test(name));
  // Keep the inventory even when optional logs exceed the case budget.
  entries.sort((a, b) => Number(b === 'computer-snapshot.json') - Number(a === 'computer-snapshot.json'));
  for (const name of entries) {
    const target = path.join(directory, name), stat = await fs.stat(target);
    if (!stat.size) { warnings.push(name + ': no data was collected.'); continue; }
    if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_CASE_BYTES) { warnings.push(name + ': skipped because it exceeds the import budget.'); continue; }
    total += stat.size; files.push({ name, path: target, bytes: stat.size });
  }
  if (!files.length) throw new Error('No reports were collected. ' + warnings.join(' '));
  return { files, warnings };
}
module.exports = { collectComputer };
