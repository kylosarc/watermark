declare module 'harper.js' {
  export interface BinaryModule {
    url: string | URL;
    glueFlavor?: 'full' | 'slim';
    getDefaultLintConfigAsJSON(): Promise<string>;
    getDefaultLintConfig(): Promise<Record<string, boolean | null>>;
    toTitleCase(text: string): Promise<string>;
    setup(): Promise<void>;
  }

  export const binaryInlined: BinaryModule;

  export interface LintOptions {
    language?: 'plaintext' | 'markdown' | 'typst';
    regex_mask?: string;
    forceAllHeadings?: boolean;
    dedup?: boolean;
    isolateEnglish?: boolean;
  }

  export class Lint {
    free(): void;
    get_problem_text(): string;
    lint_kind(): string;
    lint_kind_pretty(): string;
    message(): string;
    message_html(): string;
    span(): Span;
    suggestion_count(): number;
    suggestions(): Suggestion[];
    to_json(): string;
  }

  export class Span {
    free(): void;
    start: number;
    end: number;
    len(): number;
    is_empty(): boolean;
    to_json(): string;
  }

  export class Suggestion {
    free(): void;
    get_replacement_text(): string;
    kind(): SuggestionKind;
    to_json(): string;
  }

  export enum SuggestionKind {
    Replace = 0,
    Remove = 1,
    InsertAfter = 2,
  }

  export interface Linter {
    setup(): Promise<void>;
    lint(text: string, options?: LintOptions): Promise<Lint[]>;
    applySuggestion(text: string, lint: Lint, suggestion: Suggestion): Promise<string>;
    dispose(): Promise<void>;
  }

  export class LocalLinter implements Linter {
    constructor(init: { binary: BinaryModule });
    setup(): Promise<void>;
    lint(text: string, options?: LintOptions): Promise<Lint[]>;
    applySuggestion(text: string, lint: Lint, suggestion: Suggestion): Promise<string>;
    dispose(): Promise<void>;
  }

  export class WorkerLinter implements Linter {
    constructor(init: { binary: BinaryModule });
    setup(): Promise<void>;
    lint(text: string, options?: LintOptions): Promise<Lint[]>;
    applySuggestion(text: string, lint: Lint, suggestion: Suggestion): Promise<string>;
    dispose(): Promise<void>;
  }
}
