import { useState, useEffect } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatBytes, computeHashes, type HashResult } from '../../lib/file';

export function HashCalculatorPanel({ file }: { file: File | null }) {
  const [hashes, setHashes] = useState<HashResult[]>([]);
  const [computing, setComputing] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    if (!file) { setHashes([]); return; }
    let cancelled = false;
    setComputing(true);
    computeHashes(file).then((result) => {
      if (!cancelled) { setHashes(result); setComputing(false); }
    }).catch(() => { if (!cancelled) setComputing(false); });
    return () => { cancelled = true; };
  }, [file]);

  if (!file) return <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>No file loaded.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)' }}>
        Hash Calculator — {file.name} ({formatBytes(file.size)})
      </div>
      {computing && <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>Computing hashes...</div>}
      {hashes.map((h, i) => (
        <div key={h.algorithm} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--color-surface)', border: '1px solid rgba(61,73,76,0.2)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-primary)', minWidth: 60 }}>{h.algorithm}</span>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-on-surface)', flex: 1, wordBreak: 'break-all' }}>{h.hash}</span>
          <button
            className="action-tactile button-ghost"
            type="button"
            style={{ fontSize: 10, padding: '2px 6px', flexShrink: 0 }}
            onClick={() => { navigator.clipboard.writeText(h.hash); setCopied(i); setTimeout(() => setCopied(null), 1500); }}
          >
            {copied === i ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      ))}
      {hashes.length > 0 && (
        <button
          className="action-tactile button-ghost"
          type="button"
          style={{ fontSize: 10, alignSelf: 'flex-start' }}
          onClick={() => {
            const text = hashes.map(h => `${h.algorithm}: ${h.hash}`).join('\n');
            navigator.clipboard.writeText(text);
            setCopied(-1);
            setTimeout(() => setCopied(null), 1500);
          }}
        >
          <Copy size={12} /> Copy All
        </button>
      )}
    </div>
  );
}
