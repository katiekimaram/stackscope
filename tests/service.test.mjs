import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createService,verifyStripe } from '../server/app.mjs';
test('accounts, votes, moderation, device reuse and case isolation',async t=>{
 const s=createService({database:':memory:',env:{DEVICE_HASH_SECRET:'test-secret-not-for-production-use',ADMIN_USERNAMES:'moderator',REGISTRATIONS_PER_NETWORK_PER_DAY:'100'}});
 s.server.listen(0,'127.0.0.1');await once(s.server,'listening');t.after(()=>s.close());
 const base='http://127.0.0.1:'+s.server.address().port;
 async function call(path,method='GET',body,token){
   const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
   return {status:r.status,data:await r.json()};
 }
 const register=(username,fingerprint)=>call('/api/auth/register','POST',{username,password:'a-strong-test-password',deviceFingerprint:fingerprint});
 assert.equal((await call('/api/me')).status,401);
 const a=await register('moderator','a'.repeat(64)),b=await register('member','b'.repeat(64));
 assert.equal(a.status,201);assert.equal(b.status,201);
 assert.equal((await register('another','a'.repeat(64))).status,409);
 assert.equal((await call('/api/auth/login','POST',{username:'member',password:'wrong'})).status,401);
 assert.equal((await call('/api/auth/login','POST',{username:'member',password:'a-strong-test-password',deviceFingerprint:'c'.repeat(64)})).status,403);
 const token=a.data.token,other=b.data.token;
 assert.equal((await call('/api/cases','POST',{title:'denied',report:{}},other)).status,403);
 const entry=await call('/api/community','POST',{name:'example.exe',publisher:'Example',version:'1',description:'Exports project files.'},other);
 assert.equal(entry.status,201);
 assert.equal((await call('/api/community')).data.entries[0].descriptions.length,0);
 assert.equal((await call('/api/moderation','GET',undefined,other)).status,403);
 const pending=(await call('/api/moderation','GET',undefined,token)).data.pending;
 assert.equal(pending.length,1);
 await call('/api/moderation','POST',{id:pending[0].id,status:'approved'},token);
 assert.equal((await call('/api/community')).data.entries[0].descriptions[0].body,'Exports project files.');
 const vote={entryId:entry.data.id,dimension:'usefulness',value:1};
 await call('/api/community/vote','POST',vote,other);await call('/api/community/vote','POST',vote,other);
 let votes=(await call('/api/community')).data.entries[0].votes;
 assert.equal(votes[0].voters,1);assert.equal(votes[0].score,1);
 await call('/api/community/vote','POST',{...vote,value:-1},other);
 votes=(await call('/api/community')).data.entries[0].votes;assert.equal(votes[0].score,-1);
 await call('/api/community/vote','POST',{...vote,value:0},other);
 assert.equal((await call('/api/community')).data.entries[0].votes.length,0);
 assert.equal((await call('/api/billing/checkout','POST',{},token)).status,503);
 // A fixture entitlement lets this test exercise storage isolation without making any payment request.
 s.db.prepare('UPDATE users SET pro=1 WHERE id=?').run(a.data.user.id);
 const saved=await call('/api/cases','POST',{title:'Private case',report:{note:'private',evidence:'x'.repeat(400000)}},token);
 assert.equal(saved.status,201);
 assert.equal((await call('/api/cases/'+saved.data.id,'GET',undefined,other)).status,404);
 await call('/api/cases/'+saved.data.id,'DELETE',{},other);
 const restored=await call('/api/cases/'+saved.data.id,'GET',undefined,token);
 assert.equal(restored.status,200);assert.equal(restored.data.report.evidence.length,400000);
 assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 await call('/api/auth/logout','POST',{},other);assert.equal((await call('/api/me','GET',undefined,other)).status,401);
});
test('Stripe signatures reject modified payloads and expired timestamps',()=>{
 const now=Date.now(),timestamp=String(Math.floor(now/1000)),secret='whsec_test',raw=Buffer.from('{"type":"test"}');
 const h=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex'),signature='t='+timestamp+',v1='+h;
 assert.equal(verifyStripe(raw,signature,secret,now),true);
 assert.equal(verifyStripe(Buffer.from('{"type":"modified"}'),signature,secret,now),false);
 assert.equal(verifyStripe(raw,signature,secret,now+600000),false);
 assert.equal(verifyStripe(raw,'t=invalid,v1='+h,secret,now),false);
});
