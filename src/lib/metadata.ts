/**
 * Metadata extraction and binary analysis for any file type.
 * Uses exifr for image metadata, custom parsers for binary structure.
 */

import exifr from 'exifr';

// ── Types ──────────────────────────────────────────────────────

export interface MetadataSection {
  label: string;
  entries: MetadataEntry[];
}

export interface MetadataEntry {
  key: string;
  value: string;
  category: 'info' | 'camera' | 'location' | 'dates' | '版权' | 'technical' | 'ai' | 'warning';
}

export interface BinaryInfo {
  magicBytes: string;
  detectedType: string;
  fileSize: number;
  entropy: number;
  hexPreview: string;
  structure: BinaryStructure[];
}

export interface BinaryStructure {
  name: string;
  offset: number;
  length: number;
  description: string;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  sections: MetadataSection[];
  binary: BinaryInfo;
  raw: Record<string, unknown>;
}

// ── Magic Bytes ────────────────────────────────────────────────

const MAGIC_BYTES: Array<{ bytes: string; type: string; mime: string }> = [
  { bytes: '89504E47', type: 'PNG Image', mime: 'image/png' },
  { bytes: 'FFD8FF', type: 'JPEG Image', mime: 'image/jpeg' },
  { bytes: '47494638', type: 'GIF Image', mime: 'image/gif' },
  { bytes: '52494646', type: 'RIFF Container (WebP/WAV/AVI)', mime: 'application/octet-stream' },
  { bytes: '25504446', type: 'PDF Document', mime: 'application/pdf' },
  { bytes: '504B0304', type: 'ZIP Archive (DOCX/PPTX/XLSX)', mime: 'application/zip' },
  { bytes: '4F676753', type: 'Ogg Container', mime: 'application/ogg' },
  { bytes: '1A45DFA3', type: 'MKV/WebM (EBML)', mime: 'video/webm' },
  { bytes: '00000018', type: 'MP4/MOV Container', mime: 'video/mp4' },
  { bytes: '0000001C', type: 'MP4/MOV Container', mime: 'video/mp4' },
  { bytes: '00000020', type: 'MP4/MOV Container', mime: 'video/mp4' },
  { bytes: '66747970', type: 'MP4/MOV (ftyp)', mime: 'video/mp4' },
  { bytes: '494433', type: 'MP3 Audio (ID3)', mime: 'audio/mpeg' },
  { bytes: 'FFF1', type: 'AAC Audio', mime: 'audio/aac' },
  { bytes: 'FFF9', type: 'AAC Audio', mime: 'audio/aac' },
  { bytes: '4F6767', type: 'Ogg Audio', mime: 'audio/ogg' },
  { bytes: '52415221', type: 'RAR Archive', mime: 'application/x-rar-compressed' },
  { bytes: '377ABCAF', type: '7z Archive', mime: 'application/x-7z-compressed' },
  { bytes: '1F8B', type: 'Gzip Archive', mime: 'application/gzip' },
];

// ── Entropy Calculation ────────────────────────────────────────

function calculateEntropy(data: Uint8Array): number {
  const freq = new Array(256).fill(0);
  for (const byte of data) freq[byte]++;

  let entropy = 0;
  const len = data.length;
  for (const f of freq) {
    if (f > 0) {
      const p = f / len;
      entropy -= p * Math.log2(p);
    }
  }
  return Math.round(entropy * 1000) / 1000;
}

// ── Hex Preview ────────────────────────────────────────────────

function getHexPreview(data: Uint8Array, maxBytes = 256): string {
  const slice = data.slice(0, maxBytes);
  const lines: string[] = [];
  for (let i = 0; i < slice.length; i += 16) {
    const chunk = slice.slice(i, i + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48)}  ${ascii}`);
  }
  return lines.join('\n');
}

// ── Detect File Type from Magic Bytes ──────────────────────────

function detectMagicBytes(data: Uint8Array): { bytes: string; type: string } {
  const header = Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  for (const magic of MAGIC_BYTES) {
    if (header.startsWith(magic.bytes)) {
      return { bytes: magic.bytes, type: magic.type };
    }
  }

  return { bytes: header.slice(0, 16), type: 'Unknown' };
}

// ── Binary Structure Detection ─────────────────────────────────

function detectStructure(data: Uint8Array, mimeType: string): BinaryStructure[] {
  const structures: BinaryStructure[] = [];

  if (mimeType === 'image/jpeg') {
    // JPEG markers
    let offset = 0;
    while (offset < data.length - 1) {
      if (data[offset] === 0xFF) {
        const marker = data[offset + 1];
        if (marker === 0xD8) {
          structures.push({ name: 'SOI', offset, length: 2, description: 'Start of Image' });
          offset += 2;
        } else if (marker === 0xD9) {
          structures.push({ name: 'EOI', offset, length: 2, description: 'End of Image' });
          break;
        } else if (marker === 0xE1) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: 'APP1 (EXIF/XMP)', offset, length: len + 2, description: `EXIF/XMP data (${len} bytes)` });
          offset += len + 2;
        } else if (marker === 0xE2) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: 'APP2 (ICC)', offset, length: len + 2, description: `ICC profile (${len} bytes)` });
          offset += len + 2;
        } else if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: `SOF${marker - 0xC0}`, offset, length: len + 2, description: 'Start of Frame' });
          offset += len + 2;
        } else if (marker === 0xC4) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: 'DHT', offset, length: len + 2, description: 'Huffman Table' });
          offset += len + 2;
        } else if (marker === 0xDB) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: 'DQT', offset, length: len + 2, description: 'Quantization Table' });
          offset += len + 2;
        } else if (marker === 0xDA) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: 'SOS', offset, length: len + 2, description: 'Start of Scan (compressed data begins)' });
          offset += len + 2;
        } else if (marker === 0xFE) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: 'COM', offset, length: len + 2, description: `Comment (${len} bytes)` });
          offset += len + 2;
        } else if (marker >= 0xE0 && marker <= 0xEF) {
          const len = (data[offset + 2] << 8) | data[offset + 3];
          structures.push({ name: `APP${marker - 0xE0}`, offset, length: len + 2, description: `Application segment (${len} bytes)` });
          offset += len + 2;
        } else if (marker !== 0x00 && marker !== 0xFF) {
          offset += 2;
        } else {
          offset++;
        }
      } else {
        offset++;
      }
    }
  } else if (mimeType === 'image/png') {
    // PNG chunks
    let offset = 8; // Skip signature
    while (offset < data.length - 8) {
      const len = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
      const chunkType = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
      const descriptions: Record<string, string> = {
        'IHDR': 'Image Header',
        'PLTE': 'Palette',
        'IDAT': 'Image Data',
        'IEND': 'Image End',
        'tEXt': 'Text Metadata',
        'zTXt': 'Compressed Text',
        'iTXt': 'International Text',
        'gAMA': 'Gamma',
        'cHRM': 'Chroma',
        'sRGB': 'Color Space',
        'iCCP': 'ICC Profile',
        'tRNS': 'Transparency',
        'bKGD': 'Background',
        'pHYs': 'Physical Dimensions',
        'tIME': 'Last Modification Time',
      };
      structures.push({
        name: chunkType,
        offset,
        length: len + 12,
        description: descriptions[chunkType] || `Unknown chunk (${len} bytes)`,
      });
      offset += len + 12;
      if (chunkType === 'IEND') break;
    }
  }

  return structures;
}

// ── Extract Image Metadata with exifr ──────────────────────────

async function extractImageMetadata(file: File): Promise<MetadataSection[]> {
  const sections: MetadataSection[] = [];

  try {
    const data = await exifr.parse(file, true);
    if (!data) return sections;

    // Technical info
    const techEntries: MetadataEntry[] = [];
    if (data.Make) techEntries.push({ key: 'Camera Make', value: String(data.Make), category: 'camera' });
    if (data.Model) techEntries.push({ key: 'Camera Model', value: String(data.Model), category: 'camera' });
    if (data.LensModel) techEntries.push({ key: 'Lens', value: String(data.LensModel), category: 'camera' });
    if (data.FocalLength) techEntries.push({ key: 'Focal Length', value: `${data.FocalLength}mm`, category: 'camera' });
    if (data.FNumber) techEntries.push({ key: 'Aperture', value: `f/${data.FNumber}`, category: 'camera' });
    if (data.ExposureTime) techEntries.push({ key: 'Exposure', value: data.ExposureTime < 1 ? `1/${Math.round(1 / data.ExposureTime)}s` : `${data.ExposureTime}s`, category: 'camera' });
    if (data.ISO) techEntries.push({ key: 'ISO', value: String(data.ISO), category: 'camera' });
    if (data.PixelXDimension) techEntries.push({ key: 'Width', value: `${data.PixelXDimension}px`, category: 'technical' });
    if (data.PixelYDimension) techEntries.push({ key: 'Height', value: `${data.PixelYDimension}px`, category: 'technical' });
    if (data.ColorSpace) techEntries.push({ key: 'Color Space', value: data.ColorSpace === 1 ? 'sRGB' : `Space ${data.ColorSpace}`, category: 'technical' });
    if (data.InteropSpace) techEntries.push({ key: 'Interop Space', value: String(data.InteropSpace), category: 'technical' });
    if (techEntries.length > 0) sections.push({ label: 'Camera & Technical', entries: techEntries });

    // Dates
    const dateEntries: MetadataEntry[] = [];
    if (data.DateTimeOriginal) dateEntries.push({ key: 'Date Taken', value: String(data.DateTimeOriginal), category: 'dates' });
    if (data.DateTimeDigitized) dateEntries.push({ key: 'Date Digitized', value: String(data.DateTimeDigitized), category: 'dates' });
    if (data.ModifyDate) dateEntries.push({ key: 'Last Modified', value: String(data.ModifyDate), category: 'dates' });
    if (dateEntries.length > 0) sections.push({ label: 'Dates', entries: dateEntries });

    // Location
    const locEntries: MetadataEntry[] = [];
    if (data.GPSLatitude && data.GPSLongitude) {
      const lat = data.GPSLatitude * (data.GPSLatitudeRef === 'S' ? -1 : 1);
      const lon = data.GPSLongitude * (data.GPSLongitudeRef === 'W' ? -1 : 1);
      locEntries.push({ key: 'GPS', value: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, category: 'location' });
      locEntries.push({ key: 'Google Maps', value: `https://maps.google.com/?q=${lat},${lon}`, category: 'location' });
    }
    if (data.GPSAltitude) locEntries.push({ key: 'Altitude', value: `${data.GPSAltitude}m`, category: 'location' });
    if (locEntries.length > 0) sections.push({ label: 'Location', entries: locEntries });

    // Copyright & author
    const copyEntries: MetadataEntry[] = [];
    if (data.Artist) copyEntries.push({ key: 'Artist', value: String(data.Artist), category: '版权' });
    if (data.Copyright) copyEntries.push({ key: 'Copyright', value: String(data.Copyright), category: '版权' });
    if (data.ImageDescription) copyEntries.push({ key: 'Description', value: String(data.ImageDescription), category: '版权' });
    if (data.UserComment) copyEntries.push({ key: 'User Comment', value: String(data.UserComment), category: '版权' });
    if (data.Rating) copyEntries.push({ key: 'Rating', value: String(data.Rating), category: '版权' });
    if (copyEntries.length > 0) sections.push({ label: 'Copyright & Author', entries: copyEntries });

    // AI/Algorithm detection
    const aiEntries: MetadataEntry[] = [];
    if (data.Software) aiEntries.push({ key: 'Software', value: String(data.Software), category: 'ai' });
    if (data.ProcessingSoftware) aiEntries.push({ key: 'Processing', value: String(data.ProcessingSoftware), category: 'ai' });
    if (data.HostComputer) aiEntries.push({ key: 'Host', value: String(data.HostComputer), category: 'ai' });
    // Check for AI-generated indicators
    const aiKeywords = ['midjourney', 'dall-e', 'stable diffusion', 'firefly', 'imagen', 'synthid', 'ai generated', 'generated'];
    const allText = [data.Software, data.ProcessingSoftware, data.ImageDescription, data.UserComment, data.Artist].filter(Boolean).join(' ').toLowerCase();
    for (const kw of aiKeywords) {
      if (allText.includes(kw)) {
        aiEntries.push({ key: '⚠️ AI Indicator', value: `Detected "${kw}" in metadata`, category: 'warning' });
        break;
      }
    }
    if (aiEntries.length > 0) sections.push({ label: 'Software & AI Detection', entries: aiEntries });

  } catch (e) {
    sections.push({
      label: 'Error',
      entries: [{ key: 'Parse Error', value: String(e), category: 'warning' }],
    });
  }

  return sections;
}

// ── Main Entry Point ───────────────────────────────────────────

export async function extractFileMetadata(file: File, sha256: string): Promise<FileMetadata> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Detect magic bytes
  const magic = detectMagicBytes(data);

  // Calculate entropy
  const entropy = calculateEntropy(data);

  // Hex preview
  const hexPreview = getHexPreview(data);

  // Binary structure
  const structure = detectStructure(data, file.type);

  // Image metadata
  let sections: MetadataSection[] = [];
  if (file.type.startsWith('image/')) {
    sections = await extractImageMetadata(file);
  }

  // Always add a file info section
  const infoEntries: MetadataEntry[] = [
    { key: 'File Name', value: file.name, category: 'info' },
    { key: 'File Size', value: formatBytes(file.size), category: 'info' },
    { key: 'MIME Type', value: file.type || 'unknown', category: 'info' },
    { key: 'Detected Type', value: magic.type, category: 'info' },
    { key: 'Magic Bytes', value: magic.bytes, category: 'technical' },
    { key: 'Entropy', value: `${entropy} / 8.0 ${entropy > 7.5 ? '(high — possibly encrypted/compressed)' : entropy < 1 ? '(low — mostly zeros)' : ''}`, category: 'technical' },
    { key: 'SHA-256', value: sha256, category: 'technical' },
  ];
  sections.unshift({ label: 'File Info', entries: infoEntries });

  return {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    sha256,
    sections,
    binary: {
      magicBytes: magic.bytes,
      detectedType: magic.type,
      fileSize: file.size,
      entropy,
      hexPreview,
      structure,
    },
    raw: {},
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ── Metadata Sanitizer ─────────────────────────────────────────

export const SANITIZE_PRESETS: Record<string, { label: string; keep: string[] }> = {
  minimal: {
    label: 'Minimal (strip everything)',
    keep: ['File Info'],
  },
  social: {
    label: 'Social Media Safe',
    keep: ['File Info', 'Camera & Technical', 'Dates'],
  },
  professional: {
    label: 'Professional Portfolio',
    keep: ['File Info', 'Camera & Technical', 'Dates', 'Copyright & Author'],
  },
  forensic: {
    label: 'Forensic (keep all)',
    keep: ['File Info', 'Camera & Technical', 'Dates', 'Location', 'Copyright & Author', 'Software & AI Detection'],
  },
  redact: {
    label: 'Privacy (strip location + author)',
    keep: ['File Info', 'Camera & Technical', 'Dates', 'Software & AI Detection'],
  },
};

export interface SanitizeResult {
  sections: MetadataSection[];
  removedCount: number;
  keptCount: number;
}

export function sanitizeMetadata(
  metadata: FileMetadata,
  keepSections: string[]
): SanitizeResult {
  const kept: MetadataEntry[] = [];
  const removed: MetadataEntry[] = [];

  for (const section of metadata.sections) {
    if (keepSections.includes(section.label)) {
      kept.push(...section.entries);
    } else {
      removed.push(...section.entries);
    }
  }

  return {
    sections: keepSections
      .filter((label) => metadata.sections.some((s) => s.label === label))
      .map((label) => ({
        label,
        entries: metadata.sections.find((s) => s.label === label)?.entries ?? [],
      })),
    removedCount: removed.length,
    keptCount: kept.length,
  };
}

// ── Metadata Editor (for plain text fields) ────────────────────

export interface EditableField {
  section: string;
  key: string;
  value: string;
  editable: true;
}

export function getEditableFields(metadata: FileMetadata): EditableField[] {
  const editable = new Set([
    'Artist', 'Copyright', 'ImageDescription', 'UserComment',
    'Software', 'ProcessingSoftware', 'HostComputer', 'Rating',
    'DateTimeOriginal', 'DateTimeDigitized', 'ModifyDate',
  ]);

  const fields: EditableField[] = [];
  for (const section of metadata.sections) {
    for (const entry of section.entries) {
      if (editable.has(entry.key)) {
        fields.push({
          section: section.label,
          key: entry.key,
          value: entry.value,
          editable: true,
        });
      }
    }
  }
  return fields;
}

export function applyMetadataEdit(
  metadata: FileMetadata,
  section: string,
  key: string,
  newValue: string
): FileMetadata {
  const updated = { ...metadata, sections: metadata.sections.map((s) => ({ ...s, entries: [...s.entries] })) };
  const sec = updated.sections.find((s) => s.label === section);
  if (sec) {
    const entry = sec.entries.find((e) => e.key === key);
    if (entry) {
      entry.value = newValue;
    }
  }
  return updated;
}

// ── Write metadata back to image (EXIF/XMP) ────────────────────

export async function writeMetadataToFile(
  file: File,
  metadata: Record<string, unknown>
): Promise<Blob> {
  // For JPEG: use piexifjs-style approach via canvas re-encode
  // For now, return original file with a note that editing requires
  // a dedicated library. This is the foundation for future work.
  //
  // Future: Use piexifjs for JPEG EXIF write, or exifr + canvas
  // for a full round-trip. The key challenge is preserving the
  // exact byte stream while modifying metadata segments.

  // For images, we can at least strip metadata by re-encoding through canvas
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: file.type, quality: 0.95 });
  }

  // For non-image files, return original (metadata editing not yet supported)
  return file;
}
