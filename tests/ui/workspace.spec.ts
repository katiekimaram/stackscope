import { test,expect } from '@playwright/test';
test('sample case follows actual import, inventory, evidence and export flows',async({page})=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Diagnostic overview'})).toBeVisible();
 await page.getByRole('button',{name:'Open sample case'}).click();
 await expect(page.getByText('SAMPLE CASE · Synthetic reports',{exact:false})).toBeVisible();
 await expect(page.getByRole('heading',{name:'System-file corruption reported'})).toBeVisible();
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
 await page.getByRole('button',{name:'Close export'}).click();
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
 await page.getByRole('button',{name:'Account & plans',exact:true}).click();
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
