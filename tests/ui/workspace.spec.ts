import { test,expect } from '@playwright/test';
test('sample case follows actual import, inventory, evidence and export flows',async({page},testInfo)=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Diagnostic overview'})).toBeVisible();
 await page.getByRole('button',{name:'Open sample case'}).click();
 await expect(page.getByText('SAMPLE CASE · Synthetic reports',{exact:false})).toBeVisible();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('diagnostic-workspace.png')});
 await page.getByRole('button',{name:'Hardware',exact:true}).click();
 await expect(page.getByText('AMD Ryzen 7 7800X3D',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Software & processes',exact:true}).click();
 await expect(page.getByText('render-worker.exe',{exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:/^92%/})).toBeVisible();
 await page.getByRole('button',{name:'Export report',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByLabel('Report export preview')).toHaveValue(/schemaVersion/);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON'}).click();
 expect((await download).suggestedFilename()).toBe('stackscope-report.json');
 await page.getByRole('button',{name:'Close review your report'}).click();
 await page.getByRole('button',{name:'Source logs',exact:true}).click();
 await expect(page.getByRole('region',{name:'Source log lines'})).toContainText('System Information');
 expect(failures).toEqual([]);
});
test('untrusted imported text is rendered without executing it',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Diagnostic files').setInputFiles({name:'attack.log',mimeType:'text/plain',buffer:Buffer.from('Unhandled exception: <img src=x onerror="window.injected=true">')});
 await expect(page.getByRole('heading',{name:'Exception or stack trace recorded'})).toBeVisible();
 await page.getByRole('button',{name:'Source logs',exact:true}).click();
 await expect(page.getByRole('region',{name:'Source log lines'})).toContainText('<img');
 expect(await page.evaluate(()=>('injected' in window))).toBe(false);
});
test('mobile layout keeps primary controls available',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await expect(page.getByRole('button',{name:'Import files',exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('hosted save transmits the reviewed redacted title and report',async({page})=>{
 let uploaded:any;
 const user={id:'test-user',username:'reviewer',pro:true,moderator:false};
 await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   let value:any={};
   if(path==='/api/health')value={status:'ok',billingConfigured:false};
   else if(path==='/api/auth/login')value={token:'a'.repeat(64),user};
   else if(path==='/api/me')value={user,billingConfigured:false};
   else if(path==='/api/cases'&&route.request().method()==='POST'){uploaded=route.request().postDataJSON();value={id:'case'};}
   else if(path==='/api/cases')value={cases:[]};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Open sample case'}).click();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
 await page.getByRole('button',{name:'Community & account',exact:true}).click();
 await page.getByLabel('Username',{exact:true}).fill('reviewer');
 await page.getByLabel('Password',{exact:true}).fill('test-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).last().click();
 await expect(page.getByText('Signed in as',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await page.getByRole('button',{name:'Export report',exact:true}).click();
 await page.getByLabel('Case title',{exact:true}).fill('Contact alice@example.com');
 const preview=JSON.parse(await page.getByLabel('Report export preview').inputValue());
 await page.getByRole('button',{name:'Save hosted case (Pro)',exact:true}).click();
 await expect(page.getByText('Report saved to your hosted account.')).toBeVisible();
 expect(uploaded.title).toBe('Contact [EMAIL]');
 expect(uploaded.report).toEqual(preview);
 expect(JSON.stringify(uploaded)).not.toContain('alice@example.com');
});

test('large log import reaches end-of-file findings and opens the matching source line', async ({page}) => {
 await page.goto('/');
 const log=('INFO routine background operation '.repeat(3)+'\n').repeat(125000)+'[SR] Cannot repair member file final-entry.dll\n';
 await page.getByLabel('Diagnostic files').setInputFiles({name:'CBS.log',mimeType:'text/plain',buffer:Buffer.from(log)});
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible({timeout:30000});
 await page.getByText('Source evidence',{exact:true}).click();
 await page.getByRole('button',{name:/CBS.log · Line 125001/}).click();
 await expect(page.getByRole('region',{name:'Source log lines'})).toContainText('final-entry.dll');
 await expect(page.locator('.log-line.highlight')).toContainText('125001');
 await page.getByLabel('Search source lines').fill('final-entry.dll');
 await expect(page.locator('.log-line')).toHaveCount(1);
});

test('case files and removal controls remain available at laptop window widths', async ({page}) => {
 await page.setViewportSize({width:1024,height:768});
 await page.goto('/');
 await page.getByRole('button',{name:'Open sample case'}).click();
 await expect(page.getByRole('heading',{name:'Case files',exact:true})).toBeVisible();
 await expect(page.locator('.source-item').first().getByRole('button').first()).toBeVisible();
 await expect(page.locator('.source-item').first().getByRole('button',{name:/Remove /})).toBeVisible();
});

test('one sign-in covers community votes, reports, billing and returning from diagnostics', async ({page}, testInfo) => {
 const user={id:'user-one',username:'support.engineer',pro:true,moderator:false};
 const token='a'.repeat(64);let logins=0;const authorized:string[]=[];
 const entry={id:'entry-one',name:'render-worker.exe',publisher:'Example Software',version:'2.1',descriptions:[{id:'description-one',body:'Renders project files in the background. Activity depends on the size of the project.',username:'case.reviewer'}],votes:[{dimension:'usefulness',score:3,voters:3}]};
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let data:any={};
  if(path==='/api/auth/login'){logins++;data={token,user};}
  else if(path==='/api/health')data={status:'ok',billingConfigured:true};
  else if(path==='/api/community')data={entries:[entry]};
  else if(path==='/api/me')data={user,billingConfigured:true};
  else if(path==='/api/cases')data={cases:[{id:'case-one',title:'Display driver investigation',created:1789473600000}]};
  else if(path==='/api/community/vote'){authorized.push(request.headers().authorization);data={ok:true};}
  else if(path==='/api/billing/portal'){authorized.push(request.headers().authorization);data={url:'https://billing.stripe.com/p/session/test'};}
  else if(path==='/api/auth/logout')data={ok:true};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Open sample case'}).click();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
 await page.getByRole('button',{name:'Community & account',exact:true}).click();
 await expect(page.getByRole('form',{name:'StackScope sign in'})).toHaveCount(1);
 await page.getByLabel('Username',{exact:true}).fill('support.engineer');
 await page.getByLabel('Password',{exact:true}).fill('test-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByText('Signed in as support.engineer')).toBeVisible();
 await page.getByRole('button',{name:'Agree',exact:true}).first().click();
 await page.getByRole('tab',{name:'Saved reports',exact:true}).click();
 await expect(page.getByText('Display driver investigation',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Username',{exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'Account',exact:true}).click();
 await page.getByRole('button',{name:'Manage subscription',exact:true}).click();
 await expect(page.getByLabel('Secure billing URL')).toHaveValue('https://billing.stripe.com/p/session/test');
 await page.getByRole('button',{name:'Hardware',exact:true}).click();
 await expect(page.getByText('AMD Ryzen 7 7800X3D',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Community & account',exact:true}).click();
 await expect(page.getByText('Signed in as support.engineer')).toBeVisible();
 await page.getByRole('tab',{name:'Community',exact:true}).click();
 await expect(page.getByRole('button',{name:'Refresh service'})).toBeEnabled();
 await page.screenshot({path:testInfo.outputPath('community-account.png')});
 expect(logins).toBe(1);expect(authorized).toEqual(['Bearer '+token,'Bearer '+token]);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('form',{name:'StackScope sign in'})).toHaveCount(1);
 await page.getByRole('tab',{name:'Account',exact:true}).click();
 await expect(page.getByRole('button',{name:'View checkout'})).toBeDisabled();
 await page.getByRole('tab',{name:'Saved reports',exact:true}).click();
 await expect(page.getByText('Display driver investigation',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
});

test('expired sessions return to the single login without losing local reports',async({page})=>{
 let expired=false;
 const user={id:'user-two',username:'reviewer',pro:true,moderator:false};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const data=path==='/api/auth/login'?{token:'b'.repeat(64),user}:path==='/api/health'?{status:'ok',billingConfigured:false}:path==='/api/community'?{entries:[]}:path==='/api/me'?(expired?{error:'Your session expired.'}:{user}):{cases:[]};
  await route.fulfill({status:path==='/api/me'&&expired?401:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/');await page.getByRole('button',{name:'Open sample case'}).click();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
 await page.getByRole('button',{name:'Community & account',exact:true}).click();
 await page.getByLabel('Username',{exact:true}).fill('reviewer');await page.getByLabel('Password',{exact:true}).fill('test-password');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByText('Signed in as reviewer')).toBeVisible();
 await expect(page.getByRole('button',{name:'Refresh service'})).toBeEnabled();expired=true;
 await page.getByRole('button',{name:'Refresh service'}).click();
 await expect(page.getByRole('form',{name:'StackScope sign in'})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('Your session expired');
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
});

test('desktop-style panes, preferences and keyboard import work at laptop width',async({page},testInfo)=>{
 await page.setViewportSize({width:1024,height:768});await page.goto('/');
 await expect(page.locator('.statusbar')).toBeInViewport();
 await page.getByRole('button',{name:'Preferences',exact:true}).click();
 await page.getByLabel('Appearance').selectOption('light');
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 const picker=page.waitForEvent('filechooser');await page.keyboard.press('Control+o');
 await (await picker).setFiles({name:'app.log',mimeType:'text/plain',buffer:Buffer.from('Unhandled exception: sample application failure')});
 await expect(page.getByRole('heading',{name:'Exception or stack trace recorded'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('light-workspace.png')});
 await page.getByRole('button',{name:'Source logs',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Case files',exact:true})).toBeVisible();
 await expect(page.locator('.log-view')).toBeInViewport();
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
