<p align="center">
  <img src="public/logo.svg" alt="Watermark" width="320">
</p>

<p align="center">
  <a href="https://github.com/kylosarc/watermark/blob/main/docs/index.html"><img src="https://img.shields.io/badge/Docs-Help%20Guide-4cd7f6?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Docs"/></a>
  <a href="https://github.com/kylosarc/watermark"><img src="https://img.shields.io/badge/GitHub-Source-333?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/></a>
  <a href="http://localhost:42069"><img src="https://img.shields.io/badge/Launch-Local%20Dev-4edea3?style=for-the-badge&logo=vite&logoColor=white" alt="Launch Dev"/></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19"/>
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5"/>
  <img src="https://img.shields.io/badge/C2PA-0.15.1-4cd7f6?style=flat-square&logo=contentauthenticityinitiative&logoColor=white" alt="C2PA 0.15.1"/>
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 8"/>
</p>

---

# Watermark

**A local-first provenance and forensic workbench for C2PA Content Credentials, media, documents, and text.**

Watermark lets you inspect what a file claims about its origin and history, verify what can actually be cryptographically verified, examine metadata and content bindings, compare provenance across versions, and investigate AI-generation and watermark signals — entirely in your browser.

**Your files stay on your machine.**

> **A claim is not the same thing as a verification.**

Watermark is designed around that distinction. A C2PA manifest can contain assertions about an asset's origin, creation, modification, or processing history. Watermark helps you examine those assertions, validate the cryptographic relationships that can be validated, and see where the evidence ends.

## Why Watermark?

Digital provenance systems are becoming an increasingly important part of how digital content is identified, attributed, and trusted. But provenance is not a binary question of "authentic" or "fake."

A useful inspection tool needs to let people see:

* what a file contains;
* what a C2PA manifest claims;
* which signatures and content bindings validate;
* whether an issuer is trusted;
* what metadata exists outside the manifest;
* what provenance relationships exist between assets;
* what survives common transformations;
* and what **cannot** be established from the available evidence.

Watermark puts those questions into a single local-first workspace.


## Verification Boundaries

Watermark deliberately distinguishes **claims, cryptographic verification, and truth**.

A successful C2PA verification can establish that relevant cryptographic relationships are intact and, depending on the trust result, that the signer chains to a trusted issuer.

It does **not** independently establish that every factual statement in the manifest is true.

Likewise:

* A valid signature does not make every assertion truthful.
* A trusted issuer does not make every assertion universally correct.
* A missing C2PA manifest does not prove that content is human-made.
* The presence of an AI-related provenance assertion does not by itself establish every detail of how content was created.
* The absence of a detected watermark does not prove that no watermark exists.

Watermark is therefore an **evidence and inspection tool**, not a truth oracle.


## What Watermark Can Do

### 🔐 Verify Provenance

* Discover C2PA Content Credentials
* Validate manifest signatures and content bindings
* Display issuer and certificate information
* Distinguish **Trusted**, **Valid**, **Invalid**, and **Unknown**
* Calculate SHA-256 file digests
* Inspect hard and soft content bindings
* Examine complete manifest JSON

### 🔎 Investigate Provenance

* Explore manifests, assertions, and ingredients
* Examine manifest lineage
* Compare two provenance states with **Provenance Diff**
* Generate structured **Evidence Packs**
* Review file metadata alongside C2PA provenance
* Inspect binary structure and entropy
* Examine what survives common transformations

### 💧 Investigate Watermarks & AI Signals

* Surface watermark-related C2PA assertions
* Surface SynthID-related claims when present
* Inspect C2PA soft-binding information
* Identify C2PA AI-generation source-type assertions
* Compare watermark/provenance survival across transformations

### 🧪 Test & Simulate

* Re-encode media
* Crop images
* Convert formats
* Test whether provenance survives transformations
* Explore common scenarios such as screenshots, email, and social-media processing
* Experiment with trust policies

### 🛠️ Work With Your Files

* Edit selected metadata
* Sanitize metadata
* Compare hashes before and after changes
* Perform provenance-aware image editing
* Extract text from supported documents
* Analyze and transform text
* Produce self-contained trust reports

### 🔒 Local-First Privacy

Files are processed in the browser rather than uploaded to a remote analysis service.

Original files are not overwritten. Processing occurs in memory, with local persistence used for application state and audit information.

## What Watermark Does Not Do

Watermark does not attempt to produce a single universal authenticity score.

It does not claim that:

* a file without C2PA provenance is necessarily inauthentic;
* a file with C2PA provenance is necessarily truthful;
* a valid signature proves the factual accuracy of every assertion;
* an AI detector can reliably determine authorship from text alone;
* the absence of a detected watermark proves that no watermark exists;
* metadata alone establishes provenance.

Instead, Watermark exposes the available evidence and shows which relationships can actually be verified.

This distinction is fundamental to the project.


## What Watermark Does Not Do

Watermark does not attempt to produce a single universal authenticity score.

It does not claim that:

* a file without C2PA provenance is necessarily inauthentic;
* a file with C2PA provenance is necessarily truthful;
* a valid signature proves the factual accuracy of every assertion;
* an AI detector can reliably determine authorship from text alone;
* the absence of a detected watermark proves that no watermark exists;
* metadata alone establishes provenance.

Instead, Watermark exposes the available evidence and shows which relationships can actually be verified.

This distinction is fundamental to the project.


## Run locally

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:42069`.

## Commands

```bash
npm run build
npm run typecheck
npm test
```

## Architecture

```
src/
├── App.tsx              ~1900 lines — Main app, routing, header/footer
├── main.tsx             React entry + ErrorBoundary
├── styles.css           CSS variables, dark/light theme
├── lib/
│   ├── c2pa.ts          C2PA SDK wrapper (v0.15.1 Reader.fromBlob API)
│   ├── verification.ts  Manifest summarization, AI detection, soft binding
│   ├── evidence.ts      EvidenceStatus, Finding, Perspective domain model
│   ├── metadata.ts      EXIF extraction, binary analysis, entropy heatmap, sanitizer
│   ├── harper.ts        Grammar checker (WASM, lazy-loaded)
│   ├── winkNlp.ts       NLP analysis (sentiment, POS, entities)
│   ├── transform.ts     Text stripping, PII redaction, unsloping, homoglyphs
│   ├── extract.ts       Text extraction (PDF, PPTX, DOCX, jschardet)
│   ├── file.ts          Hashing (SHA-256, SHA-1, MD5), format detection
│   ├── persist.ts       localStorage + IndexedDB persistence
│   ├── audit.ts         Session audit trail
│   └── types.ts         Shared TypeScript types
└── features/
    ├── inspector/       BinaryInspector, HashCalculator, MetadataTab, ManifestCard
    ├── provenance/      DiffView, LineageView, ProvenanceGraph, EvidencePanel
    ├── simulator/       SimulatorView (What Would Break? + Survival Matrix)
    ├── playground/      PlaygroundView (Trust Policy rules)
    ├── text/            TextView, TextDetailPanel, NlpDetailPanel, TextTransformPanel
    └── batch/           BatchView (multi-file verification)
```

## Important notes

**This software is under active development.** While we strive for accuracy, results may not always be as expected.

### Text processing limitations

- PDFs with letter-spacing may produce garbled output in grammar features
- Scientific notation, chemical formulas, and technical content may be incorrectly flagged
- Text extraction may lose formatting, embedded images, or complex layouts
- The unsloper is designed for prose and may not work on code or technical docs

### Video and media limitations

- Video files show a poster frame extracted at 10% duration
- Large video files may take longer to process
- Some media formats may not be fully supported by the C2PA SDK

### Your files are safe

**Original documents and media are never overwritten.** All processing happens in memory. Your source files remain completely untouched on disk.

## Verification boundaries

A trusted C2PA result means the SDK validated the manifest signature, content binding, and issuer trust policy. It does not prove that every statement in the manifest is true. A missing manifest does not establish that content is human-made or AI-generated.

## References

- [C2PA technical specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)
- [C2PA JavaScript SDK](https://github.com/contentauth/c2pa-js)
- [Supported C2PA media formats](https://opensource.contentauthenticity.org/docs/c2patool/docs/supported-formats)
- [SynthID overview](https://deepmind.google/technologies/synthid)
- [Harper - Grammar checker](https://github.com/Automattic/harper)
- [wink-nlp - NLP toolkit](https://github.com/winkjs/wink-nlp)
- [exifr - EXIF reader](https://github.com/MikeKovarik/exifr)
- [piexifjs - EXIF writer](https://github.com/hMatoba/piexifjs)
- [picscrub - Metadata scrubber](https://github.com/asher-wood/picscrub)

## License

MIT. See `LICENSE`.
