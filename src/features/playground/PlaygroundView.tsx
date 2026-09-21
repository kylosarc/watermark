import { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Play,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Upload,
} from 'lucide-react';
import { verifyFile } from '../../lib/c2pa';
import { errorResult } from '../../lib/verification';
import { formatBytes } from '../../lib/file';
import type { VerificationResult } from '../../lib/types';
import { storePlaygroundRules, getStoredPlaygroundRules } from '../../lib/persist';

const ACCEPTED_TYPES = 'image/*,video/mp4,video/quicktime,audio/*';

interface PolicyRule {
  id: string;
  type: 'require_assertion' | 'reject_algorithm' | 'require_issuer' | 'reject_issuer' | 'min_trust' | 'require_binding';
  label: string;
  value: string;
  enabled: boolean;
}

const DEFAULT_RULES: PolicyRule[] = [
  { id: '1', type: 'require_binding', label: 'Require valid content binding', value: 'true', enabled: true },
  { id: '2', type: 'min_trust', label: 'Minimum trust level', value: 'Trusted', enabled: true },
  { id: '3', type: 'require_assertion', label: 'Require assertion: c2pa.hash', value: 'c2pa.hash', enabled: false },
  { id: '4', type: 'require_assertion', label: 'Require assertion: c2pa CLAIM_SIGNATURE', value: 'c2pa CLAIM_SIGNATURE', enabled: false },
  { id: '5', type: 'reject_algorithm', label: 'Reject algorithm: sha-1', value: 'sha-1', enabled: false },
  { id: '6', type: 'require_issuer', label: 'Require issuer contains', value: '', enabled: false },
  { id: '7', type: 'reject_issuer', label: 'Reject issuer contains', value: '', enabled: false },
];

interface PolicyCheck {
  ruleId: string;
  passed: boolean;
  message: string;
}

function evaluatePolicy(result: VerificationResult, rules: PolicyRule[]): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  const activeRules = rules.filter((r) => r.enabled);
  const manifest = result.manifests.find((m) => m.isActive) ?? result.manifests[0];

  for (const rule of activeRules) {
    switch (rule.type) {
      case 'require_binding': {
        const passed = result.status === 'ready' && result.validationState !== 'Invalid';
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed ? 'Content binding valid' : 'Content binding missing or invalid',
        });
        break;
      }
      case 'min_trust': {
        const levels: Record<string, number> = { Trusted: 3, Valid: 2, Missing: 1, Invalid: 0, Error: 0 };
        const currentLevel = levels[result.validationState] ?? 0;
        const requiredLevel = levels[rule.value] ?? 0;
        const passed = currentLevel >= requiredLevel;
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Trust level "${result.validationState}" meets minimum "${rule.value}"`
            : `Trust level "${result.validationState}" below minimum "${rule.value}"`,
        });
        break;
      }
      case 'require_assertion': {
        const assertions = new Set(manifest?.assertions ?? []);
        const passed = assertions.has(rule.value);
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Assertion "${rule.value}" present`
            : `Assertion "${rule.value}" missing`,
        });
        break;
      }
      case 'reject_algorithm': {
        const alg = manifest?.signatureAlgorithm?.toLowerCase() ?? '';
        const passed = !alg.includes(rule.value.toLowerCase());
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Algorithm "${alg}" not rejected`
            : `Algorithm "${alg}" matches rejected pattern "${rule.value}"`,
        });
        break;
      }
      case 'require_issuer': {
        const issuer = manifest?.issuer?.toLowerCase() ?? '';
        const passed = rule.value ? issuer.includes(rule.value.toLowerCase()) : true;
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Issuer "${manifest?.issuer}" matches required pattern`
            : `Issuer "${manifest?.issuer}" does not contain "${rule.value}"`,
        });
        break;
      }
      case 'reject_issuer': {
        const issuer = manifest?.issuer?.toLowerCase() ?? '';
        const passed = rule.value ? !issuer.includes(rule.value.toLowerCase()) : true;
        checks.push({
          ruleId: rule.id,
          passed,
          message: passed
            ? `Issuer "${manifest?.issuer}" not rejected`
            : `Issuer "${manifest?.issuer}" matches rejected pattern "${rule.value}"`,
        });
        break;
      }
    }
  }

  return checks;
}

export function PlaygroundView({ showToast }: { showToast: (msg: string) => void }) {
  const [rules, setRules] = useState<PolicyRule[]>(() => {
    const stored = getStoredPlaygroundRules();
    if (stored.length === 0) return DEFAULT_RULES;
    return stored.map((r) => ({
      ...DEFAULT_RULES.find((d) => d.id === r.id) ?? { id: r.id, type: 'require_assertion' as const, label: r.field },
      id: r.id,
      label: r.field,
      value: r.value,
      enabled: r.enabled,
    }));
  });
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [checks, setChecks] = useState<PolicyCheck[]>([]);
  const [verifying, setVerifying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persistence: save playground rules
  useEffect(() => {
    storePlaygroundRules(rules.map((r) => ({
      id: r.id,
      field: r.label,
      operator: r.type,
      value: r.value ?? '',
      enabled: r.enabled,
    })));
  }, [rules]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, []);

  function toggleRule(id: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function updateRuleValue(id: string, value: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  function addRule() {
    const newRule: PolicyRule = {
      id: Date.now().toString(),
      type: 'require_assertion',
      label: 'New assertion check',
      value: '',
      enabled: false,
    };
    setRules((prev) => [...prev, newRule]);
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  function resetRules() {
    setRules(DEFAULT_RULES);
    showToast('Rules reset to defaults');
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setChecks([]);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
    setChecks([]);
  }

  async function testPolicy() {
    if (!sourceFile) return;
    setVerifying(true);
    try {
      const res = await verifyFile(sourceFile);
      setResult(res);
      const policyChecks = evaluatePolicy(res, rules);
      setChecks(policyChecks);
      const passed = policyChecks.every((c) => c.passed);
      showToast(passed ? 'All policy rules passed' : 'Some policy rules failed');
    } catch (err) {
      const errRes = errorResult(sourceFile.name, sourceFile.size, sourceFile.type, '', err);
      setResult(errRes);
      setChecks([{ ruleId: 'error', passed: false, message: 'Verification failed' }]);
    }
    setVerifying(false);
  }

  function clearAll() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null);
    setPreviewUrl(null);
    setResult(null);
    setChecks([]);
    showToast('Playground cleared');
  }

  function exportPolicy() {
    const policy = {
      rules: rules.filter((r) => r.enabled),
      result: result ? {
        file: sourceFile?.name,
        validationState: result.validationState,
        checks: checks,
      } : null,
    };
    const json = JSON.stringify(policy, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trust-policy-${sourceFile?.name ?? 'config'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Policy exported');
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = checks.filter((c) => !c.passed).length;
  const allPassed = checks.length > 0 && failedCount === 0;

  const ruleTypeLabels: Record<string, string> = {
    require_binding: 'Binding',
    min_trust: 'Trust',
    require_assertion: 'Assertion',
    reject_algorithm: 'Algorithm',
    require_issuer: 'Issuer',
    reject_issuer: 'Issuer',
  };

  return (
    <main className="pg-view">
      <div className="pg-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' }}>Trust Policy Playground</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-on-surface-dim)', marginTop: 4 }}>
            Define custom trust rules, then drop a file to see if it passes your policy.
          </p>
        </div>
        {checks.length > 0 && (
          <button className="action-tactile button-ghost" type="button" onClick={exportPolicy}>
            <Download size={15} /> Export Policy
          </button>
        )}
      </div>

      {/* Policy Rules Editor */}
      <div className="pg-rules">
        <div className="pg-rules-header">
          <h2>Policy Rules</h2>
          <div className="pg-rules-actions">
            <button className="action-tactile button-ghost" type="button" onClick={resetRules}>
              <RefreshCw size={14} /> Reset
            </button>
            <button className="action-tactile button-ghost" type="button" onClick={addRule}>
              <Check size={14} /> Add Rule
            </button>
          </div>
        </div>
        <div className="pg-rules-list">
          {rules.map((rule) => (
            <div key={rule.id} className={`pg-rule ${rule.enabled ? 'enabled' : 'disabled'}`}>
              <button
                className={`pg-rule-toggle ${rule.enabled ? 'active' : ''}`}
                type="button"
                onClick={() => toggleRule(rule.id)}
              >
                {rule.enabled ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
              </button>
              <div className="pg-rule-info">
                <span className="pg-rule-type">{ruleTypeLabels[rule.type]}</span>
                <span className="pg-rule-label">{rule.label}</span>
              </div>
              {(rule.type === 'require_assertion' || rule.type === 'reject_algorithm' || rule.type === 'require_issuer' || rule.type === 'reject_issuer') && (
                <input
                  className="pg-rule-input"
                  type="text"
                  placeholder="value..."
                  value={rule.value}
                  onChange={(e) => updateRuleValue(rule.id, e.target.value)}
                />
              )}
              {rule.type === 'min_trust' && (
                <select
                  className="pg-rule-select"
                  value={rule.value}
                  onChange={(e) => updateRuleValue(rule.id, e.target.value)}
                >
                  <option value="Trusted">Trusted</option>
                  <option value="Valid">Valid</option>
                  <option value="Missing">Missing</option>
                </select>
              )}
              <button
                className="pg-rule-remove"
                type="button"
                onClick={() => removeRule(rule.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* File Drop Zone */}
      <div
        className="pg-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {previewUrl ? (
          <div className="pg-drop-preview">
            <img src={previewUrl} alt="Source file" />
            <div className="pg-drop-info">
              <span className="pg-drop-name" title={sourceFile?.name ?? ''}>{sourceFile?.name}</span>
              <span className="pg-drop-meta">{sourceFile ? formatBytes(sourceFile.size) : ''} • {sourceFile?.type}</span>
            </div>
          </div>
        ) : (
          <div className="pg-drop-empty">
            <Upload size={36} style={{ color: 'var(--color-outline)' }} />
            <strong>Drop a signed image to test your policy</strong>
            <span>or click to browse</span>
          </div>
        )}
        <input ref={fileInputRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES} onChange={handleFileInput} />
      </div>

      {/* Test Button */}
      {sourceFile && checks.length === 0 && (
        <div className="pg-actions">
          <button
            className="action-tactile button-primary"
            type="button"
            onClick={testPolicy}
            disabled={verifying}
          >
            {verifying ? <RefreshCw size={16} className="spin" /> : <Play size={16} />}
            {verifying ? 'Testing...' : 'Test Policy'}
          </button>
          <button className="action-tactile button-ghost" type="button" onClick={clearAll}>
            <Trash2 size={15} /> Clear
          </button>
        </div>
      )}

      {/* Results */}
      {checks.length > 0 && (
        <div className="pg-results">
          <div className={`pg-verdict ${allPassed ? 'pass' : 'fail'}`}>
            {allPassed ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
            <div className="pg-verdict-text">
              <strong>{allPassed ? 'Policy Passed' : 'Policy Failed'}</strong>
              <span>{passedCount}/{checks.length} rules passed</span>
            </div>
          </div>

          <div className="pg-checks">
            {checks.map((check) => (
              <div key={check.ruleId} className={`pg-check ${check.passed ? 'passed' : 'failed'}`}>
                <span className="pg-check-icon">
                  {check.passed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                </span>
                <span className="pg-check-message">{check.message}</span>
              </div>
            ))}
          </div>

          {result && (
            <div className="pg-file-info">
              <h3>File Details</h3>
              <div className="pg-file-grid">
                <div className="pg-file-item">
                  <span>Validation State</span>
                  <strong>{result.validationState}</strong>
                </div>
                <div className="pg-file-item">
                  <span>Status</span>
                  <strong>{result.status}</strong>
                </div>
                <div className="pg-file-item">
                  <span>Manifests</span>
                  <strong>{result.manifestCount}</strong>
                </div>
                <div className="pg-file-item">
                  <span>Issuer</span>
                  <strong>{result.manifests[0]?.issuer ?? 'N/A'}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
