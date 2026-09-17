declare module 'piexifjs' {
  function load(dataUrl: string): Record<string, Record<string, unknown>>;
  function dump(exifObj: Record<string, Record<string, unknown>>): string;
  function insert(exifBytes: string, dataUrl: string): string;
  function remove(dataUrl: string): string;
  const ImageIFD: Record<string, number>;
  const ExifIFD: Record<string, number>;
  const GPSIFD: Record<string, number>;
}
