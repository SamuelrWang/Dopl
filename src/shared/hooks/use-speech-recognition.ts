"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Long-form dictation speech recognition hook.
 *
 * - Accumulates everything — final transcript builds up continuously
 * - Auto-restarts on session end (browser limits ~60s per session)
 * - No silence timer — user controls when to stop
 * - Clean separation of final vs interim text
 * - Robust error recovery
 */
export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");
  const isListeningRef = useRef(false);
  const shouldRestartRef = useRef(false);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptRef = useRef(0);

  // Start `false` on both server and first client render so SSR hydration
  // matches. Flip to the real value in a mount effect — any downstream UI
  // that branches on `isSupported` will re-render once it's known.
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsSupported(
      !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }, []);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    setError(null);

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
      restartAttemptRef.current = 0;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let newFinal = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (result.isFinal) {
          newFinal += text;
        } else {
          interim += text;
        }
      }

      if (newFinal) {
        const trimmedNew = newFinal.trim();
        if (trimmedNew) {
          finalTranscriptRef.current = finalTranscriptRef.current
            ? finalTranscriptRef.current + " " + trimmedNew
            : trimmedNew;
          setTranscript(finalTranscriptRef.current);
        }
      }

      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        setError("Microphone access denied. Please allow microphone access and try again.");
        shouldRestartRef.current = false;
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }

      if (event.error === "no-speech") {
        return;
      }

      if (event.error === "aborted") {
        if (shouldRestartRef.current && isListeningRef.current) {
          scheduleRestart();
        }
        return;
      }

      if (event.error === "network") {
        if (shouldRestartRef.current && restartAttemptRef.current < 3) {
          scheduleRestart();
        } else {
          setError("Network error. Please check your connection.");
          shouldRestartRef.current = false;
          isListeningRef.current = false;
          setIsListening(false);
        }
        return;
      }

      if (shouldRestartRef.current && restartAttemptRef.current < 2) {
        scheduleRestart();
      } else {
        setError("Speech recognition error: " + event.error);
        shouldRestartRef.current = false;
        isListeningRef.current = false;
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (shouldRestartRef.current && isListeningRef.current) {
        scheduleRestart();
      } else {
        setIsListening(false);
        isListeningRef.current = false;
        setInterimTranscript("");
      }
    };

    const scheduleRestart = () => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }

      const delay = Math.min(100 * Math.pow(2, restartAttemptRef.current), 2000);
      restartAttemptRef.current++;

      restartTimeoutRef.current = setTimeout(() => {
        if (shouldRestartRef.current && isListeningRef.current) {
          try {
            recognitionRef.current?.start();
          } catch {
            startListening();
          }
        }
      }, delay);
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    isListeningRef.current = true;

    try {
      recognition.start();
    } catch {
      setError("Failed to start speech recognition.");
      setIsListening(false);
      isListeningRef.current = false;
      shouldRestartRef.current = false;
    }
  }, [isSupported]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    isListeningRef.current = false;

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    finalTranscriptRef.current = "";
  }, []);

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      isListeningRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      recognitionRef.current?.abort();
    };
  }, []);

  const fullText = useMemo(() => {
    if (!transcript && !interimTranscript) return "";
    if (!interimTranscript) return transcript;
    if (!transcript) return interimTranscript;
    return transcript + " " + interimTranscript;
  }, [transcript, interimTranscript]);

  const wordCount = useMemo(() => {
    const text = fullText.trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }, [fullText]);

  return {
    isListening,
    transcript,
    interimTranscript,
    fullText,
    wordCount,
    isSupported,
    startListening,
    stopListening,
    clearTranscript,
    error,
  };
}
