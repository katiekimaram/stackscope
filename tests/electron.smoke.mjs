import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
const application=await electron.launch({args:['.'],timeout:30000});
try {
  const page=await application.firstWindow();
  await page.getByRole('button',{name:'Open sample case'}).click();
  await page.getByRole('heading',{name:'System-file corruption reported'}).waitFor({timeout:20000});
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal(await page.evaluate(()=>window.stackscope.platform),'win32');
  const preferences=await application.evaluate(({BrowserWindow})=>{
    const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {sandbox:p.sandbox,nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation};
  });
  assert.deepEqual(preferences,{sandbox:true,nodeIntegration:false,contextIsolation:true});
  console.log('Electron smoke passed: bundled UI, parser worker, and renderer isolation.');
} finally {await application.close();}
