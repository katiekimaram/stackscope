# Product direction

StackScope helps personal users and support engineers follow diagnostic evidence across reports.

## Next milestones

1. Validate real, consented and anonymized MSINFO, DXDIAG, SPX, CBS, and WER fixtures across locales, schemas, scan boundaries, and capture periods.
2. Add native collectors for installed applications, sustained process measurements, startup impact, signatures, and hashes, with explicit collection controls.
3. Add isolated binary EVTX/minidump parsers and debugger symbol/source-map resolution.
4. Add verified software identity matching, commercially licensed reputation providers, and improved contribution/revision workflows.
5. Harden hosted operations: verified accounts, passkeys/MFA, secure recovery, audited device transfer, abuse handling, backups, billing reconciliation, proxy-aware rate limits, and load tests.
6. Add organizations, team permissions, customer case timelines, historical comparisons, branded PDF reports, and retention policies.
7. Sign/notarize desktop builds, validate macOS packaging, and add signed updates.

## Product boundaries

The local analyzer is AGPLv3 and permits commercial use. Revenue attaches to hosted services. Mandatory payment for all professional use would require a different source-available model; future relicensing also requires respecting contributors' rights.

Device fingerprints are client assertions, not attestation. Network addresses are not household identity. Browser account creation requires initial desktop enrollment in this preview.

No AI provider is configured. Current findings use deterministic, inspectable rules. If AI explanations are added, treat log contents as untrusted data, cite evidence, request explicit consent before external processing, and never silently execute repairs.

Do not advertise antivirus verdicts, automatic repair, live monitoring, complete installed-app enumeration, binary-dump root-cause analysis, teams, or branded reporting as implemented.
