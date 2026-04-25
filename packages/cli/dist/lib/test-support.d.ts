import { Command } from "commander";
export interface FetchCall {
    url: string;
    init: RequestInit;
}
export interface FetchMock {
    calls: FetchCall[];
    restore: () => void;
}
export declare function installFetchMock(responders: Array<() => Promise<Response> | Response>): FetchMock;
export declare function jsonResponse(status: number, body: unknown): Response;
export interface IoCapture {
    stdout: () => string;
    stderr: () => string;
    restore: () => void;
}
export declare function captureIo(): IoCapture;
export declare function buildTestProgram(): Command;
