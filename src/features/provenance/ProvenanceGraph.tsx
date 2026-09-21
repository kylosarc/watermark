import { useState, useRef, useEffect, useCallback } from 'react';
import {
  FileText, Shield, Key, Tag, Package, X, ZoomIn, ZoomOut, Maximize,
  CheckCircle, AlertTriangle, HelpCircle, XCircle, Info,
} from 'lucide-react';
import type { VerificationResult, ManifestSummary } from '../../lib/types';
import type { EvidenceStatus } from '../../lib/evidence';
import { STATUS_COLORS, STATUS_EMOJI } from '../../lib/evidence';

/* ── Provenance Graph Types ─────────────────────────────────── */

export type ProvenanceNodeType = 'file' | 'manifest' | 'evidence' | 'assertions' | 'ingredients';

export interface ProvenanceNode {
  id: string;
  type: ProvenanceNodeType;
  label: string;
  sublabel?: string;
  status: EvidenceStatus;
  details: Record<string, string>;
  x: number;
  y: number;
}

export interface ProvenanceEdge {
  from: string;
  to: string;
  label?: string;
}

interface ProvenanceGraphProps {
  result: VerificationResult | null;
  onNodeClick?: (nodeId: string) => void;
}

/* ── Status → color mapping ─────────────────────────────────── */

const STATUS_FILLS: Record<EvidenceStatus, string> = {
  verified: 'rgba(78, 222, 163, 0.15)',
  supported: 'rgba(76, 215, 246, 0.15)',
  claimed: 'rgba(245, 158, 11, 0.15)',
  unknown: 'rgba(134, 147, 151, 0.15)',
  contradicted: 'rgba(244, 63, 94, 0.15)',
  rejected: 'rgba(245, 158, 11, 0.15)',
  modified: 'rgba(168, 85, 247, 0.15)',
  stripped: 'rgba(244, 63, 94, 0.15)',
};

const STATUS_STROKES: Record<EvidenceStatus, string> = {
  verified: 'rgba(78, 222, 163, 0.6)',
  supported: 'rgba(76, 215, 246, 0.6)',
  claimed: 'rgba(245, 158, 11, 0.6)',
  unknown: 'rgba(134, 147, 151, 0.4)',
  contradicted: 'rgba(244, 63, 94, 0.6)',
  rejected: 'rgba(245, 158, 11, 0.6)',
  modified: 'rgba(168, 85, 247, 0.6)',
  stripped: 'rgba(244, 63, 94, 0.6)',
};

const STATUS_TEXT: Record<EvidenceStatus, string> = {
  verified: 'var(--color-tertiary)',
  supported: 'var(--color-primary)',
  claimed: '#f59e0b',
  unknown: 'var(--color-outline)',
  contradicted: 'var(--color-error)',
  rejected: '#f59e0b',
  modified: '#a855f7',
  stripped: '#f43f5e',
};

/* ── Build graph from result ────────────────────────────────── */

function buildGraph(result: VerificationResult): { nodes: ProvenanceNode[]; edges: ProvenanceEdge[] } {
  const manifest = result.manifests.find((m) => m.isActive) ?? result.manifests[0];
  const nodes: ProvenanceNode[] = [];
  const edges: ProvenanceEdge[] = [];

  // Determine overall status from validation state
  function validationToStatus(state: string): EvidenceStatus {
    switch (state) {
      case 'Trusted': return 'verified';
      case 'Valid': return 'supported';
      case 'Invalid': return 'contradicted';
      default: return 'unknown';
    }
  }

  const overallStatus = validationToStatus(result.validationState);

  // 1. Central File node
  nodes.push({
    id: 'file',
    type: 'file',
    label: result.fileName,
    sublabel: `SHA-256: ${result.sha256.slice(0, 16)}…`,
    status: overallStatus,
    details: {
      'File Name': result.fileName,
      'File Size': `${(result.fileSize / 1024).toFixed(1)} KB`,
      'MIME Type': result.mimeType,
      'SHA-256': result.sha256,
      'Validation': result.validationState,
    },
    x: 400,
    y: 260,
  });

  if (manifest) {
    // 2. C2PA Manifest node
    const manifestStatus: EvidenceStatus = manifest.isActive ? 'verified' : 'supported';
    nodes.push({
      id: 'manifest',
      type: 'manifest',
      label: 'C2PA Manifest',
      sublabel: manifest.issuer ?? 'Unknown issuer',
      status: manifestStatus,
      details: {
        'Issuer': manifest.issuer ?? 'Unknown',
        'Generator': manifest.claimGenerator ?? 'Unknown',
        'Signed At': manifest.signedAt ?? 'Unknown',
        'Algorithm': manifest.signatureAlgorithm ?? 'Unknown',
        'Active': manifest.isActive ? 'Yes' : 'No',
        'Claim Version': manifest.claimVersion?.toString() ?? 'Unknown',
      },
      x: 400,
      y: 60,
    });
    edges.push({ from: 'manifest', to: 'file', label: 'signs' });

    // 3. Cryptographic Evidence node
    const sigStatus: EvidenceStatus = manifest.validationCodes.length > 0 &&
      manifest.validationCodes.every((v) => v.success) ? 'verified' : 'unknown';
    nodes.push({
      id: 'evidence',
      type: 'evidence',
      label: 'Cryptographic Evidence',
      sublabel: manifest.signatureAlgorithm ?? 'RSA',
      status: sigStatus,
      details: {
        'Algorithm': manifest.signatureInfo?.digestAlgorithm ?? manifest.signatureAlgorithm ?? 'Unknown',
        'Issuer CN': manifest.signatureInfo?.commonName ?? manifest.issuer ?? 'Unknown',
        'Serial': manifest.signatureInfo?.serialNumber ?? 'Unknown',
        'Valid From': manifest.signatureInfo?.notBefore ?? 'Unknown',
        'Valid To': manifest.signatureInfo?.notAfter ?? 'Unknown',
        'Validation Codes': manifest.validationCodes.map((v) => v.code).join(', ') || 'None',
      },
      x: 680,
      y: 160,
    });
    edges.push({ from: 'manifest', to: 'evidence', label: 'proves' });
    edges.push({ from: 'evidence', to: 'file', label: 'binds' });

    // 4. Assertions node
    if (manifest.assertions.length > 0) {
      const assertionStatus: EvidenceStatus = manifest.assertions.length > 3 ? 'verified' : 'claimed';
      nodes.push({
        id: 'assertions',
        type: 'assertions',
        label: 'Assertions',
        sublabel: `${manifest.assertions.length} assertion${manifest.assertions.length !== 1 ? 's' : ''}`,
        status: assertionStatus,
        details: Object.fromEntries(
          manifest.assertions.map((a, i) => [`Assertion ${i + 1}`, a])
        ),
        x: 120,
        y: 160,
      });
      edges.push({ from: 'manifest', to: 'assertions', label: 'declares' });
      edges.push({ from: 'assertions', to: 'file', label: 'describes' });
    }

    // 5. Ingredients node
    if (manifest.ingredients.length > 0) {
      nodes.push({
        id: 'ingredients',
        type: 'ingredients',
        label: 'Ingredients',
        sublabel: `${manifest.ingredients.length} ingredient${manifest.ingredients.length !== 1 ? 's' : ''}`,
        status: 'supported',
        details: Object.fromEntries(
          manifest.ingredients.map((ing, i) => [`Ingredient ${i + 1}`, ing])
        ),
        x: 120,
        y: 360,
      });
      edges.push({ from: 'ingredients', to: 'file', label: 'composes' });
    }
  } else {
    // No manifest — minimal graph
    nodes.push({
      id: 'evidence',
      type: 'evidence',
      label: 'No Manifest',
      sublabel: 'No C2PA data found',
      status: 'unknown',
      details: { 'Status': 'No C2PA manifest detected in file' },
      x: 680,
      y: 260,
    });
    edges.push({ from: 'evidence', to: 'file' });
  }

  return { nodes, edges };
}

/* ── Node dimensions ────────────────────────────────────────── */

const NODE_W = 180;
const NODE_H = 64;
const NODE_R = 8;

function nodeCenter(n: ProvenanceNode) {
  return { cx: n.x, cy: n.y };
}

/* ── Icon component per node type ───────────────────────────── */

function NodeIcon({ type, size = 18 }: { type: ProvenanceNodeType; size?: number }) {
  switch (type) {
    case 'file': return <FileText size={size} />;
    case 'manifest': return <Shield size={size} />;
    case 'evidence': return <Key size={size} />;
    case 'assertions': return <Tag size={size} />;
    case 'ingredients': return <Package size={size} />;
  }
}

function StatusBadge({ status, size = 12 }: { status: EvidenceStatus; size?: number }) {
  switch (status) {
    case 'verified': return <CheckCircle size={size} style={{ color: STATUS_TEXT[status] }} />;
    case 'supported': return <Info size={size} style={{ color: STATUS_TEXT[status] }} />;
    case 'claimed': return <AlertTriangle size={size} style={{ color: STATUS_TEXT[status] }} />;
    case 'unknown': return <HelpCircle size={size} style={{ color: STATUS_TEXT[status] }} />;
    case 'contradicted': return <XCircle size={size} style={{ color: STATUS_TEXT[status] }} />;
  }
}

/* ── Main Component ─────────────────────────────────────────── */

export function ProvenanceGraph({ result, onNodeClick }: ProvenanceGraphProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 520 });
  const dragging = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);

  // Safe graph build — catch errors to prevent app crash
  let nodes: ProvenanceNode[] = [];
  let edges: ProvenanceEdge[] = [];
  try {
    if (result) {
      const graph = buildGraph(result);
      nodes = graph.nodes;
      edges = graph.edges;
    }
  } catch (err) {
    console.error('[ProvenanceGraph] buildGraph failed:', err);
  }

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width || 800, h: entry.contentRect.height || 520 });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const viewBox = { w: Math.max(containerSize.w, 800), h: Math.max(containerSize.h, 520) };

  const handleNodeClick = useCallback((node: ProvenanceNode) => {
    setSelectedId(node.id);
    onNodeClick?.(node.id);
  }, [onNodeClick]);

  const handleDeselect = useCallback(() => {
    setSelectedId(null);
    onNodeClick?.('');
  }, [onNodeClick]);

  // Pan handlers
  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as SVGElement).tagName === 'svg' || (e.target as SVGElement).tagName === 'rect') {
      dragging.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y };
    }
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    setOffset({
      x: dragging.current.offsetX + (e.clientX - dragging.current.startX),
      y: dragging.current.offsetY + (e.clientY - dragging.current.startY),
    });
  }
  function handleMouseUp() { dragging.current = null; }
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.min(2.5, Math.max(0.3, z + delta)));
  }
  function fitToView() { setOffset({ x: 0, y: 0 }); setZoom(1); }

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div className="provenance-graph-wrap" ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 520 }}>
      {/* Controls */}
      <div style={{
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        display: 'flex', gap: 4,
      }}>
        <button className="action-tactile button-ghost" type="button" onClick={fitToView} title="Fit to view">
          <Maximize size={14} />
        </button>
        <button className="action-tactile button-ghost" type="button" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} title="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button className="action-tactile button-ghost" type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))} title="Zoom out">
          <ZoomOut size={14} />
        </button>
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--color-surface-low)', border: '1px solid var(--color-outline-variant)',
        borderRadius: 6, padding: '8px 10px', fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: STATUS_TEXT.verified }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_TEXT.verified, display: 'inline-block' }} />
          Verified
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: STATUS_TEXT.supported }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_TEXT.supported, display: 'inline-block' }} />
          Supported
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: STATUS_TEXT.claimed }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_TEXT.claimed, display: 'inline-block' }} />
          Claimed
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: STATUS_TEXT.contradicted }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_TEXT.contradicted, display: 'inline-block' }} />
          Invalid
        </div>
      </div>

      {!result ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: 10, color: '#475569',
        }}>
          <FileText size={48} style={{ color: 'var(--color-outline)' }} />
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#64748b' }}>No provenance data</h3>
          <p style={{ fontSize: '0.8125rem', color: '#475569', maxWidth: 260, textAlign: 'center' }}>
            Verify a file to see its provenance graph.
          </p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
        >
          <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`}>
            {/* Edges */}
            {edges.map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const fc = nodeCenter(from);
              const tc = nodeCenter(to);
              const mx = (fc.cx + tc.cx) / 2;
              const my = (fc.cy + tc.cy) / 2;
              return (
                <g key={i}>
                  <line
                    x1={fc.cx} y1={fc.cy}
                    x2={tc.cx} y2={tc.cy}
                    stroke="rgba(76, 215, 246, 0.25)"
                    strokeWidth={1.5}
                    strokeDasharray="4,4"
                  />
                  {edge.label && (
                    <text
                      x={mx} y={my - 6}
                      textAnchor="middle"
                      fill="var(--color-outline)"
                      fontSize={9}
                      fontFamily="'JetBrains Mono', monospace"
                      fontStyle="italic"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const halfW = NODE_W / 2;
              const halfH = NODE_H / 2;
              return (
                <g
                  key={node.id}
                  onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Selection glow */}
                  {isSelected && (
                    <rect
                      x={node.x - halfW - 4} y={node.y - halfH - 4}
                      width={NODE_W + 8} height={NODE_H + 8}
                      rx={NODE_R + 2}
                      fill="none"
                      stroke={STATUS_STROKES[node.status]}
                      strokeWidth={2}
                      opacity={0.8}
                    />
                  )}

                  {/* Background */}
                  <rect
                    x={node.x - halfW} y={node.y - halfH}
                    width={NODE_W} height={NODE_H}
                    rx={NODE_R}
                    fill="var(--color-surface-container)"
                    stroke={STATUS_STROKES[node.status]}
                    strokeWidth={isSelected ? 2 : 1}
                  />

                  {/* Status indicator bar on left */}
                  <rect
                    x={node.x - halfW} y={node.y - halfH}
                    width={4} height={NODE_H}
                    rx={2}
                    fill={STATUS_TEXT[node.status]}
                    opacity={0.8}
                  />

                  {/* Icon */}
                  <foreignObject
                    x={node.x - halfW + 14} y={node.y - 14}
                    width={28} height={28}
                  >
                    <div style={{ color: STATUS_TEXT[node.status], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <NodeIcon type={node.type} size={18} />
                    </div>
                  </foreignObject>

                  {/* Label */}
                  <text
                    x={node.x - halfW + 44} y={node.y - 6}
                    fill="var(--color-on-surface)"
                    fontSize={12}
                    fontWeight={600}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {node.label}
                  </text>

                  {/* Sublabel */}
                  {node.sublabel && (
                    <text
                      x={node.x - halfW + 44} y={node.y + 12}
                      fill="var(--color-on-surface-dim)"
                      fontSize={9}
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      {node.sublabel.length > 22 ? node.sublabel.slice(0, 20) + '…' : node.sublabel}
                    </text>
                  )}

                  {/* Status badge */}
                  <foreignObject
                    x={node.x + halfW - 28} y={node.y - halfH + 8}
                    width={20} height={20}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <StatusBadge status={node.status} size={14} />
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/* Selected node summary (compact) */}
      {selectedNode && (
        <div style={{
          position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 10,
          background: 'var(--color-surface-low)', border: '1px solid var(--color-outline-variant)',
          borderRadius: 8, padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: STATUS_TEXT[selectedNode.status] }}>
              <NodeIcon type={selectedNode.type} size={16} />
            </span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-on-surface)', fontFamily: "'JetBrains Mono', monospace" }}>
                {selectedNode.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-on-surface-dim)', fontFamily: "'JetBrains Mono', monospace" }}>
                {STATUS_EMOJI[selectedNode.status]} {selectedNode.sublabel ?? selectedNode.type}
              </div>
            </div>
          </div>
          <button
            className="action-tactile button-ghost"
            type="button"
            onClick={handleDeselect}
            style={{ padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default ProvenanceGraph;
