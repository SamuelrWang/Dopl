export declare const RETRIABLE_STATUS: Set<number>;
export declare const IDEMPOTENT_METHODS: Set<string>;
export declare const DEFAULT_GET_RETRIES = 3;
export declare function sleep(ms: number): Promise<void>;
export declare function computeBackoff(attempt: number): number;
export declare function parseRetryAfter(value: string | null, now?: number): number | null;
export declare function waitForStatus(res: Response, attempt: number): number;
