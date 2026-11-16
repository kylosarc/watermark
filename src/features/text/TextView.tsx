import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Clipboard,
  Copy,
  Diff,
  Download,
  EyeOff,
  FileText,
  Fingerprint,
  Info,
  Loader2,
  PenLine,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { verifyFile } from '../../lib/c2pa';
import { extractTextFromFile, TEXT_ACCEPT, detectFormat } from '../../lib/extract';
import {
  applyStripper, STRIPPER_DEFAULTS, STRIPPER_PRESETS,
  detectUnslopPatterns, applyUnslop,
  normalizePdfText,
  type StripperOptions, type UnslopPattern,
} from '../../lib/transform';
import { harperLint, harperFixAll } from '../../lib/harper';
import type { HarperLint } from '../../lib/harper';
import { POS_LABELS, getWinkStatus } from '../../lib/winkNlp';
import type { VerificationResult } from '../../lib/types';
import {
  analyzeText, enrichWithNlp, createEmptyAnalysis,
  type TextAnalysis, type TextItem,
} from '../../lib/textAnalysis';
import {
  buildTextAnalysisExport, buildTextSummaryCSV, buildPhraseCSV, buildNlpCSV,
  buildCompleteTextReport, buildCompleteTextReportCSV,
} from '../../lib/textExport';
import type { NgramEntry } from '../../lib/ngrams';
import { UnicodeDetailPanel } from './UnicodePanel';
import { WritingPanel } from './WritingPanel';
import { ProviderStatusPanel } from './ProviderStatusPanel';
import { sha256Hex } from '../../lib/file';
import {
  storeTextItems, getStoredTextItems,
  storeStripperOpts, getStoredStripperOpts,
  storeSimResults, getStoredSimResults,
} from '../../lib/persist';

/* ── Text Analysis View ────────────────────────────────────────── */

const EXAMPLE_TEXT = [
  "In today's fast-paced world, teams must leverage a holistic approach to unlock the full potential of their work.",
  `This is a real example with a zero-width\u200Bspace, a word\u2060joiner, a\u00A0non-breaking space and a narrow\u202Fspace.`,
  `It also contains a bidi override \u202E and a Unicode tag payload: ${String.fromCodePoint(0xE0041, 0xE0042, 0xE0043)}.`,
  'The model was trained on a large corpus. The model was trained to be helpful. The model was trained for safety.',
  'It is important to note that this paragraph is intentionally repetitive. It is important to note that repetition is detectable.',
].join('\n\n');

let textIdCounter = 0;

export function TextView({ showToast }: { showToast: (msg: string) => void }) {
  const [items, setItems] = useState<TextItem[]>(() => {
    const stored = getStoredTextItems();
    if (stored.length === 0) return [];
    // Update textIdCounter to avoid collisions
    const maxId = Math.max(...stored.map((s) => s.id ?? 0), 0);
    textIdCounter = maxId;
    // Restore items from storage (without File objects, analysis is null — will re-analyze)
    return stored.map((s) => {
      const source = (s.source as 'paste' | 'file') ?? 'paste';
      return {
        id: s.id ?? 0,
        content: s.content ?? '',
        source,
        fileName: source === 'paste' ? null : (s.fileName ?? 'restored'),
        sha256: s.sha256 ?? '',
        format: s.format ?? 'text',
        c2paResult: null,
        analysis: null,
        status: 'done' as const,
      };
    });
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Text simulator state
  const [textSimResults, setTextSimResults] = useState<{ name: string; description: string; hash: string; preserved: boolean }[]>(() => getStoredSimResults());
  const [textSimRunning, setTextSimRunning] = useState(false);

  // Persistence: save text simulator results
  useEffect(() => {
    if (textSimResults.length > 0) storeSimResults(textSimResults);
  }, [textSimResults]);

  // Sub-tab for detail panel
  type TextSubTab = 'analysis' | 'nlp' | 'writing' | 'unicode' | 'providers' | 'transform';
  const [subTab, setSubTab] = useState<TextSubTab>('analysis');

  // Persistence: save text items when they change
  useEffect(() => {
    if (items.length > 0) {
      storeTextItems(items.map(it => ({
        id: it.id,
        content: it.content,
        source: it.source,
        fileName: it.fileName,
        sha256: it.sha256,
        format: it.format,
      })));
    }
  }, [items]);

  // Re-analyze restored items that have null analysis
  useEffect(() => {
    const needsAnalysis = items.filter(it => it.status === 'done' && it.analysis === null);
    if (needsAnalysis.length === 0) return;
    (async () => {
      for (const it of needsAnalysis) {
        try {
          const enriched = await enrichWithNlp(analyzeText(it.content), it.content);
          setItems(prev => prev.map(p => p.id === it.id ? { ...p, analysis: enriched } : p));
        } catch { /* skip */ }
      }
    })();
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrow key navigation via custom event
  useEffect(() => {
    function handleNavigate(e: Event) {
      const { direction } = (e as CustomEvent).detail;
      const doneItems = items.filter(it => it.status === 'done');
      if (doneItems.length === 0) return;
      const currentIdx = doneItems.findIndex(it => it.id === selectedId);
      const nextIdx = direction === 'down'
        ? Math.min(currentIdx + 1, doneItems.length - 1)
        : Math.max(currentIdx - 1, 0);
      if (nextIdx >= 0 && nextIdx < doneItems.length) {
        setSelectedId(doneItems[nextIdx].id);
      }
    }
    window.addEventListener('watermark:text-navigate', handleNavigate);
    return () => window.removeEventListener('watermark:text-navigate', handleNavigate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedId]);

  // Handle file upload from Inspect mode
  useEffect(() => {
    function handleTextFileUpload(e: Event) {
      const { file } = (e as CustomEvent).detail;
      if (file instanceof File) {
        void processFiles([file]);
      }
    }
    window.addEventListener('watermark:text-file-upload', handleTextFileUpload);
    return () => window.removeEventListener('watermark:text-file-upload', handleTextFileUpload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedItem = items.find((it) => it.id === selectedId) ?? null;

  async function hashText(text: string): Promise<string> {
    return sha256Hex(new Blob([text], { type: 'text/plain' }));
  }

  async function processOne(
    text: string,
    source: 'file' | 'paste',
    fileName: string | null,
    sourceHash?: string,
  ): Promise<TextItem> {
    const id = ++textIdCounter;

    // For uploaded files, hash the original bytes so the digest matches other
    // tools. Pasted text is hashed as UTF-8 content.
    let sha256 = sourceHash ?? '';
    if (!sha256) {
      try {
        sha256 = await hashText(text);
      } catch {
        sha256 = '';
      }
    }

    let analysis: TextAnalysis | null = null;
    try {
      analysis = await enrichWithNlp(analyzeText(text), text);
    } catch {
      // Analysis failed — return item without analysis
    }

    let c2paResult: VerificationResult | null = null;
    if (source === 'file' && fileName) {
      try {
        const blob = new Blob([text], { type: 'text/plain' });
        const file = new File([blob], fileName, { type: 'text/plain' });
        c2paResult = await verifyFile(file);
      } catch {
        // Text files may not have C2PA
      }
    }

    return { id, source, fileName, content: text, c2paResult, sha256, analysis, status: 'done', format: detectFormat(fileName ?? '') };
  }

  async function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setIsProcessing(true);

    const placeholders: TextItem[] = fileArray.map((f) => ({
      id: ++textIdCounter,
      source: 'file' as const,
      fileName: f.name,
      content: '',
      c2paResult: null,
      sha256: '',
      analysis: null,
      status: 'pending' as const,
      format: detectFormat(f.name),
    }));

    setItems((prev) => [...prev, ...placeholders]);

    // Process sequentially so progress updates are visible
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const ph = placeholders[i];

      // Mark as analyzing
      setItems((prev) => prev.map((it) => it.id === ph.id ? { ...it, status: 'analyzing' } : it));

      try {
        const [extracted, sourceHash] = await Promise.all([
          extractTextFromFile(file),
          sha256Hex(file).catch(() => ''),
        ]);
        const result = await processOne(extracted.text, 'file', file.name, sourceHash);
        setItems((prev) => prev.map((it) => it.id === ph.id ? { ...result } : it));
      } catch {
        setItems((prev) => prev.map((it) => it.id === ph.id ? { ...it, status: 'error' as const } : it));
      }
    }

    setIsProcessing(false);
    showToast(`${fileArray.length} file${fileArray.length > 1 ? 's' : ''} analyzed`);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    void processFiles(files);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    void processFiles(files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    dropZoneRef.current?.classList.add('drag-over');
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) dropZoneRef.current?.classList.remove('drag-over');
  }

  async function handlePasteAnalysis() {
    if (!pasteText.trim()) return;
    setIsProcessing(true);
    const result = await processOne(pasteText, 'paste', null);
    result.format = 'text';
    setItems((prev) => [...prev, result]);
    setPasteText('');
    setIsProcessing(false);
    showToast('Pasted text analyzed');
  }

  function removeItem(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function clearAll() {
    setItems([]);
    setSelectedId(null);
    setPasteText('');
    setTextSimResults([]);
    localStorage.removeItem('wm:textItems');
    showToast('Cleared');
  }

  function baseExportName() {
    if (items.length !== 1) return 'batch';
    const name = items[0]?.fileName ?? 'paste';
    return name.replace(/\.[^.]+$/, '') || 'paste';
  }

  function downloadText(content: string, mime: string, filename: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    if (items.length === 0) return;
    try {
      const report = buildTextAnalysisExport(items);
      downloadText(
        JSON.stringify(report, null, 2),
        'application/json',
        `watermark-text-analysis-full-${baseExportName()}.json`,
      );
      showToast(`Full analysis exported (${items.length} item${items.length > 1 ? 's' : ''})`);
    } catch (err) {
      showToast(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  function exportTextCSV() {
    if (items.length === 0) return;
    downloadText(
      buildTextSummaryCSV(items),
      'text/csv',
      `watermark-text-summary-${baseExportName()}.csv`,
    );
    showToast('Summary CSV exported');
  }

  function exportPhraseCSV() {
    if (items.length === 0) return;
    downloadText(
      buildPhraseCSV(items),
      'text/csv',
      `watermark-text-phrases-${baseExportName()}.csv`,
    );
    showToast('Phrase CSV exported');
  }

  function exportNlpCSV() {
    if (items.length === 0) return;
    downloadText(
      buildNlpCSV(items),
      'text/csv',
      `watermark-text-nlp-${baseExportName()}.csv`,
    );
    showToast('NLP CSV exported');
  }

  function exportCompleteReport(scopeItems: TextItem[], format: 'txt' | 'csv') {
    if (scopeItems.length === 0) return;
    const rawBase = scopeItems.length === 1
      ? (scopeItems[0].fileName ?? 'pasted').replace(/\.[^.]+$/, '')
      : `all-${scopeItems.length}`;
    const base = rawBase.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'text';
    const countLabel = `${scopeItems.length} file${scopeItems.length === 1 ? '' : 's'}`;

    if (format === 'txt') {
      downloadText(
        buildCompleteTextReport(scopeItems),
        'text/plain;charset=utf-8',
        `watermark-text-report-${base}.txt`,
      );
      showToast(`Complete text report exported (${countLabel})`);
    } else {
      downloadText(
        buildCompleteTextReportCSV(scopeItems),
        'text/csv;charset=utf-8',
        `watermark-text-report-${base}.csv`,
      );
      showToast(`Complete CSV report exported (${countLabel})`);
    }

    setExportOpen(false);
  }

  function loadExample() {
    setPasteText(EXAMPLE_TEXT);
    showToast('Example loaded — click Analyze Text');
  }

  async function addCleanedText(text: string, fileName: string) {
    setIsProcessing(true);
    try {
      const result = await processOne(text, 'paste', fileName);
      setItems((prev) => [...prev, result]);
      setSelectedId(result.id);
      setSubTab('analysis');
      showToast('Cleaned text added as a new item');
    } catch {
      showToast('Could not add cleaned text');
    } finally {
      setIsProcessing(false);
    }
  }

  async function runTextSimulations() {
    const item = selectedItem;
    if (!item?.content) return;
    setTextSimRunning(true);
    setTextSimResults([]);

    const originalHash = item.sha256;
    const ops: { name: string; description: string; transform: (t: string) => string }[] = [
      { name: 'Line Endings (LF → CRLF)', description: 'Convert Unix to Windows line endings', transform: (t) => t.replace(/\n/g, '\r\n') },
      { name: 'Line Endings (CRLF → LF)', description: 'Convert Windows to Unix line endings', transform: (t) => t.replace(/\r\n/g, '\n') },
      { name: 'Strip Trailing Whitespace', description: 'Remove trailing spaces/tabs per line', transform: (t) => t.split('\n').map((l) => l.trimEnd()).join('\n') },
      { name: 'Add Trailing Newline', description: 'Ensure file ends with newline', transform: (t) => t.endsWith('\n') ? t : t + '\n' },
      { name: 'Remove Trailing Newline', description: 'Strip final newline character', transform: (t) => t.replace(/\n$/, '') },
      { name: 'Unicode NFC → NFD', description: 'Decompose composed characters', transform: (t) => t.normalize('NFD') },
      { name: 'Unicode NFD → NFC', description: 'Recompose decomposed characters', transform: (t) => t.normalize('NFC') },
      { name: 'Lowercase All', description: 'Convert entire text to lowercase', transform: (t) => t.toLowerCase() },
      { name: 'Uppercase All', description: 'Convert entire text to uppercase', transform: (t) => t.toUpperCase() },
      { name: 'Add BOM', description: 'Prepend UTF-8 Byte Order Mark', transform: (t) => '\uFEFF' + t },
      { name: 'Remove BOM', description: 'Strip Byte Order Mark if present', transform: (t) => t.replace(/^\uFEFF/, '') },
      { name: 'Collapse Whitespace', description: 'Replace multiple spaces with single', transform: (t) => t.replace(/ {2,}/g, ' ') },
      { name: 'Add Header Line', description: 'Prepend a metadata header line', transform: (t) => '# Processed Document\n---\n' + t },
      { name: 'Truncate 10%', description: 'Remove last 10% of characters', transform: (t) => t.slice(0, Math.floor(t.length * 0.9)) },
      { name: 'Swap Lines', description: 'Reverse line order', transform: (t) => t.split('\n').reverse().join('\n') },
      { name: 'Insert Line Numbers', description: 'Prepend line numbers to each line', transform: (t) => t.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n') },
    ];

    const results: typeof textSimResults = [];
    for (const op of ops) {
      try {
        const transformed = op.transform(item.content);
        const hash = await hashText(transformed);
        results.push({ name: op.name, description: op.description, hash, preserved: hash === originalHash });
      } catch (err) {
        results.push({ name: op.name, description: op.description, hash: '', preserved: false });
      }
      setTextSimResults([...results]);
    }

    setTextSimRunning(false);
    showToast('Text simulation complete');
  }

  function aiConfidenceColor(c: number) {
    if (c <= 30) return 'var(--color-tertiary)';
    if (c <= 60) return '#f59e0b';
    return '#f43f5e';
  }

  function aiConfidenceLabel(c: number) {
    if (c <= 20) return 'Likely human';
    if (c <= 40) return 'Possibly human';
    if (c <= 60) return 'Uncertain';
    if (c <= 80) return 'Possibly AI';
    return 'Likely AI';
  }

  const doneItems = items.filter((it) => it.status === 'done' && it.analysis);
  const isIdle = items.length === 0;

  return (
    <main className="txt-view">
      <div className="txt-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Text Analysis</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Drop text files or paste content to analyze provenance, integrity, hidden Unicode,
            word pairs, phrases, and AI-generation signals.
            {items.length > 1 && <span style={{ marginLeft: 8, color: 'var(--color-primary)', fontWeight: 600 }}>{items.length} files loaded</span>}
          </p>
        </div>
        {items.length > 0 && (
          <div className="txt-actions">
            <button className="action-tactile button-ghost" type="button" onClick={exportAll} disabled={doneItems.length === 0} title="Complete JSON export: analysis, NLP, n-grams, hidden Unicode scan, C2PA and methodology">
              <Download size={15} /> Export Full JSON
            </button>
            <button
              className="action-tactile button-secondary"
              type="button"
              onClick={() => setExportOpen(true)}
              disabled={doneItems.length === 0}
              title="Export the complete analysis as a flat text report or tidy CSV, for one file or all files"
            >
              <Download size={15} /> Complete TXT / CSV
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={exportTextCSV} disabled={doneItems.length === 0}>
              <Download size={15} /> Summary CSV
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={exportPhraseCSV} disabled={doneItems.length === 0}>
              <Download size={15} /> Phrases CSV
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={exportNlpCSV} disabled={doneItems.length === 0}>
              <Download size={15} /> NLP CSV
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
              <Upload size={15} /> Add Files
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={clearAll}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
        )}
      </div>

      {isIdle ? (
        <>
          {/* File Drop */}
          <div
            ref={dropZoneRef}
            className="txt-drop"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="txt-drop-inner">
              <Upload size={36} style={{ color: 'var(--color-outline)' }} />
              <strong>Drop text files</strong>
              <span>.txt, .md, .json, .html, .csv, .xml, .py, .ts, .js, .go, .rs, .pdf, .pptx, .docx — multiple files supported</span>
            </div>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept={TEXT_ACCEPT} multiple onChange={handleFileInput} />
          </div>

          <div className="txt-divider"><span>or</span></div>

          {/* Paste Area */}
          <div className="txt-paste">
            <textarea
              className="txt-paste-input"
              placeholder="Paste text content here..."
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
            />
            <button
              className="action-tactile button-primary"
              type="button"
              onClick={handlePasteAnalysis}
              disabled={!pasteText.trim() || isProcessing}
            >
              <Sparkles size={16} /> Analyze Text
            </button>
            <button
              className="action-tactile button-ghost"
              type="button"
              onClick={loadExample}
              disabled={isProcessing}
            >
              <FileText size={15} /> Try an example
            </button>
          </div>

          <details className="txt-idle-providers">
            <summary>
              <ShieldCheck size={15} /> What can actually be verified? Provider status
            </summary>
            <ProviderStatusPanel compact />
          </details>
        </>
      ) : (
        <>
          {/* Loading bar */}
          {isProcessing && (
            <div className="txt-progress">
              <RefreshCw size={16} className="spin" />
              <span>Processing files...</span>
            </div>
          )}

          {/* Batch file list (always visible when items exist) */}
          <div className="txt-batch">
            {/* Add more button at top of list */}
            <div
              className="txt-drop txt-drop-inline"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="txt-drop-inner">
                <Upload size={18} style={{ color: 'var(--color-outline)' }} />
                <strong>Add more files</strong>
                <span>Drop or click — multiple files supported</span>
              </div>
              <input ref={fileInputRef} className="visually-hidden" type="file" accept={TEXT_ACCEPT} multiple onChange={handleFileInput} />
            </div>

            <div className="txt-batch-list">
              {items.map((it) => (
                <div
                  key={it.id}
                  className={`txt-batch-item ${selectedId === it.id ? 'selected' : ''} ${it.status}`}
                >
                  <div className="txt-batch-item-main" onClick={() => setSelectedId(it.id)}>
                    <FileText size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    <span className="txt-batch-item-name">{it.source === 'file' ? it.fileName : 'Pasted text'}</span>
                    {it.format && it.format !== 'text' && (
                      <span className="txt-batch-item-format">{it.format.toUpperCase()}</span>
                    )}
                    {it.status === 'pending' && <span className="txt-batch-item-status pending">Queued</span>}
                    {it.status === 'analyzing' && <span className="txt-batch-item-status analyzing"><RefreshCw size={12} className="spin" /> Analyzing</span>}
                    {it.status === 'done' && it.analysis && (
                      <>
                        <span className="txt-batch-item-badge" style={{ color: aiConfidenceColor(it.analysis.aiConfidence) }} title="Style heuristic only — not a watermark detector">
                          AI {it.analysis.aiConfidence}%
                        </span>
                        {it.analysis.hiddenSignalCount > 0 && (
                          <span className="txt-batch-item-badge unicode" title="Hidden Unicode code points found by the deterministic scan">
                            Unicode {it.analysis.hiddenSignalCount}
                          </span>
                        )}
                        <span className="txt-batch-item-meta">{it.analysis.wordCount.toLocaleString()} words</span>
                      </>
                    )}
                    {it.status === 'error' && <span className="txt-batch-item-status error">Error</span>}
                  </div>
                    <div className="txt-batch-item-actions">
                      {it.status === 'done' && (
                        <>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'analysis' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('analysis'); }}
                            title="View AI detection, readability stats, vocabulary analysis, and C2PA status"
                          >
                            <Info size={13} /> Analysis
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'nlp' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('nlp'); }}
                            title="NLP analysis: sentiment, POS distribution, named entities, writing style"
                          >
                            <BookOpen size={13} /> NLP
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'writing' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('writing'); }}
                            title="Writing analysis: POV, clichés, echoes, tics, frequencies and figurative-language candidates"
                          >
                            <PenLine size={13} /> Writing
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'unicode' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('unicode'); }}
                            title="Deterministic hidden Unicode scan with code points and positions"
                          >
                            <EyeOff size={13} /> Hidden
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'providers' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('providers'); }}
                            title="What providers watermark and what can actually be verified"
                          >
                            <ShieldCheck size={13} /> Providers
                          </button>
                          <button
                            className={`txt-batch-item-btn ${selectedId === it.id && subTab === 'transform' ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(it.id); setSubTab('transform'); }}
                            title="Strip formatting, redact PII, unslop AI text, or fix grammar with Harper"
                          >
                            <Sparkles size={13} /> Strip / Unslop
                          </button>
                        </>
                      )}
                    <button
                      className="txt-batch-item-remove"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                      title="Remove"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail panel for selected item */}
          {selectedItem && selectedItem.status === 'done' && (
            <>
              {subTab === 'analysis' ? (
                <TextDetailPanel
                  item={selectedItem}
                  aiConfidenceColor={aiConfidenceColor}
                  aiConfidenceLabel={aiConfidenceLabel}
                  textSimResults={textSimResults}
                  textSimRunning={textSimRunning}
                  runTextSimulations={runTextSimulations}
                  onOpenUnicode={() => setSubTab('unicode')}
                  onOpenProviders={() => setSubTab('providers')}
                  onExportPhrases={exportPhraseCSV}
                />
              ) : subTab === 'nlp' ? (
                <NlpDetailPanel item={selectedItem} showToast={showToast} />
              ) : subTab === 'writing' ? (
                <WritingPanel
                  item={selectedItem}
                  onOptionsChange={(options) => setItems((prev) => prev.map((it) => (
                    it.id === selectedItem.id ? { ...it, ...options } : it
                  )))}
                />
              ) : subTab === 'unicode' ? (
                <UnicodeDetailPanel
                  item={selectedItem}
                  showToast={showToast}
                  onAddCleaned={addCleanedText}
                  onOpenTransform={() => setSubTab('transform')}
                />
              ) : subTab === 'providers' ? (
                <ProviderStatusPanel item={selectedItem} />
              ) : (
                <TextTransformPanel inputText={selectedItem.content} format={selectedItem.format} showToast={showToast} />
              )}
            </>
          )}

          {/* Summary when no item selected but multiple exist */}
          {!selectedItem && doneItems.length > 1 && (
            <div className="txt-results txt-batch-summary">
              <h3>Batch Summary</h3>
              <div className="txt-stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="txt-stat"><span>Total Files</span><strong>{doneItems.length}</strong></div>
                <div className="txt-stat"><span>Total Words</span><strong>{doneItems.reduce((s, it) => s + (it.analysis?.wordCount ?? 0), 0).toLocaleString()}</strong></div>
                <div className="txt-stat">
                  <span>Avg AI Score</span>
                  <strong style={{ color: aiConfidenceColor(doneItems.reduce((s, it) => s + (it.analysis?.aiConfidence ?? 0), 0) / doneItems.length) }}>
                    {(doneItems.reduce((s, it) => s + (it.analysis?.aiConfidence ?? 0), 0) / doneItems.length).toFixed(0)}%
                  </strong>
                </div>
                <div className="txt-stat">
                  <span>C2PA Found</span>
                  <strong>{doneItems.filter((it) => it.c2paResult?.status === 'ready').length}/{doneItems.length}</strong>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {exportOpen && (
        <CompleteReportDialog
          items={doneItems}
          selectedId={selectedId}
          onClose={() => setExportOpen(false)}
          onExport={exportCompleteReport}
        />
      )}
    </main>
  );
}

/* ── Complete Report Export Dialog ───────────────────────────── */

function CompleteReportDialog({
  items,
  selectedId,
  onClose,
  onExport,
}: {
  items: TextItem[];
  selectedId: number | null;
  onClose: () => void;
  onExport: (items: TextItem[], format: 'txt' | 'csv') => void;
}) {
  const initialScope = selectedId !== null && items.some((item) => item.id === selectedId)
    ? selectedId
    : 'all';
  const [scope, setScope] = useState<number | 'all'>(initialScope);
  const [format, setFormat] = useState<'txt' | 'csv'>('txt');

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const chosen = scope === 'all'
    ? items
    : items.filter((item) => item.id === scope);
  const chosenLabel = scope === 'all'
    ? `${items.length} file${items.length === 1 ? '' : 's'}`
    : (chosen[0]?.fileName ?? 'Pasted text');

  function itemLabel(item: TextItem): string {
    const name = item.fileName ?? 'Pasted text';
    const words = item.analysis?.wordCount;
    return words !== undefined ? `${name} — ${words.toLocaleString()} words` : name;
  }

  return (
    <div className="txt-export-backdrop" role="presentation" onClick={onClose}>
      <div
        className="txt-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="txt-export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="txt-export-head">
          <div>
            <h2 id="txt-export-title">Export complete text analysis</h2>
            <p>
              Every metric, style signal, n-gram, hidden-Unicode finding, NLP result,
              and C2PA summary. Choose one file or all analyzed files.
            </p>
          </div>
          <button className="txt-export-close" type="button" onClick={onClose} aria-label="Close export dialog">
            <X size={16} />
          </button>
        </div>

        <label className="txt-export-field">
          <span>Scope</span>
          <select
            value={scope === 'all' ? 'all' : String(scope)}
            onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All analyzed files ({items.length})</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>{itemLabel(item)}</option>
            ))}
          </select>
        </label>

        <fieldset className="txt-export-formats">
          <legend>Format</legend>
          <label className={format === 'txt' ? 'selected' : ''}>
            <input
              type="radio"
              name="txt-export-format"
              value="txt"
              checked={format === 'txt'}
              onChange={() => setFormat('txt')}
            />
            <span>
              <strong>Flat text (.txt)</strong>
              <small>Human-readable report with one section per analysis area.</small>
            </span>
          </label>
          <label className={format === 'csv' ? 'selected' : ''}>
            <input
              type="radio"
              name="txt-export-format"
              value="csv"
              checked={format === 'csv'}
              onChange={() => setFormat('csv')}
            />
            <span>
              <strong>Tidy CSV (.csv)</strong>
              <small>One data point per row, including every n-gram and Unicode finding.</small>
            </span>
          </label>
        </fieldset>

        <p className="txt-export-note">
          Exporting <strong>{chosenLabel}</strong>. Style scores are heuristics, not watermark
          detection. A missing signal is not proof that a watermark is absent.
        </p>

        <div className="txt-export-actions">
          <button className="action-tactile button-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="action-tactile button-primary"
            type="button"
            onClick={() => onExport(chosen, format)}
            disabled={chosen.length === 0}
            autoFocus
          >
            <Download size={15} /> Export {format === 'txt' ? 'TXT' : 'CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── N-gram / Phrase Section ──────────────────────────────────── */

function NgramChips({
  title,
  entries,
  empty,
}: {
  title: string;
  entries: NgramEntry[];
  empty: string;
}) {
  return (
    <div className="txt-ngram-col">
      <h4>
        {title}
        <span>{entries.length}</span>
      </h4>
      {entries.length === 0 ? (
        <p className="txt-ngram-empty">{empty}</p>
      ) : (
        <div className="txt-ngram-chips">
          {entries.map((entry, index) => (
            <div
              key={`${entry.phrase}-${index}`}
              className="txt-ngram-chip"
              title={`${entry.count} occurrence${entry.count === 1 ? '' : 's'}`}
            >
              <span>{entry.phrase}</span>
              <strong>{entry.count}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NgramSection({
  analysis,
  onExportPhrases,
}: {
  analysis: TextAnalysis;
  onExportPhrases: () => void;
}) {
  const ngrams = analysis.ngrams;
  if (!ngrams || ngrams.levels.length === 0) return null;

  return (
    <div className="txt-ngrams">
      <div className="txt-ngram-header">
        <div>
          <h3>Word Pairs &amp; Phrases</h3>
          <p>
            Counted within sentence boundaries. Stop-word-heavy glue is filtered out of the
            phrase lists; the raw level totals still include every n-gram.
          </p>
        </div>
        <button className="action-tactile button-ghost" type="button" onClick={onExportPhrases}>
          <Download size={14} /> Phrases CSV
        </button>
      </div>

      <div className="txt-ngram-levels">
        {ngrams.levels.map((level) => (
          <div key={level.n} className="txt-ngram-level">
            <span>{level.label}</span>
            <strong>{level.unique.toLocaleString()}</strong>
            <span>
              {level.total.toLocaleString()} total · {level.repeated.toLocaleString()} repeated
            </span>
            <div className="txt-ngram-bar">
              <div style={{ width: `${Math.min(100, level.repetitionRate)}%` }} />
            </div>
            <span className="txt-ngram-rate">{level.repetitionRate.toFixed(1)}% repeat</span>
          </div>
        ))}
      </div>

      <div className="txt-ngram-columns">
        <NgramChips
          title="Top word pairs"
          entries={ngrams.wordPairs}
          empty="No word pairs found."
        />
        <NgramChips
          title="Repeated phrases (3–5 words)"
          entries={ngrams.topPhrases}
          empty="No repeated 3–5 word phrases found."
        />
      </div>

      {ngrams.longestRepeatedPhrase && (
        <div className="txt-ngram-longest">
          <span>Longest repeated phrase</span>
          <strong>“{ngrams.longestRepeatedPhrase.phrase}”</strong>
          <span>
            ×{ngrams.longestRepeatedPhrase.count} · {ngrams.longestRepeatedPhrase.words.length} words
          </span>
        </div>
      )}

      <details className="txt-ngram-details">
        <summary>More n-gram detail (trigrams, 4-grams, 5-grams)</summary>
        <div className="txt-ngram-columns">
          <NgramChips title="Top trigrams" entries={ngrams.trigrams} empty="No trigrams." />
          <NgramChips title="Top 4-grams" entries={ngrams.fourGrams} empty="No 4-grams." />
          <NgramChips title="Top 5-grams" entries={ngrams.fiveGrams} empty="No 5-grams." />
        </div>
      </details>

      {ngrams.truncated && (
        <p className="txt-ngram-note">
          N-gram analysis was capped for a very large document; counts are partial.
        </p>
      )}
    </div>
  );
}

/* ── Text Detail Panel (shown when a single text item is selected) ── */

function TextDetailPanel({
  item,
  aiConfidenceColor,
  aiConfidenceLabel,
  textSimResults,
  textSimRunning,
  runTextSimulations,
  onOpenUnicode,
  onOpenProviders,
  onExportPhrases,
}: {
  item: TextItem;
  aiConfidenceColor: (c: number) => string;
  aiConfidenceLabel: (c: number) => string;
  textSimResults: { name: string; description: string; hash: string; preserved: boolean }[];
  textSimRunning: boolean;
  runTextSimulations: () => void;
  onOpenUnicode: () => void;
  onOpenProviders: () => void;
  onExportPhrases: () => void;
}) {
  // Analysis may be null for persisted items — compute from content
  const a = item.analysis ?? (() => {
    try {
      return analyzeText(item.content);
    } catch {
      return createEmptyAnalysis();
    }
  })();

  return (
    <div className="txt-results">
      {/* Source Info */}
      <div className="txt-source">
        <div className="txt-source-info">
          <FileText size={18} style={{ color: 'var(--color-primary)' }} />
          <span>{item.source === 'file' ? item.fileName : 'Pasted text'}</span>
        </div>
        <div className="txt-source-actions">
          <button className="action-tactile button-ghost" type="button" onClick={onOpenProviders}>
            <ShieldCheck size={14} /> What can be verified?
          </button>
          <div className="txt-hash" title={item.sha256}>
            <Fingerprint size={14} />
            <span>{item.sha256.slice(0, 16)}…</span>
          </div>
        </div>
      </div>

      {/* C2PA Status */}
      {item.c2paResult && (
        <div className={`txt-c2pa ${item.c2paResult.status === 'ready' ? 'has-c2pa' : 'no-c2pa'}`}>
          {item.c2paResult.status === 'ready' ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
          <div>
            <strong>{item.c2paResult.status === 'ready' ? 'C2PA Manifest Found' : 'No C2PA Manifest'}</strong>
            <span>{item.c2paResult.validationState}</span>
          </div>
        </div>
      )}

      {/* AI Confidence */}
      <div className="txt-ai">
        <div className="txt-ai-header">
          <Sparkles size={18} style={{ color: aiConfidenceColor(a.aiConfidence) }} />
          <div>
            <strong>Style Heuristic (experimental)</strong>
            <span>{aiConfidenceLabel(a.aiConfidence)} · not a watermark detector</span>
          </div>
          <strong className="txt-ai-score" style={{ color: aiConfidenceColor(a.aiConfidence) }}>{a.aiConfidence}%</strong>
        </div>
        <div className="txt-ai-bar">
          <div className="txt-ai-fill" style={{ width: `${a.aiConfidence}%`, background: aiConfidenceColor(a.aiConfidence) }} />
        </div>
        {a.aiSignals.length > 0 && (
          <div className="txt-ai-signals">
            {a.aiSignals.map((sig, i) => (
              <div key={i} className="txt-ai-signal">
                <AlertTriangle size={13} />
                <span>{sig}</span>
              </div>
            ))}
          </div>
        )}
        <p className="txt-ai-disclaimer">
          This score looks at writing style. It cannot detect Claude or SynthID text watermarks,
          and a low score does not prove human authorship. See “What can be verified?” for the
          provider-level checks.
        </p>
      </div>

      {a.hiddenSignalCount > 0 && (
        <button className="txt-unicode-alert" type="button" onClick={onOpenUnicode}>
          <EyeOff size={18} />
          <div>
            <strong>{a.hiddenSignalCount} hidden Unicode signal{a.hiddenSignalCount === 1 ? '' : 's'}</strong>
            <span>
              Zero-width, look-alike spaces, directional controls or tag characters found. Inspect
              exact code points and positions.
            </span>
          </div>
          <span className="txt-unicode-alert-action">Inspect →</span>
        </button>
      )}

      {/* Stats Grid */}
      <div className="txt-stats">
        <h3>Text Statistics</h3>
        <div className="txt-stats-grid">
          <div className="txt-stat"><span>Characters</span><strong>{a.charCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Words</span><strong>{a.wordCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Sentences</span><strong>{a.sentenceCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Paragraphs</span><strong>{a.paragraphCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Lines</span><strong>{a.lineCount.toLocaleString()}</strong></div>
          <div className="txt-stat"><span>Avg Word Length</span><strong>{a.avgWordLength.toFixed(1)}</strong></div>
          <div className="txt-stat"><span>Avg Sentence Length</span><strong>{a.avgSentenceLength.toFixed(1)} words</strong></div>
          <div className="txt-stat"><span>Vocabulary Richness</span><strong>{(a.vocabularyRichness * 100).toFixed(1)}%</strong></div>
        </div>
      </div>

      {/* Readability Metrics */}
      <div className="txt-metrics">
        <h3>Readability Metrics</h3>
        <div className="txt-metrics-grid">
          <div className="txt-metric">
            <span>Burstiness</span>
            <div className="txt-metric-bar">
              <div className="txt-metric-fill" style={{ width: `${a.burstiness}%`, background: a.burstiness > 50 ? 'var(--color-tertiary)' : '#f59e0b' }} />
            </div>
            <span className="txt-metric-val">{a.burstiness}/100</span>
          </div>
          <div className="txt-metric">
            <span>Sentence Uniformity</span>
            <div className="txt-metric-bar">
              <div className="txt-metric-fill" style={{ width: `${a.sentenceUniformity}%`, background: a.sentenceUniformity > 70 ? '#f59e0b' : 'var(--color-tertiary)' }} />
            </div>
            <span className="txt-metric-val">{a.sentenceUniformity}/100</span>
          </div>
          <div className="txt-metric">
            <span>Repetition</span>
            <div className="txt-metric-bar">
              <div className="txt-metric-fill" style={{ width: `${Math.min(100, a.repetitionScore)}%`, background: a.repetitionScore > 5 ? '#f43f5e' : 'var(--color-tertiary)' }} />
            </div>
            <span className="txt-metric-val">{a.repetitionScore.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Top Words */}
      {a.topWords.length > 0 && (
        <div className="txt-topwords">
          <h3>Top Words</h3>
          <div className="txt-topwords-list">
            {a.topWords.map(([word, count]) => (
              <div key={word} className="txt-topword">
                <span className="txt-topword-word">{word}</span>
                <span className="txt-topword-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Word Pairs & Phrases */}
      <NgramSection analysis={a} onExportPhrases={onExportPhrases} />

      {/* What Would Break? Text Simulator */}
      <div className="txt-simulator">
        <div className="txt-sim-header">
          <h3>What Would Break This Text?</h3>
          <button
            className="action-tactile button-ghost"
            type="button"
            onClick={runTextSimulations}
            disabled={textSimRunning || item.content.length === 0}
          >
            {textSimRunning ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
            {textSimRunning ? 'Running...' : 'Run Tests'}
          </button>
        </div>

        {textSimResults.length > 0 && (
          <>
            <div className="txt-sim-summary">
              <div className="txt-sim-stat preserved">
                <CheckCircle2 size={14} />
                <strong>{textSimResults.filter((r) => r.preserved).length}</strong>
                <span>Preserved</span>
              </div>
              <div className="txt-sim-stat broken">
                <AlertTriangle size={14} />
                <strong>{textSimResults.filter((r) => !r.preserved).length}</strong>
                <span>Changed</span>
              </div>
            </div>

            <div className="txt-sim-grid">
              {textSimResults.map((r) => (
                <div key={r.name} className={`txt-sim-card ${r.preserved ? 'preserved' : 'broken'}`}>
                  <div className="txt-sim-card-status">
                    {r.preserved ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  </div>
                  <div className="txt-sim-card-info">
                    <span className="txt-sim-card-name">{r.name}</span>
                    <span className="txt-sim-card-desc">{r.description}</span>
                    <span className="txt-sim-card-hash" title={r.hash}>SHA-256: {r.hash.slice(0, 12)}…</span>
                  </div>
                  <span className={`txt-sim-badge ${r.preserved ? 'preserved' : 'broken'}`}>
                    {r.preserved ? 'Same' : 'Different'}
                  </span>
                </div>
              ))}
            </div>

            {/* Export buttons for text sim results */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="action-tactile button-ghost" type="button" onClick={() => {
                const json = JSON.stringify(textSimResults, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'text-simulation-results.json'; a.click(); URL.revokeObjectURL(url);
              }}>
                <Download size={14} /> JSON
              </button>
              <button className="action-tactile button-ghost" type="button" onClick={() => {
                const headers = ['Operation', 'Description', 'SHA-256', 'Preserved'];
                const rows = textSimResults.map(r => [r.name, r.description, r.hash, r.preserved ? 'Yes' : 'No']);
                const csv = [headers, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'text-simulation-results.csv'; a.click(); URL.revokeObjectURL(url);
              }}>
                <Download size={14} /> CSV
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── NLP Detail Panel (POS, Entities, Sentiment) ────────────────── */

function NlpDetailPanel({ item, showToast }: { item: TextItem; showToast: (msg: string) => void }) {
  const [a, setA] = useState<TextAnalysis | null>(() => item.analysis ?? (() => {
    try { return analyzeText(item.content); } catch { return null; }
  })());

  // Enrich with NLP data if missing (async)
  useEffect(() => {
    if (!a || (a.posDistribution && Object.keys(a.posDistribution).length > 0)) return;
    let cancelled = false;
    enrichWithNlp(a, item.content).then(enriched => {
      if (!cancelled) setA(enriched);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [a, item.content]);

  if (!a) return <div className="txt-results"><p style={{ color: 'var(--color-muted)' }}>No analysis data available.</p></div>;

  const winkStatus = getWinkStatus();
  const hasNlp = a.posDistribution && Object.keys(a.posDistribution).length > 0;

  const posEntries = Object.entries(a.posDistribution)
    .sort(([, a], [, b]) => b - a);
  const totalTokens = a.nlpTokenCount || 1;

  const nlpSent = a.nlpSentiment ?? 0;
  const sentSs = a.sentenceSentiments ?? [];
  const entityDens = a.entityDensity ?? 0;

  const sentimentLabel = nlpSent > 0.2 ? 'Positive' : nlpSent < -0.2 ? 'Negative' : 'Neutral';
  const sentimentColor = nlpSent > 0.2 ? 'var(--color-tertiary)' : nlpSent < -0.2 ? '#f87171' : 'var(--color-muted)';

  const entityTypeCounts: Record<string, number> = {};
  for (const e of a.entities) {
    entityTypeCounts[e.type] = (entityTypeCounts[e.type] ?? 0) + 1;
  }

  return (
    <div className="txt-results">
      <div className="txt-nlp-head">
        <div>
          <h3>NLP Analysis</h3>
          <p>Sentiment, part-of-speech distribution, named entities and per-sentence sentiment.</p>
        </div>
        <button
          className="action-tactile button-ghost"
          type="button"
          onClick={() => {
            const csv = buildNlpCSV([item]);
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `watermark-text-nlp-${(item.fileName ?? 'paste').replace(/\.[^.]+$/, '')}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('NLP CSV exported');
          }}
        >
          <Download size={14} /> Export NLP CSV
        </button>
      </div>

      {/* Debug status */}
      <div style={{ padding: '0.5rem', marginBottom: '0.75rem', borderRadius: 6, background: 'var(--color-surface-alt)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
        <div>wink-nlp: {winkStatus.initialized ? '✅ initialized' : `❌ not loaded${winkStatus.error ? ` (${winkStatus.error})` : ''}`}</div>
        <div>POS tags: {hasNlp ? Object.keys(a.posDistribution).length : 'none'} | Entities: {a.entities.length} | Sentiment: {a.nlpSentiment}</div>
      </div>

      {/* Sentiment */}
      <div className="txt-section">
        <div className="txt-section-title">Sentiment</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div style={{ flex: 1, height: 8, background: 'var(--color-surface-alt)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.abs(nlpSent) * 50 + 50}%`,
              marginLeft: nlpSent < 0 ? 'auto' : 0,
              background: sentimentColor,
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
          <strong style={{ color: sentimentColor, minWidth: 60, textAlign: 'right' }}>
            {nlpSent.toFixed(2)}
          </strong>
        </div>
        <span style={{ color: sentimentColor, fontSize: '0.8rem' }}>{sentimentLabel}</span>

        {sentSs.length > 1 && (
          <div style={{ marginTop: '0.75rem' }}>
            <div className="txt-section-title" style={{ fontSize: '0.7rem' }}>Per-sentence sentiment</div>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: '0.25rem' }}>
              {sentSs.map((s, i) => (
                <div
                  key={i}
                  title={`Sentence ${i + 1}: ${(s ?? 0).toFixed(2)}`}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: (s ?? 0) > 0.2 ? 'var(--color-tertiary)' : (s ?? 0) < -0.2 ? '#f87171' : 'var(--color-surface-alt)',
                    opacity: 0.5 + Math.abs(s ?? 0) * 0.5,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Combined Metrics Table — POS + Writing Style */}
      <div className="txt-section">
        <div className="txt-section-title">
          Language Metrics
          <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--color-muted)', fontSize: '0.75rem' }}>
            {a.nlpTokenCount} tokens · {posEntries.length} POS tags
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(61,73,76,0.3)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 500 }}>Metric</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 500 }}>Count / Value</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 500, minWidth: 80 }}>%</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 500, minWidth: 100 }}>Bar</th>
            </tr>
          </thead>
          <tbody>
            {/* POS tags */}
            {posEntries.map(([pos, count]) => {
              const pct = (count / totalTokens) * 100;
              const label = POS_LABELS[pos] ?? pos;
              return (
                <tr key={`pos-${pos}`} style={{ borderBottom: '1px solid rgba(61,73,76,0.15)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--color-on-surface)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--color-primary)', marginRight: 6 }}>{pos}</span>
                    {label}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-on-surface)' }}>{count}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>{pct.toFixed(1)}%</td>
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ height: 6, background: 'var(--color-surface-alt)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {/* Divider */}
            {posEntries.length > 0 && (
              <tr><td colSpan={4} style={{ padding: '4px 0', borderBottom: '2px solid rgba(61,73,76,0.3)' }} /></tr>
            )}
            {/* Writing Style */}
            {[
              ['Adjective Density', a.adjectiveDensity ?? 0, '%'],
              ['Noun Density', a.nounDensity ?? 0, '%'],
              ['Passive Voice Est.', a.passiveEstimate ?? 0, '%'],
              ['Pronoun Ratio', a.pronounRatio ?? 0, '%'],
              ['Sentence Uniformity', a.sentenceUniformity ?? 0, '/100'],
              ['Repetition Score', a.repetitionScore ?? 0, '%'],
            ].map(([label, val, unit]) => {
              const value = Number(val);
              return (
              <tr key={label} style={{ borderBottom: '1px solid rgba(61,73,76,0.15)' }}>
                <td style={{ padding: '5px 8px', color: 'var(--color-on-surface)' }}>{label}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-secondary)' }}>{value.toFixed(1)}{unit}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>{value.toFixed(1)}{unit === '/100' ? '' : '%'}</td>
                <td style={{ padding: '5px 8px' }}>
                  <div style={{ height: 6, background: 'var(--color-surface-alt)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, value)}%`, background: value > 50 ? 'var(--color-tertiary)' : value > 20 ? 'var(--color-primary)' : 'var(--color-secondary)', borderRadius: 3 }} />
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Entities */}
      <div className="txt-section">
        <div className="txt-section-title">
          Named Entities
          <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--color-muted)', fontSize: '0.75rem' }}>
            {a.entities.length} found · {entityDens.toFixed(1)} per sentence
          </span>
        </div>
        {a.entities.length === 0 ? (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.8rem' }}>No named entities detected.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(61,73,76,0.3)' }}>
                <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--color-muted)', fontWeight: 500 }}>Entity</th>
                <th style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--color-muted)', fontWeight: 500 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {a.entities.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(61,73,76,0.15)' }}>
                  <td style={{ padding: '4px 8px', color: 'var(--color-on-surface)' }}>{e.text}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                    <span className="txt-batch-item-badge" style={{ fontSize: '0.65rem' }}>{e.type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface DiffLine {
  type: 'unchanged' | 'removed' | 'added';
  text: string;
  outText?: string;
  origNum: number;
  outNum: number;
}

function diffLines(original: string, transformed: string): DiffLine[] {
  const origLines = original.split('\n');
  const outLines = transformed.split('\n');
  const result: DiffLine[] = [];

  // Simple line-by-line diff
  const maxLen = Math.max(origLines.length, outLines.length);
  let origNum = 1;
  let outNum = 1;

  for (let i = 0; i < maxLen; i++) {
    const origLine = origLines[i] ?? '';
    const outLine = outLines[i] ?? '';

    if (origLine === outLine) {
      result.push({ type: 'unchanged', text: origLine, origNum, outNum });
      origNum++;
      outNum++;
    } else {
      if (origLine !== undefined && i < origLines.length) {
        result.push({ type: 'removed', text: origLine, origNum, outNum });
        origNum++;
      }
      if (outLine !== undefined && i < outLines.length) {
        result.push({ type: 'added', text: outLine, outText: outLine, origNum, outNum });
        outNum++;
      }
    }
  }

  return result;
}

// ── Word-level diff + tool-attributed highlighting ──────────────

type TransformTool = 'strip' | 'improve' | 'harper';

interface TransformStep {
  tool: TransformTool;
  before: string;
  after: string;
}

interface HighlightedSegment {
  text: string;
  type: 'unchanged' | 'changed';
  tool?: TransformTool;
}

// Word-level diff: returns array of {text, type:'same'|'added'|'removed'}
//
// NOTE: the previous implementation ran a full O(m*n) LCS matrix over the
// entire token arrays. For a few thousand words that allocates hundreds of
// MB and freezes/crashes the tab as soon as "Strip Text" renders the
// side-by-side view. This version trims the common prefix/suffix in linear
// time (which covers the common "mostly unchanged" case) and only runs LCS
// on the differing middle — with a hard cap that falls back to a single
// removed+added block instead of crashing.
const WORD_DIFF_MAX_CELLS = 4_000_000; // ~2000x2000 middle tokens
const WORD_DIFF_MAX_CHARS = 500_000;

function mergeDiffSegments(raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }>) {
  const result: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  for (const seg of raw) {
    if (result.length > 0 && result[result.length - 1].type === seg.type) {
      result[result.length - 1].text += seg.text;
    } else {
      result.push({ ...seg });
    }
  }
  return result;
}

function lcsDiff(aWords: string[], bWords: string[]): Array<{ text: string; type: 'same' | 'added' | 'removed' }> {
  const m = aWords.length;
  const n = bWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aWords[i - 1] === bWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  let i = m, j = n;
  const raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aWords[i - 1] === bWords[j - 1]) {
      raw.push({ text: aWords[i - 1], type: 'same' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ text: bWords[j - 1], type: 'added' });
      j--;
    } else {
      raw.push({ text: aWords[i - 1], type: 'removed' });
      i--;
    }
  }
  raw.reverse();
  return mergeDiffSegments(raw);
}

function wordDiff(a: string, b: string): Array<{ text: string; type: 'same' | 'added' | 'removed' }> {
  if (a === b) return a ? [{ text: a, type: 'same' }] : [];
  if (!a) return [{ text: b, type: 'added' }];
  if (!b) return [{ text: a, type: 'removed' }];

  // Hard cap: never build a DP matrix for huge inputs — degrade to a
  // single removed+added block instead of freezing/crashing the tab.
  if (a.length + b.length > WORD_DIFF_MAX_CHARS) {
    return [{ text: a, type: 'removed' }, { text: b, type: 'added' }];
  }

  const aWords = a.split(/(\s+)/);
  const bWords = b.split(/(\s+)/);

  if (aWords.length + bWords.length > 40_000) {
    return [{ text: a, type: 'removed' }, { text: b, type: 'added' }];
  }

  // Trim common prefix / suffix in linear time.
  let prefix = 0;
  const minLen = Math.min(aWords.length, bWords.length);
  while (prefix < minLen && aWords[prefix] === bWords[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    aWords[aWords.length - 1 - suffix] === bWords[bWords.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = aWords.slice(prefix, aWords.length - suffix);
  const midB = bWords.slice(prefix, bWords.length - suffix);

  if (midA.length === 0 && midB.length === 0) {
    return [{ text: a, type: 'same' }];
  }

  // Cap the quadratic middle. Fall back to block replacement when the
  // differing region is still huge.
  if (midA.length * midB.length > WORD_DIFF_MAX_CELLS) {
    const raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
    if (prefix > 0) raw.push({ text: aWords.slice(0, prefix).join(''), type: 'same' });
    if (midA.length > 0) raw.push({ text: midA.join(''), type: 'removed' });
    if (midB.length > 0) raw.push({ text: midB.join(''), type: 'added' });
    if (suffix > 0) raw.push({ text: aWords.slice(aWords.length - suffix).join(''), type: 'same' });
    return mergeDiffSegments(raw);
  }

  const middle = lcsDiff(midA, midB);
  const raw: Array<{ text: string; type: 'same' | 'added' | 'removed' }> = [];
  if (prefix > 0) raw.push({ text: aWords.slice(0, prefix).join(''), type: 'same' });
  raw.push(...middle);
  if (suffix > 0) raw.push({ text: aWords.slice(aWords.length - suffix).join(''), type: 'same' });
  return mergeDiffSegments(raw);
}

// Compute highlighted segments with tool attribution
function computeHighlights(original: string, steps: TransformStep[]): {
  outputSegments: HighlightedSegment[];
  removedSegments: Array<{ text: string; tool: TransformTool }>;
} {
  if (steps.length === 0) {
    return { outputSegments: [{ text: original, type: 'unchanged' }], removedSegments: [] };
  }

  // Chain diffs: compute what each tool changed relative to its input.
  // NOTE: each step's diff is computed exactly once. (The old code ran
  // wordDiff a second time per step on texts reconstructed from the first
  // diff — doubling the quadratic cost — and then mis-tagged duplicate
  // words via indexOf. The segments from the single diff are sufficient.)
  const toolDiffs: Array<{ tool: TransformTool; segments: Array<{ text: string; type: 'same' | 'added' | 'removed' }> }> = [];
  for (const step of steps) {
    try {
      toolDiffs.push({ tool: step.tool, segments: wordDiff(step.before, step.after) });
    } catch {
      // If diffing fails for any reason, degrade gracefully: show the
      // step's output untagged rather than crashing the view.
      toolDiffs.push({ tool: step.tool, segments: [{ text: step.after, type: 'same' as const }] });
    }
  }

  // Build output: start with original text, apply each tool's changes.
  // Track which words came from which tool.
  interface WordInfo { text: string; tool: TransformTool | null; }
  // Carry-over tags across chained steps: 'same' words keep the tag they
  // had in the current list; 'added' words get the current step's tool.
  // Steps are produced as a single-element chain today, but this stays
  // correct if multi-step chains are added later.
  let currentWords: WordInfo[] = original.split(/(\s+)/).map(w => ({ text: w, tool: null }));

  for (const td of toolDiffs) {
    const nextWords: WordInfo[] = [];
    // Cursor into currentWords for 'same' segments. The 'same' text of a
    // step equals contiguous words of the current text, so consume them in
    // order (whitespace-tolerant) instead of indexOf-searching.
    let cursor = 0;
    const takeSame = (text: string) => {
      if (!text) return;
      // Consume current words whose concatenation covers `text`.
      let covered = '';
      const start = cursor;
      while (cursor < currentWords.length && covered.length < text.length) {
        covered += currentWords[cursor].text;
        cursor++;
      }
      if (covered === text) {
        for (let k = start; k < cursor; k++) nextWords.push(currentWords[k]);
      } else {
        // Alignment mismatch (shouldn't happen for chained steps) —
        // fall back to untagged words so we never lose text.
        cursor = start;
        for (const w of text.split(/(\s+)/)) {
          nextWords.push({ text: w, tool: null });
          cursor++;
        }
      }
    };

    for (const seg of td.segments) {
      if (seg.type === 'same') {
        takeSame(seg.text);
      } else if (seg.type === 'added') {
        for (const w of seg.text.split(/(\s+)/)) {
          nextWords.push({ text: w, tool: td.tool });
        }
      }
      // 'removed' segments are dropped from the output (recorded below).
    }
    currentWords = nextWords;
  }

  // Build output segments
  const outputSegments: HighlightedSegment[] = currentWords.map(w => ({
    text: w.text,
    type: w.tool ? 'changed' : 'unchanged',
    tool: w.tool ?? undefined,
  }));

  // Merge consecutive same-tool segments
  const merged: HighlightedSegment[] = [];
  for (const seg of outputSegments) {
    if (merged.length > 0 && merged[merged.length - 1].type === seg.type && merged[merged.length - 1].tool === seg.tool) {
      merged[merged.length - 1].text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  // Collect removed segments for original pane
  const removedSegments: Array<{ text: string; tool: TransformTool }> = [];
  for (const td of toolDiffs) {
    for (const seg of td.segments) {
      if (seg.type === 'removed' && seg.text.trim()) {
        removedSegments.push({ text: seg.text, tool: td.tool });
      }
    }
  }

  return { outputSegments: merged, removedSegments };
}

// Render the original text with removed portions highlighted
function renderOriginalWithHighlights(original: string, removedSegments: Array<{ text: string; tool: TransformTool }>): React.ReactNode[] {
  if (removedSegments.length === 0) return [<span key="full">{original}</span>];

  const parts: React.ReactNode[] = [];
  let remaining = original;

  for (const rem of removedSegments) {
    const idx = remaining.indexOf(rem.text);
    if (idx >= 0) {
      if (idx > 0) parts.push(<span key={`keep-${parts.length}`}>{remaining.slice(0, idx)}</span>);
      parts.push(
        <span
          key={`rem-${parts.length}`}
          style={{
            background: `${toolColors[rem.tool]}22`,
            color: toolColors[rem.tool],
            textDecoration: 'line-through',
            textDecorationColor: toolColors[rem.tool],
            borderRadius: 2,
            padding: '0 1px',
          }}
        >
          {rem.text}
        </span>
      );
      remaining = remaining.slice(idx + rem.text.length);
    }
  }
  if (remaining) parts.push(<span key="rest">{remaining}</span>);
  return parts;
}

const toolColors: Record<TransformTool, string> = {
  strip: '#f472b6',    // pink
  improve: '#4ade80',   // green
  harper: '#a78bfa',    // purple
};

const toolLabels: Record<TransformTool, string> = {
  strip: 'Strip / Obfuscate',
  improve: 'Improve Text',
  harper: 'Grammar',
};

function TextTransformPanel({ inputText, format, showToast }: { inputText: string; format?: string; showToast: (msg: string) => void }) {
  const [mode, setMode] = useState<'strip' | 'improve' | 'harper'>('strip');
  const [viewMode, setViewMode] = useState<'output' | 'diff'>('output');
  const [outputText, setOutputText] = useState('');
  const [hasOutput, setHasOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  // Transformation history for multi-tool highlighting
  const [transformSteps, setTransformSteps] = useState<TransformStep[]>([]);
  const [originalText, setOriginalText] = useState('');

  // Check if Harper should be available (not for PDFs by default)
  const harperAvailable = format !== 'pdf';

  // Stripper state
  const [stripOpts, setStripOpts] = useState<StripperOptions>(() => {
    const stored = getStoredStripperOpts();
    return stored ? { ...STRIPPER_DEFAULTS, ...stored } : { ...STRIPPER_DEFAULTS };
  });

  // Persistence: save stripper options when they change
  useEffect(() => {
    storeStripperOpts(stripOpts as unknown as Record<string, unknown>);
  }, [stripOpts]);

  // Unsloper state
  const [unslopPatterns, setUnslopPatterns] = useState<UnslopPattern[]>([]);
  const [unslopResult, setUnslopResult] = useState<ReturnType<typeof applyUnslop> | null>(null);
  const [skipFillerRemoval, setSkipFillerRemoval] = useState(() => {
    try { return localStorage.getItem('wm:skipFillerRemoval') === 'true'; } catch { return false; }
  });

  // Harper state
  const [harperLints, setHarperLints] = useState<HarperLint[]>([]);
  const [harperRunning, setHarperRunning] = useState(false);

  function runStripper() {
    try {
      const result = applyStripper(inputText, stripOpts);
      setOutputText(result);
      setHasOutput(true);
      setViewMode('diff');
      setOriginalText(inputText);
      setTransformSteps([{ tool: 'strip', before: inputText, after: result }]);
      showToast('Text stripped');
    } catch (err) {
      showToast(`Strip error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  function runUnsloper() {
    try {
      const allPatterns = detectUnslopPatterns(inputText);
      const patterns = skipFillerRemoval
        ? allPatterns.filter(p => p.category !== 'transition')
        : allPatterns;
      setUnslopPatterns(patterns);
      const result = applyUnslop(inputText, patterns);
      setUnslopResult(result);
      setOutputText(result.text);
      setHasOutput(true);
      setViewMode('diff');
      setOriginalText(inputText);
      setTransformSteps([{ tool: 'improve', before: inputText, after: result.text }]);
      showToast(`Unslopped — ${result.changeCount} changes, ${patterns.length} patterns found`);
    } catch (err) {
      showToast(`Unslopper error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async function runHarper() {
    setHarperRunning(true);
    try {
      const textToCheck = format === 'pdf' ? normalizePdfText(inputText) : inputText;
      const lints = await harperLint(textToCheck);
      setHarperLints(lints);
      const fixed = await harperFixAll(textToCheck);
      setOutputText(fixed);
      setHasOutput(true);
      setViewMode('diff');
      setOriginalText(inputText);
      setTransformSteps([{ tool: 'harper', before: inputText, after: fixed }]);
      showToast(`Harper: ${lints.length} issues found and fixed`);
    } catch (err) {
      showToast(`Harper error: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setHarperRunning(false);
    }
  }

  function applyPreset(key: string) {
    const preset = STRIPPER_PRESETS[key];
    if (preset) setStripOpts({ ...STRIPPER_DEFAULTS, ...preset });
  }

  function copyOutput() {
    if (!outputText) return;
    navigator.clipboard?.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    showToast('Copied to clipboard');
  }

  function downloadOutput() {
    if (!outputText) return;
    const blob = new Blob([outputText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transformed-${mode}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const categories = unslopPatterns.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + p.count;
    return acc;
  }, {});

  // Memoize the side-by-side highlight computation: it runs a word diff
  // over the full text, so recomputing it on every render (e.g. typing,
  // tab switches, toast updates) froze the tab on long inputs. It is now
  // computed only when the transform inputs change, guarded by a size cap
  // and try/catch so a pathological input degrades to plain panes.
  const highlights = useMemo(() => {
    if (transformSteps.length === 0 || !originalText) return null;
    // Skip word-level highlighting for very large texts — render the
    // plain line diff below instead of freezing the tab.
    if (originalText.length > 200_000) return null;
    try {
      return computeHighlights(originalText, transformSteps);
    } catch {
      return null;
    }
  }, [originalText, transformSteps]);

  return (
    <div className="xform-panel">
      {/* Source text viewer */}
      <div className="xform-source">
        <div className="xform-source-header">
          <FileText size={14} />
          <span>Source Text</span>
          <span className="xform-source-stats">{inputText.length.toLocaleString()} chars</span>
        </div>
        <div className="xform-source-content">
          {inputText}
        </div>
      </div>

      <div className="xform-tabs">
        <button
          className={`xform-tab ${mode === 'strip' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('strip')}
        >
          Strip / Obfuscate
        </button>
        <button
          className={`xform-tab ${mode === 'improve' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('improve')}
        >
          Improve Text
        </button>
        <button
          className={`xform-tab ${mode === 'harper' ? 'active' : ''}`}
          type="button"
          onClick={() => setMode('harper')}
          disabled={!harperAvailable}
          title={!harperAvailable ? 'Harper not available for PDF text (letter-spacing artifacts)' : ''}
        >
          Grammar Only
        </button>
      </div>

      {mode === 'strip' ? (
        <div className="xform-body">
          {/* Presets */}
          <div className="xform-presets">
            <span className="xform-presets-label">Presets:</span>
            {Object.keys(STRIPPER_PRESETS).map((key) => (
              <button key={key} className="action-tactile button-ghost xform-preset-btn" type="button" onClick={() => applyPreset(key)}>
                {key}
              </button>
            ))}
            <button className="action-tactile button-ghost xform-preset-btn" type="button" onClick={() => setStripOpts({ ...STRIPPER_DEFAULTS })}>
              reset
            </button>
          </div>

          {/* Options grid */}
          <div className="xform-opts">
            <h4>Anonymize</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizeNames} onChange={(e) => setStripOpts({ ...stripOpts, anonymizeNames: e.target.checked })} /> <span>Names → [NAME]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizeEmails} onChange={(e) => setStripOpts({ ...stripOpts, anonymizeEmails: e.target.checked })} /> <span>Emails → [EMAIL]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizePhones} onChange={(e) => setStripOpts({ ...stripOpts, anonymizePhones: e.target.checked })} /> <span>Phones → [PHONE]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.anonymizeUrls} onChange={(e) => setStripOpts({ ...stripOpts, anonymizeUrls: e.target.checked })} /> <span>URLs → [URL]</span></label>

            <h4>Redact PII</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripSSN} onChange={(e) => setStripOpts({ ...stripOpts, stripSSN: e.target.checked })} /> <span>SSN → [SSN]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripCreditCards} onChange={(e) => setStripOpts({ ...stripOpts, stripCreditCards: e.target.checked })} /> <span>Credit cards → [CREDIT_CARD]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripBankAccounts} onChange={(e) => setStripOpts({ ...stripOpts, stripBankAccounts: e.target.checked })} /> <span>Bank accounts → [BANK_ACCOUNT]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripDriversLicense} onChange={(e) => setStripOpts({ ...stripOpts, stripDriversLicense: e.target.checked })} /> <span>Driver's license → [DRIVERS_LICENSE]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripPassport} onChange={(e) => setStripOpts({ ...stripOpts, stripPassport: e.target.checked })} /> <span>Passport → [PASSPORT]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripTaxIds} onChange={(e) => setStripOpts({ ...stripOpts, stripTaxIds: e.target.checked })} /> <span>Tax IDs (EIN) → [EIN]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripApiKeys} onChange={(e) => setStripOpts({ ...stripOpts, stripApiKeys: e.target.checked })} /> <span>API keys / tokens → [API_KEY]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripPasswords} onChange={(e) => setStripOpts({ ...stripOpts, stripPasswords: e.target.checked })} /> <span>Passwords → [PASSWORD]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripAddresses} onChange={(e) => setStripOpts({ ...stripOpts, stripAddresses: e.target.checked })} /> <span>Street addresses → [ADDRESS]</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripIban} onChange={(e) => setStripOpts({ ...stripOpts, stripIban: e.target.checked })} /> <span>IBAN → [IBAN]</span></label>

            <h4>Strip Formatting</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripMarkdown} onChange={(e) => setStripOpts({ ...stripOpts, stripMarkdown: e.target.checked })} /> <span>Markdown syntax</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripHtml} onChange={(e) => setStripOpts({ ...stripOpts, stripHtml: e.target.checked })} /> <span>HTML tags</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripLineNumbers} onChange={(e) => setStripOpts({ ...stripOpts, stripLineNumbers: e.target.checked })} /> <span>Line numbers</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripBom} onChange={(e) => setStripOpts({ ...stripOpts, stripBom: e.target.checked })} /> <span>BOM character</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripNonPrintable} onChange={(e) => setStripOpts({ ...stripOpts, stripNonPrintable: e.target.checked })} /> <span>Non-printable chars</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripInvisibleChars} onChange={(e) => setStripOpts({ ...stripOpts, stripInvisibleChars: e.target.checked })} /> <span>Invisible Unicode (ZWSP, tag chars, exotic spaces)</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.stripBidiControls} onChange={(e) => setStripOpts({ ...stripOpts, stripBidiControls: e.target.checked })} /> <span>Bidi controls (Trojan Source defense)</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.normalizeTypography} onChange={(e) => setStripOpts({ ...stripOpts, normalizeTypography: e.target.checked })} /> <span>Smart quotes, dashes, ellipsis → ASCII</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.detectHomoglyphs} onChange={(e) => setStripOpts({ ...stripOpts, detectHomoglyphs: e.target.checked })} /> <span>Homoglyphs (Cyrillic/Greek lookalikes)</span></label>

            <h4>Normalize</h4>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.normalizeWhitespace} onChange={(e) => setStripOpts({ ...stripOpts, normalizeWhitespace: e.target.checked })} /> <span>Collapse whitespace</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.normalizeLineEndings} onChange={(e) => setStripOpts({ ...stripOpts, normalizeLineEndings: e.target.checked })} /> <span>Normalize line endings</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.trimTrailingWhitespace} onChange={(e) => setStripOpts({ ...stripOpts, trimTrailingWhitespace: e.target.checked })} /> <span>Trim trailing whitespace</span></label>
            <label className="xform-check"><input type="checkbox" checked={stripOpts.collapseMultipleBlankLines} onChange={(e) => setStripOpts({ ...stripOpts, collapseMultipleBlankLines: e.target.checked })} /> <span>Collapse blank lines</span></label>
          </div>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runStripper} disabled={!inputText}>
            Strip Text
          </button>
        </div>
      ) : mode === 'improve' ? (
        <div className="xform-body">
          <div className="xform-unslop-intro">
            <p>Cleans up verbose language, AI-typical phrases, inflated synonyms, passive constructions, chatbot filler, and formatting tells — all in one pass. Replaces with direct, natural alternatives.</p>
          </div>

          <label className="xform-check">
            <input type="checkbox" checked={skipFillerRemoval} onChange={(e) => {
              setSkipFillerRemoval(e.target.checked);
              try { localStorage.setItem('wm:skipFillerRemoval', String(e.target.checked)); } catch {}
            }} />
            <span>Keep transition words (furthermore, moreover, in addition…)</span>
          </label>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runUnsloper} disabled={!inputText}>
            <Sparkles size={15} /> Improve Text
          </button>

          {unslopResult && (
            <div className="xform-unslop-results">
              <div className="xform-unslop-summary">
                <div className="xform-unslop-stat">
                  <span>Patterns found</span>
                  <strong>{unslopResult.patternsFound.length}</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Changes made</span>
                  <strong>{unslopResult.changeCount}</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Original</span>
                  <strong>{unslopResult.originalLength.toLocaleString()} chars</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Transformed</span>
                  <strong>{unslopResult.transformedLength.toLocaleString()} chars</strong>
                </div>
                <div className="xform-unslop-stat">
                  <span>Reduction</span>
                  <strong style={{ color: 'var(--color-tertiary)' }}>
                    {unslopResult.originalLength > 0
                      ? `${((1 - unslopResult.transformedLength / unslopResult.originalLength) * 100).toFixed(1)}%`
                      : '0%'}
                  </strong>
                </div>
              </div>

              {/* Category breakdown */}
              {Object.keys(categories).length > 0 && (
                <div className="xform-unslop-cats">
                  {Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                    <span key={cat} className="xform-unslop-cat">
                      {cat} <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              )}

              {/* Pattern list */}
              <div className="xform-unslop-list">
                {unslopResult.patternsFound.map((pat) => (
                  <div key={pat.phrase} className="xform-unslop-item">
                    <span className="xform-unslop-phrase">"{pat.phrase}"</span>
                    <span className="xform-unslop-cat-badge">{pat.category}</span>
                    <span className="xform-unslop-count">×{pat.count}</span>
                    <span className="xform-unslop-arrow">→</span>
                    <span className="xform-unslop-replace">{pat.replacement}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="xform-body">
          <div className="xform-unslop-intro">
            <p>Grammar and spelling only — powered by Harper (WASM). Catches typos, grammar errors, and spelling mistakes without changing your writing style.</p>
          </div>

          <button className="action-tactile button-primary xform-run" type="button" onClick={runHarper} disabled={!inputText || harperRunning}>
            {harperRunning ? <><Loader2 size={15} className="spin" /> Checking…</> : <><Check size={15} /> Check Grammar</>}
          </button>

          {harperLints.length > 0 && (
            <div className="xform-unslop-results">
              <div className="xform-unslop-summary">
                <div className="xform-unslop-stat">
                  <span>Issues found</span>
                  <strong>{harperLints.length}</strong>
                </div>
              </div>
              <div className="xform-unslop-list">
                {harperLints.map((lint, i) => (
                  <div key={i} className="xform-unslop-item">
                    <span className="xform-unslop-phrase">"{(format === 'pdf' ? normalizePdfText(inputText) : inputText).slice(Math.max(0, lint.start), lint.end)}"</span>
                    <span className="xform-unslop-cat-badge">{lint.kind}</span>
                    <span className="xform-unslop-replace">{lint.message}</span>
                    {lint.suggestions.length > 0 && (
                      <span className="xform-unslop-arrow">→ "{lint.suggestions[0]}"</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Output */}
      {hasOutput && (
        <div className="xform-output">
          <div className="xform-output-header">
            <h4>Output</h4>
            <div style={{ display: 'flex', gap: 4, marginRight: 'auto', marginLeft: 12 }}>
              <button
                className={`action-tactile ${viewMode === 'output' ? 'button-primary' : 'button-ghost'}`}
                type="button"
                onClick={() => setViewMode('output')}
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                <FileText size={13} /> Text
              </button>
              <button
                className={`action-tactile ${viewMode === 'diff' ? 'button-primary' : 'button-ghost'}`}
                type="button"
                onClick={() => setViewMode('diff')}
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                <Diff size={13} /> Side-by-Side
              </button>
            </div>

            {/* Tool color legend */}
            {transformSteps.length > 0 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--color-on-surface-variant)' }}>
                {transformSteps.map((step) => (
                  <span key={step.tool} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: toolColors[step.tool], display: 'inline-block' }} />
                    {toolLabels[step.tool]}
                  </span>
                ))}
              </div>
            )}

            <div className="xform-output-actions">
              <button className="action-tactile button-ghost" type="button" onClick={copyOutput}>
                <Clipboard size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="action-tactile button-ghost" type="button" onClick={downloadOutput}>
                <Download size={14} /> Download
              </button>
            </div>
          </div>

          {viewMode === 'diff' ? (
            transformSteps.length > 0 && highlights ? (
              (() => {
                const { outputSegments, removedSegments } = highlights;
                return (
                  <div className="side-by-side-diff">
                    <div className="diff-pane">
                      <div className="diff-pane-header">
                        <span>Original</span>
                        <span className="diff-pane-stats">{originalText.length.toLocaleString()} chars</span>
                      </div>
                      <div className="diff-pane-content">
                        <div className="diff-line">
                          <span className="diff-line-text" style={{ lineHeight: 1.7 }}>
                            {renderOriginalWithHighlights(originalText, removedSegments)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="diff-divider" />
                    <div className="diff-pane">
                      <div className="diff-pane-header">
                        <span>Transformed</span>
                        <span className="diff-pane-stats">{outputText.length.toLocaleString()} chars</span>
                      </div>
                      <div className="diff-pane-content">
                        <div className="diff-line">
                          <span className="diff-line-text" style={{ lineHeight: 1.7 }}>
                            {outputSegments.map((seg, i) => (
                              seg.type === 'changed' && seg.tool ? (
                                <span
                                  key={i}
                                  style={{
                                    background: `${toolColors[seg.tool]}22`,
                                    color: toolColors[seg.tool],
                                    fontWeight: 600,
                                    borderRadius: 2,
                                    padding: '0 1px',
                                  }}
                                >
                                  {seg.text}
                                </span>
                              ) : (
                                <span key={i}>{seg.text}</span>
                              )
                            ))}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="side-by-side-diff">
                <div className="diff-pane">
                  <div className="diff-pane-header">
                    <span>Original</span>
                    <span className="diff-pane-stats">{(originalText || inputText).length.toLocaleString()} chars</span>
                  </div>
                  <div className="diff-pane-content">
                    {diffLines(originalText || inputText, outputText).map((line, i) => (
                      <div key={`orig-${i}`} className={`diff-line ${line.type === 'removed' ? 'removed' : line.type === 'unchanged' ? '' : 'dim'}`}>
                        <span className="diff-line-num">{line.type === 'removed' || line.type === 'unchanged' ? line.origNum : ''}</span>
                        <span className="diff-line-text">{line.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="diff-divider" />
                <div className="diff-pane">
                  <div className="diff-pane-header">
                    <span>Transformed</span>
                    <span className="diff-pane-stats">{outputText.length.toLocaleString()} chars</span>
                  </div>
                  <div className="diff-pane-content">
                    {diffLines(originalText || inputText, outputText).map((line, i) => (
                      <div key={`out-${i}`} className={`diff-line ${line.type === 'added' ? 'added' : line.type === 'unchanged' ? '' : 'dim'}`}>
                        <span className="diff-line-num">{line.type === 'added' || line.type === 'unchanged' ? line.outNum : ''}</span>
                        <span className="diff-line-text">{line.type === 'removed' ? '' : (line.outText ?? line.text)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          ) : (
            <textarea className="xform-output-text" readOnly value={outputText} rows={12} />
          )}
        </div>
      )}
    </div>
  );
}
