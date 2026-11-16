# Security

Watermark is a local-first browser application. It has no server component, no
telemetry, and no runtime network calls for analysis. Files and text stay in the
browser.

## Reporting a vulnerability

Please open a private security advisory through GitHub:

<https://github.com/kylosarc/watermark/security/advisories/new>

Do not include credentials, private media, or personal text in a public issue.
A minimal reproduction using synthetic content is enough.

## Scope

Useful reports include:

- a way to make analysis leave the browser;
- a dependency or build step that executes untrusted code;
- a path that silently grants trust or fabricates a hash/verification result;
- a persisted-data or XSS issue in the local UI.

The following are not vulnerabilities by themselves:

- a C2PA manifest that is valid but whose claims are false;
- a missing manifest reported as “no credentials found”;
- heuristic writing findings (clichés, POV candidates, style scores) being
  imperfect. These are labelled as revision prompts, not verdicts.

## Dependency policy

- `npm audit --audit-level=high` runs in CI.
- Dependabot checks npm and GitHub Actions weekly.
- Development dependencies are updated promptly; production dependencies are
  pinned by `package-lock.json` and tested before merge.

## Data handling

- Verification and text analysis run in browser memory and Web Workers.
- Local persistence uses `localStorage` and IndexedDB for app state.
- No file or text is uploaded by the default application path.
- Any future external integration must be explicitly opt-in, public-URL-only,
  clearly labelled, and must never grant permission or trust automatically.
