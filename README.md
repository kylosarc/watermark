<p align="center">
  <img src="public/logo.svg" alt="Watermark" width="320">
</p>

# Watermark

Watermark is a local-first web application for inspecting C2PA Content Credentials and understanding media provenance. The first release verifies media in the browser, computes a SHA-256 digest, distinguishes valid signatures from trusted issuers, and displays manifest lineage without uploading the asset.

## Current scope

- Drag-and-drop image, audio, and video inspection
- C2PA manifest discovery and verification through `@contentauth/c2pa-web`
- Signature algorithm, issuer, claim generator, ingredients, assertions, and validation codes
- File size, MIME type, and SHA-256 display
- Explicit handling for missing, invalid, untrusted, and unsupported credentials
- Browser-only processing with no application backend

## Run locally

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`.

## Commands

```bash
npm run build
npm run typecheck
npm test
```

## Architecture

- `src/App.tsx` contains the drop zone, preview, and result views.
- `src/lib/c2pa.ts` owns SDK initialization and file verification.
- `src/lib/verification.ts` normalizes SDK manifest data into a stable UI model.
- `src/lib/file.ts` contains MIME detection, byte formatting, and SHA-256 utilities.
- `src/lib/types.ts` defines the application verification contract.

The C2PA SDK runs in a Web Worker with its WASM binary loaded as a Vite asset. The app does not currently create or re-sign manifests; editing and signing require a separate key-management and provenance update design.

## Verification boundaries

A trusted C2PA result means the SDK validated the manifest signature, content binding, and issuer trust policy available to the application. It does not prove that every statement in the manifest is true. A missing manifest does not establish that content is human-made or AI-generated.

## Next modules

1. Privacy-safe metadata sanitizer with an explicit field allowlist.
2. Provenance-aware crop, resize, and compression workflow.
3. Local lineage dashboard backed by IndexedDB.
4. AI-detection appeal evidence export.
5. Educational views for C2PA, SynthID, statistical watermarking, and steganalysis.

## References

- [C2PA technical specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)
- [C2PA JavaScript SDK](https://github.com/contentauth/c2pa-js)
- [Supported C2PA media formats](https://opensource.contentauthenticity.org/docs/c2patool/docs/supported-formats)
- [SynthID overview](https://deepmind.google/technologies/synthid)

## License

MIT. See `LICENSE`.
