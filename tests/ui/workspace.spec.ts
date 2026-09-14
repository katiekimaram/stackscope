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
 await expect(page.getByText('92%',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Export report',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByLabel('Report export preview')).toContainText('schemaVersion');
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
