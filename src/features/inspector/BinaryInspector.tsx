import { useState } from 'react';
import type { BinaryInfo } from '../../lib/metadata';

export function BinaryInspector({ binary }: { binary: BinaryInfo }) {
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);

  if (!binary || !binary.hexPreview) {
    return <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>No binary data available.</div>;
  }

  const hexLines = binary.hexPreview.split('\n').filter(Boolean);
  const structItems = binary.structure ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Info bar */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
        <span>Type: <strong style={{ color: 'var(--color-primary)' }}>{binary.detectedType}</strong></span>
        <span>Size: <strong>{binary.fileSize.toLocaleString()}B</strong></span>
        <span>Entropy: <strong>{binary.entropy.toFixed(2)}</strong></span>
        <span>Magic: <strong style={{ color: 'var(--color-tertiary)' }}>{binary.magicBytes}</strong></span>
      </div>

      {/* Entropy Heatmap */}
      {binary.entropyHeatmap && binary.entropyHeatmap.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 4 }}>Entropy Heatmap</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, padding: '4px 0' }}>
            {binary.entropyHeatmap.map((block, i) => {
              const ratio = block.entropy / 8;
              const hue = (1 - ratio) * 240;
              const sat = 70 + ratio * 30;
              const light = 30 + ratio * 25;
              return (
                <div
                  key={i}
                  title={`Offset 0x${block.offset.toString(16)}: entropy ${block.entropy.toFixed(2)}`}
                  style={{
                    width: 6,
                    height: 14,
                    borderRadius: 1,
                    background: `hsl(${hue}, ${sat}%, ${light}%)`,
                    flexShrink: 0,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--color-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            <span>Low (0.0)</span>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <div style={{ width: 40, height: 6, borderRadius: 3, background: 'linear-gradient(to right, hsl(240,70%,30%), hsl(120,80%,40%), hsl(0,100%,45%))' }} />
            </div>
            <span>High (8.0)</span>
          </div>
        </div>
      )}

      {/* Structure tree */}
      {structItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 2 }}>Structure</div>
          {structItems.map((s, i) => (
            <div
              key={i}
              onClick={() => setSelectedStructure(selectedStructure === i ? null : i)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(60px, auto) 90px 60px 1fr',
                gap: 8,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                padding: '3px 6px',
                borderRadius: 4,
                cursor: 'pointer',
                background: selectedStructure === i ? 'rgba(76, 215, 246, 0.1)' : 'transparent',
                border: selectedStructure === i ? '1px solid rgba(76, 215, 246, 0.3)' : '1px solid transparent',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{s.name}</span>
              <span style={{ color: '#94a3b8' }}>0x{s.offset.toString(16).padStart(6, '0')}</span>
              <span style={{ color: '#94a3b8' }}>{s.length}B</span>
              <span style={{ color: 'var(--color-on-surface-variant)' }}>{s.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hex dump */}
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 2 }}>
          Hex Dump
          {selectedStructure !== null && structItems[selectedStructure] && (
            <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--color-primary)' }}>
              — {structItems[selectedStructure].name} @ 0x{structItems[selectedStructure].offset.toString(16)}
            </span>
          )}
        </div>
        <pre
          className="hex-view"
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            maxHeight: 350,
            overflow: 'auto',
            color: 'var(--color-on-surface)',
            background: 'var(--color-surface)',
            padding: 8,
            borderRadius: 6,
            border: '1px solid rgba(61,73,76,0.3)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre',
          }}
        >
          {selectedStructure !== null && structItems[selectedStructure] ? (() => {
            const sel = structItems[selectedStructure];
            const selStart = sel.offset;
            const selEnd = sel.offset + sel.length;
            return hexLines.map((line, i) => {
              const lineOffset = parseInt(line.slice(0, 8), 16);
              if (isNaN(lineOffset)) return <div key={i}>{line}</div>;
              const lineEnd = lineOffset + 16;
              const overlaps = lineEnd > selStart && lineOffset < selEnd;
              return (
                <div key={i} style={{
                  background: overlaps ? 'rgba(76, 215, 246, 0.08)' : 'transparent',
                  borderLeft: overlaps ? '2px solid var(--color-primary)' : '2px solid transparent',
                  paddingLeft: 4,
                }}>
                  {line}
                </div>
              );
            });
          })() : hexLines.map((line, i) => <div key={i}>{line}</div>)}
        </pre>
      </div>
    </div>
  );
}
