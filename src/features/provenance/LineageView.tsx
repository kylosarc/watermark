import { useRef, useState, useEffect } from 'react';
import { GitBranch, Maximize, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { VerificationResult } from '../../lib/types';

/* ── Manifest Lineage Graph View ───────────────────────────────── */

interface LineageNode {
  id: string;
  label: string;
  type: 'active' | 'parent' | 'ingredient' | 'original';
  issuer?: string;
  algorithm?: string;
  date?: string;
  assertionCount?: number;
  x: number;
  y: number;
}

interface LineageEdge {
  from: string;
  to: string;
  type: 'parent' | 'ingredient' | 'replaced';
}

function buildLineage(result: VerificationResult): { nodes: LineageNode[]; edges: LineageEdge[] } {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const manifests = result.manifests;

  manifests.forEach((m, idx) => {
    const isActive = m.isActive;
    const nodeType: LineageNode['type'] = isActive ? 'active' : idx === manifests.length - 1 ? 'original' : 'parent';

    nodes.push({
      id: m.label,
      label: isActive ? `${m.label} (Active)` : m.label,
      type: nodeType,
      issuer: m.issuer,
      algorithm: m.signatureAlgorithm,
      date: m.signedAt,
      assertionCount: m.assertions.length,
      x: 160,
      y: 100 + idx * 160,
    });

    // Connect to previous manifest (parent chain)
    if (idx > 0) {
      edges.push({
        from: manifests[idx - 1].label,
        to: m.label,
        type: 'parent',
      });
    }

    // Add ingredients as nodes and edges
    (m.ingredients ?? []).forEach((ing, ingIdx) => {
      const ingId = `${m.label}-ing-${ingIdx}`;
      nodes.push({
        id: ingId,
        label: ing,
        type: 'ingredient',
        x: 420 + (ingIdx % 3) * 140,
        y: 100 + idx * 160 + Math.floor(ingIdx / 3) * 60,
      });
      edges.push({
        from: m.label,
        to: ingId,
        type: 'ingredient',
      });
    });
  });

  return { nodes, edges };
}

export function LineageView({ result, showToast }: { result: VerificationResult | null; showToast: (msg: string) => void }) {
  const [selectedNode, setSelectedNode] = useState<LineageNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef<{ startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  const { nodes, edges } = result ? buildLineage(result) : { nodes: [], edges: [] };

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width || 800);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const graphWidth = Math.max(containerWidth, 800);
  const graphHeight = Math.max(600, nodes.length * 160 + 200);

  function handleMouseDown(e: React.MouseEvent) {
    if (e.target === svgRef.current || (e.target as SVGElement).tagName === 'rect') {
      dragging.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y };
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.startX;
    const dy = e.clientY - dragging.current.startY;
    setOffset({ x: dragging.current.offsetX + dx, y: dragging.current.offsetY + dy });
  }

  function handleMouseUp() {
    dragging.current = null;
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(2, Math.max(0.3, z + delta)));
  }

  function fitToView() {
    setOffset({ x: 0, y: 0 });
    setZoom(1);
  }

  function getNodeColor(type: LineageNode['type']) {
    switch (type) {
      case 'active': return 'var(--color-primary)';
      case 'parent': return 'var(--color-secondary)';
      case 'ingredient': return 'var(--color-tertiary)';
      case 'original': return '#f59e0b';
      default: return 'var(--color-outline)';
    }
  }

  function getNodeRadius(type: LineageNode['type']) {
    return type === 'active' ? 32 : type === 'ingredient' ? 22 : 26;
  }

  return (
    <main className="lineage-view">
      <div className="lineage-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Manifest Lineage</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Visualize the provenance chain — parent manifests, ingredients, and content flow.
          </p>
        </div>
        <div className="lineage-controls">
          <button className="action-tactile button-ghost" type="button" onClick={fitToView}>
            <Maximize size={15} /> Fit
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={() => setZoom((z) => Math.min(2, z + 0.2))}>
            <ZoomIn size={15} />
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}>
            <ZoomOut size={15} />
          </button>
        </div>
      </div>

      {!result ? (
        <div className="lineage-empty">
          <GitBranch size={48} style={{ color: 'var(--color-outline)' }} />
          <h3>No manifest data</h3>
          <p>Verify a file in the Inspector tab first to see its lineage graph.</p>
        </div>
      ) : (
        <div className="lineage-content">
          {/* Legend */}
          <div className="lineage-legend">
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('active') }} />
              <span>Active Manifest</span>
            </div>
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('parent') }} />
              <span>Parent Manifest</span>
            </div>
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('ingredient') }} />
              <span>Ingredient</span>
            </div>
            <div className="lineage-legend-item">
              <span className="lineage-dot" style={{ background: getNodeColor('original') }} />
              <span>Original</span>
            </div>
          </div>

          {/* Graph */}
          <div className="lineage-graph-wrap" ref={containerRef}>
            <svg
              ref={svgRef}
              className="lineage-svg"
              width="100%"
              height="100%"
              viewBox={`0 0 ${graphWidth} ${graphHeight}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            >
              <g transform={`translate(${offset.x}, ${offset.y}) scale(${zoom})`}>
                {/* Edges */}
                {edges.map((edge, i) => {
                  const fromNode = nodes.find((n) => n.id === edge.from);
                  const toNode = nodes.find((n) => n.id === edge.to);
                  if (!fromNode || !toNode) return null;
                  return (
                    <line
                      key={i}
                      x1={fromNode.x + getNodeRadius(fromNode.type) + 8}
                      y1={fromNode.y}
                      x2={toNode.x - getNodeRadius(toNode.type) - 8}
                      y2={toNode.y}
                      stroke={edge.type === 'ingredient' ? 'rgba(78, 222, 163, 0.4)' : 'rgba(208, 188, 255, 0.4)'}
                      strokeWidth={2}
                      strokeDasharray={edge.type === 'replaced' ? '4,4' : 'none'}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes.map((node) => {
                  const r = getNodeRadius(node.type);
                  const isSelected = selectedNode?.id === node.id;
                  return (
                    <g
                      key={node.id}
                      className={`lineage-node ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setSelectedNode(node); }}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Glow for active */}
                      {node.type === 'active' && (
                        <circle cx={node.x} cy={node.y} r={r + 6} fill={getNodeColor('active')} opacity={0.15} />
                      )}
                      {/* Main circle */}
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={r}
                        fill="var(--color-surface-container)"
                        stroke={getNodeColor(node.type)}
                        strokeWidth={isSelected ? 3 : 2}
                      />
                      {/* Label */}
                      <text
                        x={node.x}
                        y={node.y + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="var(--color-on-surface)"
                        fontSize={node.type === 'active' ? 12 : 10}
                        fontFamily="'JetBrains Mono', monospace"
                        fontWeight={node.type === 'active' ? 600 : 400}
                      >
                        {node.type === 'ingredient' ? 'I' : node.label.split('_')[0]?.slice(0, 4) ?? ''}
                      </text>
                      {/* Full label below */}
                      <text
                        x={node.x}
                        y={node.y + r + 16}
                        textAnchor="middle"
                        fill="var(--color-on-surface-dim)"
                        fontSize={11}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {node.label.length > 24 ? node.label.slice(0, 22) + '…' : node.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Selected Node Details */}
          {selectedNode && (
            <div className="lineage-detail">
              <div className="lineage-detail-header">
                <h3>{selectedNode.label}</h3>
                <button className="action-tactile button-ghost" type="button" onClick={() => setSelectedNode(null)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="lineage-detail-grid">
                <div className="lineage-detail-item">
                  <span>Type</span>
                  <strong style={{ color: getNodeColor(selectedNode.type) }}>
                    {selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1)}
                  </strong>
                </div>
                {selectedNode.issuer && (
                  <div className="lineage-detail-item">
                    <span>Issuer</span>
                    <strong>{selectedNode.issuer}</strong>
                  </div>
                )}
                {selectedNode.algorithm && (
                  <div className="lineage-detail-item">
                    <span>Algorithm</span>
                    <strong>{selectedNode.algorithm}</strong>
                  </div>
                )}
                {selectedNode.date && (
                  <div className="lineage-detail-item">
                    <span>Date</span>
                    <strong>{selectedNode.date}</strong>
                  </div>
                )}
                {selectedNode.assertionCount !== undefined && (
                  <div className="lineage-detail-item">
                    <span>Assertions</span>
                    <strong>{selectedNode.assertionCount}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
