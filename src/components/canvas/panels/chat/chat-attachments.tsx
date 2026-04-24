"use client";

import { useRef } from "react";
import {
  MAX_CHAT_ATTACHMENT_SIZE,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  ALLOWED_CHAT_ATTACHMENT_TYPES,
} from "@/config";

export interface PendingAttachment {
  file: File;
  previewUrl: string; // blob URL for images, empty for others
  id: string; // client-side id for keying
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "IMG";
  if (mime === "application/pdf") return "PDF";
  if (mime === "application/json") return "JSON";
  if (mime === "text/csv") return "CSV";
  if (mime === "text/markdown") return "MD";
  return "TXT";
}

/**
 * Validate files before adding them to pending attachments.
 * Returns { valid, error } — error is a user-facing message.
 */
export function validateFiles(
  newFiles: File[],
  existingCount: number
): { valid: File[]; error: string | null } {
  const totalCount = existingCount + newFiles.length;
  if (totalCount > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
    return {
      valid: [],
      error: `Maximum ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} files per message`,
    };
  }

  const valid: File[] = [];
  for (const file of newFiles) {
    if (file.size > MAX_CHAT_ATTACHMENT_SIZE) {
      return {
        valid: [],
        error: `"${file.name}" exceeds ${MAX_CHAT_ATTACHMENT_SIZE / (1024 * 1024)}MB limit`,
      };
    }
    if (
      !(ALLOWED_CHAT_ATTACHMENT_TYPES as readonly string[]).includes(file.type)
    ) {
      return {
        valid: [],
        error: `"${file.name}" has unsupported type "${file.type || "unknown"}"`,
      };
    }
    valid.push(file);
  }

  return { valid, error: null };
}

/**
 * Create a PendingAttachment from a File, with a blob preview URL for images.
 */
export function fileToPending(file: File): PendingAttachment {
  return {
    file,
    previewUrl: file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : "",
    id: crypto.randomUUID(),
  };
}

/**
 * Clean up blob URLs when removing pending attachments.
 */
export function revokePendingUrl(pending: PendingAttachment) {
  if (pending.previewUrl) {
    URL.revokeObjectURL(pending.previewUrl);
  }
}

// ── UI Components ──────────────────────────────────────────────────

interface AttachButtonProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

/** Paperclip button that opens a file picker. */
export function AttachButton({ onFiles, disabled }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_CHAT_ATTACHMENT_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onFiles(files);
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14 8.5l-5.5 5.5a3.5 3.5 0 01-5-5l6.5-6.5a2.5 2.5 0 013.5 3.5L7 12.5a1.5 1.5 0 01-2-2L10.5 5" />
        </svg>
      </button>
    </>
  );
}

interface AttachmentPreviewStripProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}

/** Horizontal scrollable strip showing pending attachment previews. */
export function AttachmentPreviewStrip({
  attachments,
  onRemove,
}: AttachmentPreviewStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 pb-1 scrollbar-thin">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="relative shrink-0 group"
        >
          {a.file.type.startsWith("image/") ? (
            <div className="w-16 h-16 rounded-[4px] overflow-hidden bg-white/[0.06] border border-white/[0.1]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.previewUrl}
                alt={a.file.name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="h-16 min-w-[80px] max-w-[120px] rounded-[4px] bg-white/[0.06] border border-white/[0.1] flex flex-col items-center justify-center gap-0.5 px-2">
              <span className="font-mono text-[9px] font-bold text-white/50 uppercase">
                {fileTypeIcon(a.file.type)}
              </span>
              <span className="text-[9px] text-white/40 truncate max-w-full">
                {a.file.name}
              </span>
              <span className="text-[8px] text-white/30">
                {formatFileSize(a.file.size)}
              </span>
            </div>
          )}
          {/* Remove button */}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 border border-white/20 text-white/70 hover:text-white flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Remove ${a.file.name}`}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

interface SentAttachmentPreviewProps {
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    url: string;
  }>;
}

/** Renders attachment previews inside a sent user message bubble. */
export function SentAttachmentPreview({
  attachments,
}: SentAttachmentPreviewProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((a) =>
        a.mimeType.startsWith("image/") ? (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-[120px] rounded-[4px] overflow-hidden bg-white/[0.06] border border-white/[0.1] hover:border-white/[0.25] transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.url}
              alt={a.fileName}
              className="w-full h-auto object-contain max-h-[160px]"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-6 px-2 rounded-[3px] bg-white/[0.06] border border-white/[0.1] hover:border-white/[0.25] transition-colors text-white/60 hover:text-white/80"
          >
            <span className="font-mono text-[9px] font-bold uppercase">
              {fileTypeIcon(a.mimeType)}
            </span>
            <span className="text-[10px] truncate max-w-[100px]">
              {a.fileName}
            </span>
            <span className="text-[8px] text-white/30">
              {formatFileSize(a.fileSize)}
            </span>
          </a>
        )
      )}
    </div>
  );
}
