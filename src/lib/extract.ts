import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/build/pdf.worker.mjs';
import { pptxToJson } from '@fefeding/ppt-parser';
import mammoth from 'mammoth';

export type FileFormat = 'text' | 'pdf' | 'pptx' | 'docx' | 'unknown';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.html', '.csv', '.xml', '.yaml', '.yml',
  '.toml', '.log', '.ini', '.cfg', '.conf', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php',
  '.sql', '.sh', '.bash', '.css', '.scss', '.less', '.vue', '.svelte',
  '.swift', '.kt', '.scala', '.r', '.m', '.mm', '.lua', '.pl', '.ex', '.exs',
  '.dart', '.zig', '.nim', '.cr', '.hs', '.ml', '.fs', '.clj',
]);

const PDF_EXTENSIONS = new Set(['.pdf']);
const PPTX_EXTENSIONS = new Set(['.pptx', '.ppt']);
const DOCX_EXTENSIONS = new Set(['.docx', '.doc']);

export function detectFormat(fileName: string): FileFormat {
  if (typeof fileName !== 'string') return 'unknown';
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (PPTX_EXTENSIONS.has(ext)) return 'pptx';
  if (DOCX_EXTENSIONS.has(ext)) return 'docx';
  return 'unknown';
}

export const TEXT_ACCEPT = [
  ...TEXT_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...PPTX_EXTENSIONS,
  ...DOCX_EXTENSIONS,
].join(',');

export interface ExtractedText {
  text: string;
  format: FileFormat;
  pageCount?: number; // pages for PDF, slides for PPTX
}

export async function extractTextFromFile(file: File): Promise<ExtractedText> {
  const format = detectFormat(file.name);

  switch (format) {
    case 'text':
      return extractPlainText(file);
    case 'pdf':
      return extractPdfText(file);
    case 'pptx':
      return extractPptxText(file);
    case 'docx':
      return extractDocxText(file);
    default:
      throw new Error(`Unsupported file format: ${file.name}`);
  }
}

async function extractPlainText(file: File): Promise<ExtractedText> {
  const text = await file.text();
  return { text, format: 'text' };
}

async function extractPdfText(file: File): Promise<ExtractedText> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(pageText);
  }

  return { text: pages.join('\n\n'), format: 'pdf', pageCount: pdf.numPages };
}

async function extractPptxText(file: File): Promise<ExtractedText> {
  const arrayBuffer = await file.arrayBuffer();

  // Try pptxToJson first
  try {
    const result = await pptxToJson(arrayBuffer, { mediaProcess: false, themeProcess: false });
    const slides: string[] = [];

    if (result?.slides && Array.isArray(result.slides)) {
      for (const slide of result.slides) {
        const slideTexts: string[] = [];

        // Extract text from shapes
        const data = slide?.data;
        if (data?.shapes && Array.isArray(data.shapes)) {
          for (const shape of data.shapes) {
            if (typeof shape?.text === 'string' && shape.text.trim()) slideTexts.push(shape.text);
            // Text in tables
            if (shape?.table?.rows && Array.isArray(shape.table.rows)) {
              for (const row of shape.table.rows) {
                if (row?.cells && Array.isArray(row.cells)) {
                  for (const cell of row.cells) {
                    if (typeof cell?.text === 'string' && cell.text.trim()) slideTexts.push(cell.text);
                  }
                }
              }
            }
          }
        }

        if (slideTexts.length > 0) {
          slides.push(slideTexts.join(' '));
        }
      }
    }

    if (slides.length > 0) {
      return { text: slides.join('\n\n'), format: 'pptx', pageCount: slides.length };
    }
    // If pptxToJson returned but no text found, fall through to pptxToHtml
  } catch {
    // Fall through to pptxToHtml
  }

  // Fallback: pptxToHtml
  try {
    const { pptxToHtml } = await import('@fefeding/ppt-parser');
    const htmlResult = await pptxToHtml(arrayBuffer, { mediaProcess: false, themeProcess: false });
    const slides: string[] = [];

    if (htmlResult?.slides && Array.isArray(htmlResult.slides)) {
      for (const s of htmlResult.slides) {
        if (typeof s?.html === 'string') {
          const div = document.createElement('div');
          div.innerHTML = s.html;
          const text = div.textContent || div.innerText || '';
          if (text.trim().length > 0) slides.push(text.trim());
        }
      }
    }

    if (slides.length > 0) {
      return { text: slides.join('\n\n'), format: 'pptx', pageCount: slides.length };
    }
  } catch {
    // Both methods failed
  }

  // Last resort: try reading as plain text (some .pptx files are actually text)
  try {
    const text = await file.text();
    if (text.trim().length > 0) {
      return { text: text.slice(0, 50000), format: 'pptx', pageCount: 1 };
    }
  } catch {
    // Ignore
  }

  throw new Error(`Could not extract text from PPTX: ${file.name}. The file may be empty or use an unsupported format.`);
}

async function extractDocxText(file: File): Promise<ExtractedText> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return { text: result.value, format: 'docx' };
}
