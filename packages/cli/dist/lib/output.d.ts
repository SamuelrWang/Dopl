export interface OutputOptions {
    json: boolean;
}
export declare function writeJson(value: unknown): void;
export declare function writeLine(text?: string): void;
export declare function writeError(text: string): void;
export declare function formatTable(headers: string[], rows: string[][]): string;
export declare function truncate(text: string | null | undefined, max: number): string;
export declare function formatDateCompact(iso: string | null | undefined): string;
