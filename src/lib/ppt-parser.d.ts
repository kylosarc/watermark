declare module '@fefeding/ppt-parser' {
  export interface PptxSlide {
    shapes?: Array<{
      text?: string;
      table?: {
        rows?: Array<{
          cells?: Array<{ text?: string }>;
        }>;
      };
    }>;
  }

  export interface PptxResult {
    slides?: PptxSlide[];
  }

  export function pptxToJson(data: ArrayBuffer): Promise<PptxResult>;
  export function pptxToHtml(data: ArrayBuffer): Promise<{ slides: Array<{ html: string }> }>;
}
