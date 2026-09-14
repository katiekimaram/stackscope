const { app, BrowserWindow, protocol, session, ipcMain } = require('electron');
const { readFile } = require('node:fs/promises');
const { resolve, sep, extname } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const run = promisify(execFile);
app.enableSandbox();
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
  const root=resolve(app.getAppPath(),'dist');
  protocol.handle('stackscope',async request=>{
    try {
      const url=new URL(request.url);
      if(url.hostname!=='app'||url.port||request.method!=='GET')return new Response('Forbidden',{status:403});
      const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      const target=resolve(root,'.'+pathname);
      if(!target.startsWith(root+sep))return new Response('Forbidden',{status:403});
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(target)]??'application/octet-stream';
      return new Response(await readFile(target),{headers:{'Content-Type':mime,'X-Content-Type-Options':'nosniff'}});
    } catch {return new Response('Not found',{status:404});}
  });
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  ipcMain.handle('stackscope:device',async event=>{trusted(event);return deviceIdentity();});
  ipcMain.handle('stackscope:request',async(event,input)=>{
    trusted(event);
    if(!input||typeof input!=='object')throw new Error('Invalid service request.');
    const method=input.method??'GET', path=input.path;
    if(!['GET','POST','DELETE'].includes(method)||typeof path!=='string'||(!allowedPaths.has(path)&&!/^\/api\/cases\/[a-f0-9]{36}$/.test(path)))throw new Error('Unsupported service request.');
    const body=input.body===undefined?undefined:JSON.stringify(input.body);
    if(body&&Buffer.byteLength(body)>256*1024)throw new Error('Request exceeds 256 KiB.');
    if(input.token!==undefined&&!/^[a-f0-9]{64}$/.test(input.token))throw new Error('Invalid session token.');
    const base=new URL(process.env.STACKSCOPE_SERVICE_URL??'http://127.0.0.1:8787');
    if(base.username||base.password||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw new Error('The service requires HTTPS or loopback HTTP.');
    const response=await fetch(new URL(path,base),{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(input.token?{Authorization:'Bearer '+input.token}:{})},body,redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    return {status:response.status,data};
  });
  function createWindow(){
    window=new BrowserWindow({width:1440,height:960,minWidth:840,minHeight:640,backgroundColor:'#0b1018',title:'StackScope',autoHideMenuBar:true,
      webPreferences:{preload:resolve(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.loadURL('stackscope://app/index.html');
    window.on('closed',()=>{window=null;});
  }
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
