"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Monitor, Settings, Paperclip, ChevronDown } from "lucide-react";
import { useSpeechRecognition } from "@/shared/hooks/use-speech-recognition";

const ROTATING_PROMPTS = [
  "Extract these X posts and convert them into one Claude Code skill...",
  "Build me an automation for LinkedIn lead gen...",
  "What Claude Code configs exist for deep research?",
  "Compose a marketing automation with Supabase...",
  "Find the best open source Github repos and create a digital brain...",
  "Search for MCP server setups...",
];

function useTypingAnimation() {
  const [display, setDisplay] = useState("");
  const [promptIdx, setPromptIdx] = useState(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const prompt = ROTATING_PROMPTS[promptIdx];
    let charIdx = 0;
    let deleting = false;

    function tick() {
      if (!deleting) {
        // Typing forward
        charIdx++;
        setDisplay(prompt.slice(0, charIdx));
        if (charIdx === prompt.length) {
          // Pause at full text
          timeout = setTimeout(() => {
            deleting = true;
            tick();
          }, 2000);
          return;
        }
        timeout = setTimeout(tick, 50 + Math.random() * 40);
      } else {
        // Deleting
        charIdx--;
        setDisplay(prompt.slice(0, charIdx));
        if (charIdx === 0) {
          // Move to next prompt
          timeout = setTimeout(() => {
            setPromptIdx((prev) => (prev + 1) % ROTATING_PROMPTS.length);
          }, 400);
          return;
        }
        timeout = setTimeout(tick, 25);
      }
    }

    tick();
    return () => clearTimeout(timeout);
  }, [promptIdx]);

  return display;
}

function handleLandingSend(message: string) {
  if (!message.trim()) return;
  localStorage.setItem("dopl-landing-message", message.trim());
  window.location.href = "/login?redirectTo=/canvas";
}

export function PromptInput() {
  const [value, setValue] = useState("");
  const animatedPlaceholder = useTypingAnimation();
  const showPlaceholder = !value;
  const prevFullTextRef = useRef("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const {
    isListening,
    fullText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
    error: voiceError,
  } = useSpeechRecognition();

  // Live-sync voice transcript into the textarea
  useEffect(() => {
    if (isListening && fullText !== prevFullTextRef.current) {
      prevFullTextRef.current = fullText;
      setValue(fullText);
    }
  }, [isListening, fullText]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      prevFullTextRef.current = "";
    } else {
      clearTranscript();
      prevFullTextRef.current = "";
      startListening();
    }
  }, [isListening, stopListening, clearTranscript, startListening]);

  function handleSend() {
    if (isListening) {
      stopListening();
      clearTranscript();
      prevFullTextRef.current = "";
    }
    handleLandingSend(value);
  }

  const canSend = value.trim().length > 0;

  return (
    <div className="w-full max-w-[740px] mx-auto">
      <div className="bg-[#141414] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="relative p-4 pb-2 min-h-[100px]">
          {showPlaceholder && (
            <div className="absolute inset-0 p-4 pb-2 pointer-events-none text-left">
              <span className="text-white/30 text-[15px]">
                {animatedPlaceholder}
                <span className="inline-block w-[2px] h-[16px] bg-white/40 ml-[1px] align-middle animate-pulse" />
              </span>
            </div>
          )}
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="w-full h-full min-h-[80px] bg-transparent text-white text-[15px] resize-none outline-none placeholder-transparent text-left"
          />
        </div>
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-1">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-white/50 text-[13px] hover:text-white/70 transition-colors">
              <Monitor size={14} />
              <span>Full-stack</span>
              <ChevronDown size={12} />
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-white/50 text-[13px] hover:text-white/70 transition-colors">
              <Settings size={14} />
              <span>Build</span>
              <ChevronDown size={12} />
            </button>
            <button className="p-1.5 text-white/30 hover:text-white/50 transition-colors">
              <Paperclip size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Voice input */}
            {mounted && voiceSupported && (
              <button
                type="button"
                onClick={handleVoiceToggle}
                aria-label={isListening ? "Stop recording" : "Start voice input"}
                title={
                  voiceError
                    ? voiceError
                    : isListening
                    ? "Recording... click to stop"
                    : "Voice input"
                }
                className="flex items-center justify-center w-7 h-7 transition-colors"
              >
                {isListening ? (
                  <span className="flex items-end gap-[2px] h-4">
                    {[1, 2, 3, 4, 3].map((h, i) => (
                      <span
                        key={i}
                        className="w-[2px] rounded-full bg-red-400"
                        style={{
                          height: `${h * 3}px`,
                          animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                        }}
                      />
                    ))}
                  </span>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors"
                  >
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                )}
              </button>
            )}
            {/* Send — circular */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M7 11V3" />
                <path d="M3 7l4-4 4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {isListening && (
        <style>{`
          @keyframes voiceBar {
            from { transform: scaleY(0.5); }
            to   { transform: scaleY(1.5); }
          }
        `}</style>
      )}
    </div>
  );
}
