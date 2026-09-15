const { app, BrowserWindow, protocol, session, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const { readFile, writeFile, mkdir, mkdtemp, rm } = require('node:fs/promises');
const { appendFileSync, createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { collectComputer } = require('./collector.cjs');
const { resolve, sep, extname } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash, randomUUID } = require('node:crypto');
const run = promisify(execFile);
app.setName('StackScope');
app.setPath('userData', resolve(app.getPath('appData'), 'StackScope'));
app.setAppUserModelId('dev.stackscope.app');
app.enableSandbox();
// Do not let a second launch overwrite a running case.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let quitting = false, tray = null, trayEnabled = false, collection = null, collectionDirectory = null;
const collectedFiles = new Map();
const preferencesPath = resolve(app.getPath('userData'), 'preferences.json');
function showWindow() { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } }
function sendEvent(value) { if (window && !window.isDestroyed()) window.webContents.send('stackscope:event', value); }
function updateTray(enabled) {
  if (enabled && !tray) {
    const icon = nativeImage.createFromPath(resolve(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png'));
    if (icon.isEmpty()) throw new Error('StackScope tray icon is missing. Reinstall the complete application.');
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon.resize({ width: process.platform === 'darwin' ? 18 : 24, height: process.platform === 'darwin' ? 18 : 24 }));
    tray.setToolTip('StackScope');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open StackScope', click: showWindow },
      { label: 'Collect this computer…', click: () => { showWindow(); sendEvent({ type: 'open-collection' }); } },
      { type: 'separator' }, { label: 'Quit StackScope', click: () => app.quit() },
    ]));
    tray.on('double-click', showWindow);
    tray.on('click', showWindow);
  } else if (!enabled && tray) { tray.destroy(); tray = null; showWindow(); }
  trayEnabled = enabled;
}
async function releaseCollection() {
  collectedFiles.clear();
  if (collectionDirectory) { const directory = collectionDirectory; collectionDirectory = null; await rm(directory, { recursive: true, force: true }); }
}
function startupError(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const log = resolve(app.getPath('userData'), 'startup.log');
  try { require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true }); appendFileSync(log, new Date().toISOString() + '\n' + message + '\n'); } catch {}
  dialog.showErrorBox('StackScope could not start', 'Please reinstall the complete StackScope package.\n\n' + message.slice(0, 1800) + '\n\nDetails: ' + log);
  app.quit();
}
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; collection?.abort(); });
app.on('will-quit', () => { tray?.destroy(); if (!collection && collectionDirectory) { try { require('node:fs').rmSync(collectionDirectory, { recursive: true, force: true }); } catch {} } });
protocol.registerSchemesAsPrivileged([{ scheme:'stackscope',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true} }]);
const allowedPaths = new Set(['/api/health','/api/me','/api/auth/register','/api/auth/login','/api/auth/logout','/api/community','/api/community/vote','/api/community/report','/api/moderation','/api/billing/checkout','/api/billing/portal','/api/cases']);
let window;
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'stackscope://app/index.html') throw new Error('Untrusted request.');
}
async function deviceIdentity() {
  let value='';
  if(process.platform==='win32') {
    const script='(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID';
    value=(await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{timeout:8000,maxBuffer:8192,windowsHide:true})).stdout.trim();
  } else if(process.platform==='darwin') {
    const out=(await run('/usr/sbin/ioreg',['-rd1','-c','IOPlatformExpertDevice'],{timeout:8000,maxBuffer:65536})).stdout;
    value=out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1]??'';
  } else value=(await readFile('/etc/machine-id','utf8')).trim();
  const normalized=value.toLowerCase().replace(/[^a-f0-9]/g,'');
  if(!/^[a-f0-9]{32}$/.test(normalized)||/^0+$|^f+$/.test(normalized)) throw new Error('A usable device identifier was not available. Local analysis remains available without an account.');
  return createHash('sha256').update('stackscope:device:v1:'+process.platform+':'+normalized).digest('hex');
}
app.whenReady().then(async()=>{
  if (!ownsInstance) return;
  const { MAX_REPORT_BYTES } = await import('../shared/limits.mjs');
  await mkdir(app.getPath('userData'), { recursive: true });
  // Diagnostic files are session-only; discard remnants of an interrupted collection.
  const collectionRoot = resolve(app.getPath('userData'), 'collections');
  await rm(collectionRoot, { recursive: true, force: true });
  await mkdir(collectionRoot, { recursive: true, mode: 0o700 });
  const root=resolve(app.getAppPath(),'dist');
  protocol.handle('stackscope',async request=>{
    try {
      const url=new URL(request.url);
      if(url.hostname!=='app'||url.port||request.method!=='GET')return new Response('Forbidden',{status:403});
      if (url.pathname.startsWith('/collected/')) {
        const item = collectedFiles.get(url.pathname.slice('/collected/'.length));
        if (!item) return new Response('Not found', { status: 404 });
        return new Response(Readable.toWeb(createReadStream(item.path)), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(item.bytes), 'Cache-Control': 'no-store' } });
      }
      const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      const target=resolve(root,'.'+pathname);
      if(!target.startsWith(root+sep))return new Response('Forbidden',{status:403});
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(target)]??'application/octet-stream';
      return new Response(await readFile(target),{headers:{'Content-Type':mime,'X-Content-Type-Options':'nosniff'}});
    } catch {return new Response('Not found',{status:404});}
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  ipcMain.handle('stackscope:preferences', event => { trusted(event); return { trayEnabled }; });
  ipcMain.handle('stackscope:tray', async (event, enabled) => {
    trusted(event); if (typeof enabled !== 'boolean') throw new Error('Invalid tray preference.');
    const previous = trayEnabled;
    try { updateTray(enabled); await writeFile(preferencesPath, JSON.stringify({ trayEnabled })); }
    catch (error) { updateTray(previous); throw error; }
    return { trayEnabled };
  });
  ipcMain.handle('stackscope:collect', async (event, options) => {
    trusted(event);
    if (collection) throw new Error('A collection is already running.');
    if (!options || typeof options !== 'object' || Object.keys(options).some(key => !['performance', 'events', 'servicing', 'fullReports'].includes(key) || typeof options[key] !== 'boolean')) throw new Error('Invalid collection options.');
    collection = new AbortController();
    try {
      await releaseCollection();
      collectionDirectory = await mkdtemp(resolve(collectionRoot, 'session-'));
      const result = await collectComputer(collectionDirectory, options, { signal: collection.signal, progress: message => sendEvent({ type: 'progress', message }) });
      const files = result.files.map(item => { const id = randomUUID(); collectedFiles.set(id, item); return { name: item.name, bytes: item.bytes, url: 'stackscope://app/collected/' + id }; });
      return { files, warnings: result.warnings };
    } catch (error) { await releaseCollection(); throw error; }
    finally { collection = null; }
  });
  ipcMain.handle('stackscope:cancel', event => { trusted(event); collection?.abort(); });
  ipcMain.handle('stackscope:release', async event => { trusted(event); if (!collection) await releaseCollection(); });
  ipcMain.handle('stackscope:device',async event=>{trusted(event);return deviceIdentity();});
  ipcMain.handle('stackscope:request',async(event,input)=>{
    trusted(event);
    if(!input||typeof input!=='object')throw new Error('Invalid service request.');
    const method=input.method??'GET', path=input.path;
    if(!['GET','POST','DELETE'].includes(method)||typeof path!=='string'||(!allowedPaths.has(path)&&!/^\/api\/cases\/[a-f0-9]{36}$/.test(path)))throw new Error('Unsupported service request.');
    const body=input.body===undefined?undefined:JSON.stringify(input.body);
    if(body&&Buffer.byteLength(body)>(path === '/api/cases' ? MAX_REPORT_BYTES : 256*1024))throw new Error(path === '/api/cases' ? 'Hosted reports support up to 32 MiB.' : 'Request exceeds 256 KiB.');
    if(input.token!==undefined&&!/^[a-f0-9]{64}$/.test(input.token))throw new Error('Invalid session token.');
    const base=new URL(process.env.STACKSCOPE_SERVICE_URL??'http://127.0.0.1:8787');
    if(base.username||base.password||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw new Error('The service requires HTTPS or loopback HTTP.');
    const response=await fetch(new URL(path,base),{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(input.token?{Authorization:'Bearer '+input.token}:{})},body,redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    return {status:response.status,data};
  });
  function createWindow(){
    window=new BrowserWindow({width:1440,height:960,minWidth:840,minHeight:640,backgroundColor:'#0b1018',title:'StackScope',autoHideMenuBar:true,show:false,icon:resolve(__dirname,'assets','icon.png'),
      webPreferences:{preload:resolve(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.loadURL('stackscope://app/index.html').then(showWindow).catch(startupError);
    window.on('close', event => { if (trayEnabled && !quitting) { event.preventDefault(); window.hide(); } });
    window.webContents.on('render-process-gone', (_event, details) => { if (!quitting) startupError(new Error('The diagnostic window stopped: ' + details.reason)); });
    window.on('closed',()=>{window=null;});
  }
  createWindow();
  try { const preferences = JSON.parse(await readFile(preferencesPath, 'utf8')); updateTray(preferences.trayEnabled === true); } catch { updateTray(false); }
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();else showWindow();});
}).catch(startupError);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
