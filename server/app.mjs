import { MAX_REPORT_BYTES } from '../shared/limits.mjs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, createHmac, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const sha = value => createHash('sha256').update(value).digest('hex');
const id = () => randomBytes(18).toString('hex');
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
const str = (v,max=300) => typeof v === 'string' && v.length <= max ? v.trim() : '';
const equal = (a,b) => a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function verifyStripe(raw,signature,secret,now=Date.now()) {
  const fields = String(signature ?? '').split(',').map(v => v.split('='));
  const t = fields.find(([k]) => k === 't')?.[1];
  if (!t || !/^\d+$/.test(t) || Math.abs(now/1000-Number(t)) > 300) return false;
  const expected = createHmac('sha256',secret).update(t+'.').update(raw).digest('hex');
  return fields.some(([k,v]) => k === 'v1' && /^[a-f0-9]{64}$/.test(v ?? '') && equal(v,expected));
}
export function createService(options={}) {
  const env = options.env ?? process.env;
  const db = new DatabaseSync(options.database ?? env.STACKSCOPE_DATABASE ?? 'stackscope.sqlite');
  db.exec([
    'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;',
    'CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,device_hash TEXT UNIQUE NOT NULL,customer TEXT UNIQUE,subscription TEXT,pro INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);',
    'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);',
    'CREATE TABLE IF NOT EXISTS rates(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);',
    'CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,name TEXT NOT NULL,publisher TEXT NOT NULL,version TEXT NOT NULL,created INTEGER NOT NULL);',
    "CREATE TABLE IF NOT EXISTS contributions(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL);",
    'CREATE TABLE IF NOT EXISTS votes(entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,dimension TEXT NOT NULL,value INTEGER NOT NULL,PRIMARY KEY(entry_id,user_id,dimension));',
    'CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,reason TEXT NOT NULL,created INTEGER NOT NULL);',
    'CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,report TEXT NOT NULL,created INTEGER NOT NULL);',
  ].join('\n'));
  let secret = env.DEVICE_HASH_SECRET || db.prepare("SELECT value FROM settings WHERE key='device-secret'").get()?.value;
  if (env.NODE_ENV === 'production' && (!env.DEVICE_HASH_SECRET || env.DEVICE_HASH_SECRET.length < 32)) throw new Error('Production requires DEVICE_HASH_SECRET with at least 32 characters.');
  if (!secret) { secret=randomBytes(32).toString('hex'); db.prepare("INSERT INTO settings VALUES('device-secret',?)").run(secret); }
  const origin=env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
  const keyed=v => createHmac('sha256',secret).update(v).digest('hex');
  const admins=new Set((env.ADMIN_USERNAMES ?? '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
  const publicUser=u=>({id:u.id,username:u.username,pro:!!u.pro,moderator:admins.has(u.username)});
  const billing=!!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID);
  function rate(key,max,ms) {
    const now=Date.now(); db.prepare('DELETE FROM rates WHERE expires < ?').run(now);
    const k=keyed(key), row=db.prepare('SELECT count FROM rates WHERE key=?').get(k);
    if (row && row.count>=max) fail(429,'Too many requests. Please try again later.');
    db.prepare('INSERT INTO rates VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(k,now+ms);
  }
  async function passwordHash(password) {
    const salt=randomBytes(16).toString('hex');
    return salt+':'+(await scrypt(password,salt,64,{N:32768,maxmem:64*1024*1024})).toString('hex');
  }
  async function passwordMatches(password,stored) {
    const [salt,expected]=stored.split(':');
    return equal((await scrypt(password,salt,64,{N:32768,maxmem:64*1024*1024})).toString('hex'),expected);
  }
  function auth(req) {
    const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) fail(401,'Sign in to use this feature.');
    const user=db.prepare('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>?').get(sha(token),Date.now());
    if (!user) fail(401,'Your session expired. Sign in again.'); return user;
  }
  function session(user) {
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    const token=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),user.id,Date.now()+86400000);
    return {token,user:publicUser(user)};
  }
  async function stripe(path,params={},method='POST',key) {
    const response=await fetch('https://api.stripe.com/v1/'+path,{method,
      headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(key?{'Idempotency-Key':key}:{})},
      body:method==='POST'?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok) fail(502,'The billing provider could not complete this request.'); return data;
  }
  async function rawBody(req, limit=256*1024) {
    const chunks=[]; let bytes=0;
    for await(const chunk of req) {bytes+=chunk.length;if(bytes>limit)fail(413,limit===MAX_REPORT_BYTES?'Hosted reports support up to 32 MiB.':'Request exceeds the 256 KiB limit.');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  const server=createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      if(req.headers.origin && req.headers.origin!==origin)fail(403,'Origin is not allowed.');
      if(req.headers.origin===origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');}
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      const route=new URL(req.url,'http://localhost').pathname;
      const network=req.socket.remoteAddress??'unknown';
      rate('all:'+network,240,60000);
      if(req.method==='GET'&&route==='/api/health')return send(200,{status:'ok',billingConfigured:billing,registration:'desktop-device',version:'0.3.0'});
      if(req.method==='POST'&&route==='/api/billing/webhook'){
        if(!billing)fail(503,'Billing is not configured.');
        const raw=await rawBody(req);
        if(!verifyStripe(raw,req.headers['stripe-signature'],env.STRIPE_WEBHOOK_SECRET))fail(400,'Invalid webhook signature.');
        let event;try{event=JSON.parse(raw);}catch{fail(400,'Invalid event.');}
        if(/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)){
          const object=event.data?.object;if(!object?.id||!object?.customer)fail(400,'Missing subscription identity.');
          // Fetch current provider state: delayed and replayed events must not grant stale access.
          const current=await stripe('subscriptions/'+encodeURIComponent(object.id),{},'GET');
          const user=db.prepare('SELECT * FROM users WHERE customer=?').get(String(current.customer));
          if(user){
            const paid=current.items?.data?.some(item=>item.price?.id===env.STRIPE_PRICE_ID);
            const pro=paid&&['active','trialing'].includes(current.status)?1:0;
            if(!user.subscription||user.subscription===current.id||pro)db.prepare('UPDATE users SET subscription=?,pro=? WHERE id=?').run(current.id,pro,user.id);
          }
        }
        return send(200,{received:true});
      }
      if(route==='/api/cases'&&req.method==='POST'&&!auth(req).pro)fail(403,'Hosted case storage requires Pro.');
      let body={};
      if(['POST','DELETE'].includes(req.method)){
        if(!String(req.headers['content-type']??'').startsWith('application/json'))fail(415,'Use application/json.');
        const raw=await rawBody(req,route==='/api/cases'?MAX_REPORT_BYTES:256*1024);try{body=raw.length?JSON.parse(raw):{};}catch{fail(400,'Invalid JSON.');}
        if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'JSON must be an object.');
      }
      if(req.method==='POST'&&route==='/api/auth/register'){
        rate('register:'+network,Number(env.REGISTRATIONS_PER_NETWORK_PER_DAY??3),86400000);
        const username=str(body.username,32).toLowerCase(),password=body.password;
        if(!/^[a-z0-9_.-]{3,32}$/.test(username)||typeof password!=='string'||password.length<12||password.length>128)fail(400,'Use a 3–32 character username and a 12–128 character password.');
        if(!/^[a-f0-9]{64}$/.test(body.deviceFingerprint??''))fail(400,'Create your account in the desktop app to register its device.');
        const deviceHash=keyed('device:'+body.deviceFingerprint),value=await passwordHash(password);
        try{db.prepare('INSERT INTO users(id,username,password,device_hash,created) VALUES(?,?,?,?,?)').run(id(),username,value,deviceHash,Date.now());}
        catch(e){if(/UNIQUE constraint/.test(e.message))fail(409,'This username or device is already registered.');throw e;}
        return send(201,session(db.prepare('SELECT * FROM users WHERE username=?').get(username)));
      }
      if(req.method==='POST'&&route==='/api/auth/login'){
        rate('login:'+network,20,15*60000);
        const username=str(body.username,32).toLowerCase(),password=body.password;
        if(typeof password!=='string'||password.length>128)fail(400,'Invalid sign-in input.');
        const user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
        if(!user){await passwordHash(password);fail(401,'Incorrect username or password.');}
        if(!await passwordMatches(password,user.password))fail(401,'Incorrect username or password.');
        if(body.deviceFingerprint&&keyed('device:'+body.deviceFingerprint)!==user.device_hash)fail(403,'This account is registered to another desktop. Device transfer requires administrator support.');
        return send(200,session(user));
      }
      if(req.method==='GET'&&route==='/api/community'){
        const q=str(new URL(req.url,'http://localhost').searchParams.get('q'),100);
        const entries=db.prepare('SELECT * FROM entries WHERE name LIKE ? OR publisher LIKE ? ORDER BY created DESC LIMIT 100').all('%'+q+'%','%'+q+'%');
        return send(200,{entries:entries.map(entry=>({...entry,
          descriptions:db.prepare("SELECT contributions.id,body,username,contributions.created FROM contributions JOIN users ON users.id=contributions.user_id WHERE entry_id=? AND status='approved' ORDER BY contributions.created DESC LIMIT 5").all(entry.id),
          votes:db.prepare('SELECT dimension,SUM(value) AS score,COUNT(*) AS voters FROM votes WHERE entry_id=? GROUP BY dimension').all(entry.id),
        }))});
      }
      const user=auth(req);
      if(req.method==='GET'&&route==='/api/me')return send(200,{user:publicUser(user),billingConfigured:billing});
      if(req.method==='POST'&&route==='/api/auth/logout'){db.prepare('DELETE FROM sessions WHERE token=?').run(sha(req.headers.authorization.slice(7)));return send(200,{ok:true});}
      if(req.method==='DELETE'&&route==='/api/me'){
        if(user.subscription)fail(409,'Cancel your subscription and contact the administrator to complete account deletion.');
        db.prepare('DELETE FROM users WHERE id=?').run(user.id);return send(200,{ok:true});
      }
      if(req.method==='POST'&&route==='/api/community'){
        rate('contribution:'+user.id,20,3600000);
        const name=str(body.name,200),publisher=str(body.publisher,200),version=str(body.version,100),description=str(body.description,600);
        if(!name||!description)fail(400,'Name and description are required; descriptions may have up to 600 characters.');
        const entryId=sha(JSON.stringify([name.toLowerCase(),publisher.toLowerCase(),version.toLowerCase()]));
        db.prepare('INSERT OR IGNORE INTO entries VALUES(?,?,?,?,?)').run(entryId,name,publisher,version,Date.now());
        db.prepare('INSERT INTO contributions(id,entry_id,user_id,body,created) VALUES(?,?,?,?,?)').run(id(),entryId,user.id,description,Date.now());
        return send(201,{id:entryId,status:'pending',message:'Description submitted for moderation.'});
      }
      if(req.method==='POST'&&route==='/api/community/vote'){
        if(!['usefulness','performance','suspicious'].includes(body.dimension)||![-1,0,1].includes(body.value))fail(400,'Invalid vote.');
        if(!db.prepare('SELECT id FROM entries WHERE id=?').get(str(body.entryId,64)))fail(404,'Entry not found.');
        if(body.value===0)db.prepare('DELETE FROM votes WHERE entry_id=? AND user_id=? AND dimension=?').run(body.entryId,user.id,body.dimension);
        else db.prepare('INSERT INTO votes VALUES(?,?,?,?) ON CONFLICT(entry_id,user_id,dimension) DO UPDATE SET value=excluded.value').run(body.entryId,user.id,body.dimension,body.value);
        return send(200,{ok:true});
      }
      if(req.method==='POST'&&route==='/api/community/report'){
        rate('report:'+user.id,10,3600000);
        const reason=str(body.reason,600);
        if(!reason||!db.prepare('SELECT id FROM entries WHERE id=?').get(str(body.entryId,64)))fail(400,'A valid entry and reason are required.');
        db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(id(),body.entryId,user.id,reason,Date.now());return send(201,{ok:true});
      }
      if(route.startsWith('/api/moderation')){
        if(!admins.has(user.username))fail(403,'Moderator access required.');
        if(req.method==='GET')return send(200,{pending:db.prepare("SELECT contributions.*,entries.name,users.username FROM contributions JOIN entries ON entries.id=entry_id JOIN users ON users.id=user_id WHERE status='pending' ORDER BY contributions.created LIMIT 100").all(),reports:db.prepare('SELECT * FROM reports ORDER BY created DESC LIMIT 100').all()});
        if(req.method==='POST'){
          if(!['approved','rejected'].includes(body.status))fail(400,'Invalid moderation status.');
          db.prepare('UPDATE contributions SET status=? WHERE id=?').run(body.status,str(body.id,64));return send(200,{ok:true});
        }
      }
      if(req.method==='POST'&&route==='/api/billing/checkout'){
        if(!billing)fail(503,'Billing is not configured. No payment was requested.');
        if(user.pro)fail(409,'Your subscription is already active.');
        let customer=user.customer;
        if(!customer){customer=(await stripe('customers',{'metadata[stackscope_user]':user.id},'POST','customer:'+user.id)).id;db.prepare('UPDATE users SET customer=? WHERE id=?').run(customer,user.id);}
        const checkout=await stripe('checkout/sessions',{mode:'subscription',customer,'line_items[0][price]':env.STRIPE_PRICE_ID,'line_items[0][quantity]':'1',success_url:origin+'/?billing=return',cancel_url:origin+'/?billing=cancel','subscription_data[metadata][stackscope_user]':user.id},'POST','checkout:'+user.id+':'+Math.floor(Date.now()/1800000));
        return send(200,{url:checkout.url});
      }
      if(req.method==='POST'&&route==='/api/billing/portal'){
        if(!billing||!user.customer)fail(503,'A billing account is not available.');
        return send(200,{url:(await stripe('billing_portal/sessions',{customer:user.customer,return_url:origin})).url});
      }
      if(route==='/api/cases'&&req.method==='GET')return send(200,{cases:db.prepare('SELECT id,title,created FROM cases WHERE user_id=? ORDER BY created DESC LIMIT 100').all(user.id)});
      if(route.startsWith('/api/cases/')&&req.method==='GET'){
        const item=db.prepare('SELECT * FROM cases WHERE id=? AND user_id=?').get(route.split('/').at(-1),user.id);
        if(!item)fail(404,'Case not found.');return send(200,{...item,report:JSON.parse(item.report)});
      }
      if(route.startsWith('/api/cases/')&&req.method==='DELETE'){db.prepare('DELETE FROM cases WHERE id=? AND user_id=?').run(route.split('/').at(-1),user.id);return send(200,{ok:true});}
      if(route==='/api/cases'&&req.method==='POST'){
        if(!user.pro)fail(403,'An active Pro subscription is required for hosted case storage. Local analysis and export remain available.');
        const title=str(body.title,160);if(!title||!body.report||typeof body.report!=='object')fail(400,'A title and report are required.');
        if(db.prepare('SELECT COUNT(*) AS n FROM cases WHERE user_id=?').get(user.id).n>=100)fail(409,'The 100-case storage limit has been reached.');
        const caseId=id();db.prepare('INSERT INTO cases VALUES(?,?,?,?,?)').run(caseId,user.id,title,JSON.stringify(body.report),Date.now());return send(201,{id:caseId});
      }
      fail(404,'Endpoint not found.');
    } catch(error){send(error.status??500,{error:error.status?error.message:'The service could not complete the request.'});}
  });
  server.requestTimeout=20000;server.headersTimeout=15000;
  return {server,db,close:()=>new Promise(resolve=>server.close(()=>{db.close();resolve();}))};
}
