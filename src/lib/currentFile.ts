/**
 * Shared current-media store.
 *
 * App owns verification, but tools such as What Would Break?, Trust
 * Playground, and the provenance editor need the same object the user
 * inspected. Keeping this in a small module avoids importing App into
 * feature components and creating a cycle.
 */

type CurrentFileListener = (file: File | null) => void;

let currentFile: File | null = null;
const listeners = new Set<CurrentFileListener>();

export function setCurrentFile(file: File | null): void {
  currentFile = file;
  for (const listener of listeners) listener(file);
}

export function getCurrentFile(): File | null {
  return currentFile;
}

export function subscribeCurrentFile(listener: CurrentFileListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
