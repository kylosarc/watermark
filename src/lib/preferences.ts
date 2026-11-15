/**
 * Tool defaults that are safe to change without touching verification.
 * Stored per browser so the local-first promise holds.
 */

export interface ToolPreferences {
  autoRunSimulator: boolean;
  autoRunPlayground: boolean;
}

const STORAGE_KEY = 'wm:toolPreferences';

export const DEFAULT_TOOL_PREFERENCES: ToolPreferences = {
  autoRunSimulator: true,
  autoRunPlayground: true,
};

export function getToolPreferences(): ToolPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TOOL_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ToolPreferences>;
    return {
      autoRunSimulator: parsed.autoRunSimulator ?? DEFAULT_TOOL_PREFERENCES.autoRunSimulator,
      autoRunPlayground: parsed.autoRunPlayground ?? DEFAULT_TOOL_PREFERENCES.autoRunPlayground,
    };
  } catch {
    return DEFAULT_TOOL_PREFERENCES;
  }
}

export function storeToolPreferences(preferences: ToolPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // localStorage unavailable or full — defaults still apply this session.
  }
}
