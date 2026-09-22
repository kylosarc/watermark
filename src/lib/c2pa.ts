import { createC2pa, Reader } from '@contentauth/c2pa-web';
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';
import type { VerificationResult } from './types';
import { getMediaFormat, sha256Hex } from './file';
import { errorResult, missingCredentialResult, summarizeManifestStore } from './verification';
import { auditLog } from './audit';

let sdkPromise: Promise<Awaited<ReturnType<typeof createC2pa>>> | undefined;

function getC2pa(): Promise<Awaited<ReturnType<typeof createC2pa>>> {
  sdkPromise ??= createC2pa({ wasmSrc });
  return sdkPromise;
}

export async function verifyFile(file: File): Promise<VerificationResult> {
  const fileName = file.name || 'Untitled asset';
  const mimeType = file.type || 'application/octet-stream';

  // Compute hash first — this is our own code, safe
  let sha256 = '';
  try {
    sha256 = await sha256Hex(file);
  } catch {
    sha256 = 'hash-unavailable';
  }

  try {
    const sdk = await getC2pa();
    const format = getMediaFormat(fileName, mimeType);

    // 0.15.x: use static Reader.fromBlob() — old sdk.reader pattern is removed
    const reader = await Reader.fromBlob(sdk, format, file);

    if (!reader) {
      return missingCredentialResult(fileName, file.size, mimeType, sha256);
    }

    try {
      const store = await reader.manifestStore();
      const result = summarizeManifestStore(store, fileName, file.size, mimeType, sha256);
      auditLog('verify', `${fileName} → ${result.validationState} (${result.manifestCount} manifests)`, 'verify');
      return result;
    } finally {
      await reader.free().catch(() => undefined);
    }
  } catch (error) {
    // SDK errors are common with malformed files — return a safe error result
    console.warn(`[verifyFile] ${fileName}:`, error);
    return errorResult(fileName, file.size, mimeType, sha256, error);
  }
}

export function disposeC2pa(): void {
  if (sdkPromise) {
    void sdkPromise.then((sdk) => sdk.dispose());
    sdkPromise = undefined;
  }
}
