declare module '@fefeding/ppt-parser' {
  export interface PptxSlideData {
    shapes?: Array<{
      text?: string;
      table?: {
        rows?: Array<{
          cells?: Array<{ text?: string }>;
        }>;
      };
    }>;
  }

  export interface PptxSlide {
    data: PptxSlideData;
    slideNum: number;
    fileName: string;
  }

  export interface PptxResult {
    slides?: PptxSlide[];
    slideSize?: { width: number; height: number };
    metadata?: Record<string, unknown>;
    charts?: unknown[];
  }

  export function pptxToJson(data: ArrayBuffer, options?: {
    mediaProcess?: boolean;
    themeProcess?: boolean | 'colorsAndImageOnly';
  }): Promise<PptxResult>;

  export function pptxToHtml(data: ArrayBuffer, options?: {
    mediaProcess?: boolean;
    themeProcess?: boolean | 'colorsAndImageOnly';
  }): Promise<{ slides: Array<{ html: string; data: PptxSlideData; slideNum: number }>; slideSize?: { width: number; height: number } }>;
}
