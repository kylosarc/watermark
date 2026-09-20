import { createC2pa, Reader, Context } from '@contentauth/c2pa-web';
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';
import type { VerificationResult } from './types';
import { getMediaFormat, sha256Hex } from './file';
import { errorResult, missingCredentialResult, summarizeManifestStore } from './verification';

let sdkPromise: Promise<Awaited<ReturnType<typeof createC2pa>>> | undefined;
let defaultContext: Context | undefined;

function getC2pa(): Promise<Awaited<ReturnType<typeof createC2pa>>> {
  sdkPromise ??= createC2pa({ wasmSrc });
  return sdkPromise;
}

function getContext(): Context {
  if (!defaultContext) {
    defaultContext = new Context({
      verify: { verifyTrust: true },
    });
  }
  return defaultContext;
}

export async function verifyFile(file: File): Promise<VerificationResult> {
  const fileName = file.name || 'Untitled asset';
  const mimeType = file.type || 'application/octet-stream';
  const sha256 = await sha256Hex(file);

  try {
    const sdk = await getC2pa();
    const format = getMediaFormat(fileName, mimeType);
    const reader = await Reader.fromBlob(sdk, format, file, getContext());

    if (!reader) {
      return missingCredentialResult(fileName, file.size, mimeType, sha256);
    }

    try {
      const store = await reader.manifestStore();
      return summarizeManifestStore(store, fileName, file.size, mimeType, sha256);
    } finally {
      await reader.free().catch(() => undefined);
    }
  } catch (error) {
    return errorResult(fileName, file.size, mimeType, sha256, error);
  }
}

export function disposeC2pa(): void {
  if (sdkPromise) {
    void sdkPromise.then((sdk) => sdk.dispose());
    sdkPromise = undefined;
  }
  defaultContext = undefined;
}
