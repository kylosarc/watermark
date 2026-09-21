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

A local-first forensic web application for inspecting C2PA Content Credentials, analyzing media provenance, and understanding AI-generation signals. Everything runs in your browser — no data ever leaves your machine.

## Features

### Core Verification
- **C2PA Manifest Discovery** — automatic detection and verification via `@contentauth/c2pa-web` v0.15.1
- **Trust Status** — Trusted / Valid / Invalid / Unknown with issuer chain details
- **Signature Algorithm & Timestamp** — which algorithm signed, when, by whom
- **Content Binding** — SHA-256 hard binding verification
- **Soft Binding Detection** — C2PA 2.2+ invisible content fingerprints for provenance recovery
- **AI Generation Detection** — flags `trainedAlgorithmicMedia`, `compositeWithTrainedAlgorithmicMedia`, etc.
- **Watermark / SynthID Claims** — surfaces embedded watermark assertions from manifests

### Inspector Views
- **Manifest Overview** — identity, cryptographic checks, trust summary, verification summary card (screenshot-friendly)
- **Assertions & Ingredients** — searchable assertion list with category badges (binding, signature, provenance, technical)
- **Cryptography** — signature validation, certificate chain status
- **Raw JSON** — full C2PA manifest dump for debugging
- **File Metadata** — EXIF, camera info, GPS, copyright, AI detection, plus tabs for:
  - **Binary Inspector** — hex view + structure tree + entropy heatmap
  - **Hash Calculator** — SHA-256, SHA-1, MD5 with copy buttons
  - **Metadata Editor** — edit EXIF fields in-place
  - **Metadata Sanitizer** — strip metadata by preset (minimal, social, professional, forensic, privacy)

### Text Analysis
- **Text Analysis** — word count, sentence count, AI-confidence scoring, vocabulary richness, burstiness
- **NLP Analysis** — sentiment, POS distribution, named entities, writing style metrics (all in unified table)
- **Grammar Checker** — Harper.js WASM-based grammar and spelling suggestions
- **Text Transformer** — strip PII, HTML, markdown, normalize whitespace, detect homoglyphs
- **Unsloper** — remove AI-generated writing patterns ("In today's fast-paced world...")
- **Clipboard Monitor** — auto-verifies images pasted via Ctrl+V

### Batch & Comparison
- **Batch Report** — verify multiple files at once, CSV/JSON export
- **Provenance Diff** — side-by-side comparison of two manifest versions
- **Evidence Pack** — structured JSON export with full verification data

### Simulation & Testing
- **What Would Break?** — simulate transformations (re-encode, crop, format convert) and check if C2PA survives
- **What-If Scenario Builder** — 10 real-world scenarios (screenshot, social upload, email, etc.)
- **Watermark Survival Matrix** — which operations preserve/destroy which watermark types (C2PA, EXIF, Soft Binding, SynthID, Stable Signature)
- **Trust Policy Playground** — build custom policies (require assertions, reject algorithms, trust levels)

### Editing
- **Edit with Provenance** — canvas-based crop with before/after SHA-256 comparison, privacy crop option
- **Trust Report** — one-click self-contained HTML report for sharing with clients
- **Provenance-aware image editing** — warns when operations will invalidate content binding

### Cross-Cutting
- **Dark/Light Theme** — toggle in footer, persists to localStorage
- **Keyboard Shortcuts** — `?` cheat sheet, `Ctrl+Shift+C` copy hash, arrows navigate
- **Audit Trail** — timestamped log of all actions, exportable as JSON
- **Cross-Tab Persistence** — files stored in IndexedDB, survive tab switches
- **Entropy Heatmap** — color-coded byte-range visualization in binary inspector
- **Video Poster Frames** — auto-extracts thumbnail from video files

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

- `src/App.tsx` — all views and components (~6300 lines)
- `src/lib/c2pa.ts` — C2PA SDK wrapper (v0.15.1 `Reader.fromBlob()` API)
- `src/lib/verification.ts` — manifest summarization, AI detection, soft binding, watermark claims
- `src/lib/metadata.ts` — EXIF extraction, binary analysis, entropy heatmap, sanitizer, editor, piexifjs/picscrub
- `src/lib/harper.ts` — grammar checker (WASM, lazy-loaded)
- `src/lib/winkNlp.ts` — NLP analysis (sentiment, POS, entities)
- `src/lib/transform.ts` — text stripping, PII redaction, unsloping, homoglyph detection
- `src/lib/extract.ts` — text extraction from PDF, PPTX, DOCX (with jschardet encoding detection)
- `src/lib/file.ts` — hashing (SHA-256, SHA-1, MD5), format detection
- `src/lib/persist.ts` — localStorage + IndexedDB persistence
- `src/lib/audit.ts` — session audit trail

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
