# StackScope

Local-first diagnostic analysis for Windows and macOS reports, with a shared React/TypeScript interface and Electron desktop app.

**Status: v0.2 early preview.** This is not a production-ready security scanner or paid service. Findings show source evidence and next checks; they do not establish malware, root cause, or current system health.

## Start on Windows

Install Node.js 24 LTS and Git, then run in PowerShell:

~~~powershell
git clone https://github.com/katiekimaram/stackscope.git
cd stackscope
npm ci
npm run dev
~~~

Open http://127.0.0.1:5173 and choose **Open sample case**. Synthetic reports pass through the same import pipeline as real files.

~~~powershell
npm run desktop
~~~

This builds the shared interface and launches Electron.

~~~powershell
npm run desktop:dist -- --win nsis --publish never
~~~

This creates a StackScope Windows installer in `release/`. Install that package, then launch **StackScope** from the desktop or Start menu. The installed app does not require Node.js. Do not copy just the executable from `win-unpacked`: it needs its bundled resources. Preview installers are unsigned; production signing and automatic updates are not configured.

### Desktop collection and tray

Choose **Collect this computer → Start collection** to add local reports to the same case used by manual imports. No account is required, and nothing is automatically uploaded.

- **Windows:** hardware, Windows version, installed applications (registry and current-user packages), and running processes. Optional 30-second CPU/memory sampling, the latest 1,000 System and 1,000 Application warnings/errors from seven days, readable CBS/DISM logs, and full MSINFO/DXDIAG exports.
- **macOS:** hardware and installed applications via System Profiler (SPX).
- **Linux:** basic OS, CPU, and memory inventory; import additional reports for other details.

Collection shows progress and can be cancelled. Permission-denied logs, unsupported portions, and collection limits appear as coverage messages; protected paths can remain unknown. Windows collection executes the bundled read-only PowerShell commands without elevation or changes to execution policy. It does not install software, repair Windows, or verify signatures. CPU percentages are measured over time and normalized to total CPU capacity; inventory-only snapshots do not imply measured performance.

Enable **Keep StackScope in the tray when I close the window** for an optional minimal icon menu: Open StackScope, Collect this computer, and Quit StackScope. Closing then hides the window and retains the case. Quit ends the session. The preference survives restart; launching StackScope again restores its existing window.

Collected raw files use a private app session directory and are removed after importing, on normal quit, or at the next startup following an interruption. Imported source files are retained as browser File/Blob references in the current session, while analysis and source paging run in a worker.

### Desktop troubleshooting

Use the complete installer from the successful **Validate StackScope** workflow's `stackscope-windows-preview` artifact, or build from source with the commands above. Supported Windows versions follow the bundled Electron release (Windows 10 or newer).

Startup failures display a StackScope error dialog and write details to `%APPDATA%\StackScope\startup.log`. If a development install reports that Electron is missing, run `node node_modules/electron/install.js` and then `npm run desktop`; check whether your package manager or network prevented Electron's binary download. Retain the exact error text when reporting a failure.

## Optional service

Run npm run server in a second terminal. Development web requests proxy /api to http://127.0.0.1:8787; Electron uses the same service by default. The service stores accounts, community content, and explicitly uploaded reports in stackscope.sqlite.

Create accounts in Electron under **Account & plans**. The official client registers a fingerprint derived from Windows system UUID, macOS platform UUID, or Linux machine ID. Browser users can sign in afterwards. Passwords use salted scrypt; session tokens expire after 24 hours and stay in UI memory, not localStorage.

Set ADMIN_USERNAMES to comma-separated existing usernames, then restart to enable moderation. Descriptions await approval. Votes are separate dimensions for usefulness, performance concerns, and suspicious behavior. One editable vote per user/product/dimension is enforced by the database. Votes never become malware findings.

See .env.example. Node does not automatically load it. To load a private local .env explicitly:

~~~powershell
node --env-file=.env server/index.mjs
~~~

Production requires a stable DEVICE_HASH_SECRET of at least 32 characters. Never commit secrets, SQLite data, or customer logs.

## Import coverage

| Format | Implemented |
| --- | --- |
| MSINFO text / XML .nfo | English text fields; XML categories, Item/Value and software/task rows |
| DXDIAG text / XML | System, adapter, memory, and driver fields |
| SPX XML plist | System-profiler categories, hardware, applications |
| CBS / DISM text | Historical SFC corruption, missing repair source, selected errors |
| WER .wer | Application/path, report type, signature evidence |
| Windows Event XML | Provider-aware selected Windows events, warnings/errors |
| Application logs / stack traces | Exception markers, bounded surrounding frames, error grouping |
| StackScope snapshot JSON | Native collection inventory, process metadata, coverage warnings |
| Performance CSV | Explicit CPU, memory, duration, timestamps, process metadata |

Binary EVTX, ETL, minidumps, binary plist, ZIP, and CAB are rejected. Export to text/XML/CSV or debugger text before import. Full .ips schema parsing, symbol resolution, localized text exports, continuous live monitoring, reputation providers, and complete cross-user application enumeration are future work. MSINFO/DXDIAG do not provide a complete app list or continuous performance measurements.

Every field retains its source. Reports may describe different machines or periods; filter by source before making conclusions. Unknown fields remain unknown.

Limits: 24 files and 2 GiB per case. Text logs stream in 1 MiB chunks up to 1 GiB per file, with no fixed line-count ceiling; single text lines are limited to 1 MiB. XML, JSON snapshots, CSV, and WER support up to 128 MiB per file. XML complexity, 12,000 inventory/process entries, and 500 finding groups remain bounded, with coverage warnings. UTF-8 and UTF-16 are supported. A two-minute inactivity watchdog stops stalled parsers. Source viewing reads 500 lines per page; searches scan the source in a worker and very long displayed lines are shortened.

## Performance CSV

~~~csv
name,pid,cpuPercent,memoryMB,sampleSeconds,path,publisher,version,measuredAt
render-worker.exe,4028,92,1850,60,C:\Program Files\Example\render-worker.exe,Example,2.1,2026-09-14T10:10:00Z
~~~

Required: name,cpuPercent,sampleSeconds. CPU is a 0–100 percentage of total machine capacity averaged over the interval, not an accumulated CPU-time counter or a per-core value. Samples >=80% for >=30 seconds produce review flags. High utilization may be expected. Memory is displayed without inferring a leak.

## Privacy

Imports stay in session memory. Quitting or refreshing loses the case; export JSON to preserve results. Full original logs are not included in reports. The source viewer renders text, never HTML.

Export removes common identifiers by default and previews the exact JSON. Redaction is best effort: custom tokens, IPv6 addresses, arbitrary hostnames, embedded secrets, and other identifiers may remain. Review before sharing. Download JSON stays local. **Save hosted case** explicitly uploads the preview to the configured service. No automatic uploads occur.

Electron uses sandboxing, context isolation, no renderer Node integration, bundled resources, blocked navigation/new windows, allowlisted IPC, and sender validation. Diagnostic text never becomes a command. Desktop registration uses a fixed read-only identity command. Only connect to services you trust.

## Open source and subscriptions

The whole repository uses AGPL-3.0-only, which permits commercial use under its terms. Professional use of the local analyzer does not require a subscription.

The optional service charges for hosted Pro case storage (up to 100 reports/account, 32 MiB per report request). Local analysis and export remain free. Teams, branded reports, comparisons, and support contracts are planned, not delivered.

Stripe integration requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID (a recurring price), and APP_ORIGIN. Test in Stripe test mode first. Deliver customer.subscription.created, updated, and deleted events to /api/billing/webhook. Webhooks verify the raw-body signature, fetch current provider state, and grant Pro only for active/trialing subscriptions with the configured price. Checkout redirects never grant access. Refresh service after returning from Stripe. Electron billing links are copied to open in an external browser.

No real payment credentials or payment activity are included. Production launch still requires secure recovery/device transfer, billing reconciliation, backups, authentication hardening, monitoring, deployment review, and end-to-end Stripe test-mode validation.

## Device and network limits

The service rejects reuse of a registered device fingerprint. This is abuse friction for the official client, not hardware attestation: an open source client can be modified, identifiers can change, and imported reports can describe arbitrary machines.

Registration defaults to three attempts per direct network address per day. Configure REGISTRATIONS_PER_NETWORK_PER_DAY. It does not identify households; shared networks can affect unrelated people. Forwarded headers are not trusted, so a shared reverse proxy needs a deliberate trusted-client-IP strategy before deployment.

Self-service account recovery and device replacement are not implemented; administrator support is required. These limitations must be resolved before selling service.

## Validation and hosting

~~~powershell
npm test
npm run build
npx playwright install chromium
npm run test:ui
~~~

CI installs locked dependencies, runs parser/service/browser checks including imports over 10 MiB and 120,000 lines, builds and installs an unsigned Windows package, and launches the installed executable. Desktop checks cover its parser worker, renderer isolation, tray behavior, actual Windows inventory and CPU collection, and cancellation. No collected machine details are uploaded as test artifacts.

Host dist/ on HTTPS for local-only analysis. Connected features need /api reverse-proxied to the Node service, APP_ORIGIN set to the website origin, and persistent private SQLite storage. The service binds loopback by default and does not serve static files. Set HOST explicitly for private container networks. Electron can use STACKSCOPE_SERVICE_URL for an HTTPS service. Configure your reverse proxy to accept 32 MiB report requests; authentication/community requests remain capped at 256 KiB. The frontend and service must be updated together for these limits.

## Source map

- src/engine.mjs: shared parsers, findings, and redaction
- src/parser.worker.ts: isolated file analysis
- src/App.tsx: diagnostic workspace
- src/ServicePanel.tsx: accounts, community, moderation, plans
- electron/: desktop shell and narrow IPC
- server/: optional persistent API and billing
- tests/: parser, service, and browser checks

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [MSINFO](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msinfo32), [Windows Performance Recorder](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/windows-performance-recorder), [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks), [Open Source Definition](https://opensource.org/osd).
