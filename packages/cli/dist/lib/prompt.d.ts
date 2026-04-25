export interface PromptStreams {
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
}
export declare function promptSecret(label: string, streams?: Partial<PromptStreams>): Promise<string>;
export declare class PromptAbortedError extends Error {
    constructor();
}
