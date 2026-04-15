/**
 * Speech recognition hook for Chrome extension panel.
 * Adapted from src/hooks/use-speech-recognition.ts for the extension context.
 */

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

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

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

  const isSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition is not supported.");
      return;
    }

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    setError(null);

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
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
        const trimmed = newFinal.trim();
        if (trimmed) {
          finalTranscriptRef.current = finalTranscriptRef.current
            ? finalTranscriptRef.current + " " + trimmed
            : trimmed;
          setTranscript(finalTranscriptRef.current);
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        setError("Microphone access denied.");
        shouldRestartRef.current = false;
        isListeningRef.current = false;
        setIsListening(false);
        return;
      }
      if (event.error === "no-speech") return;
      if (event.error === "aborted") {
        if (shouldRestartRef.current && isListeningRef.current) scheduleRestart();
        return;
      }
      if (shouldRestartRef.current && restartAttemptRef.current < 3) {
        scheduleRestart();
      } else {
        setError("Speech error: " + event.error);
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
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      const delay = Math.min(100 * Math.pow(2, restartAttemptRef.current), 2000);
      restartAttemptRef.current++;
      restartTimeoutRef.current = setTimeout(() => {
        if (shouldRestartRef.current && isListeningRef.current) {
          try { recognitionRef.current?.start(); } catch { startListening(); }
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
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  const fullText = useMemo(() => {
    if (!transcript && !interimTranscript) return "";
    if (!interimTranscript) return transcript;
    if (!transcript) return interimTranscript;
    return transcript + " " + interimTranscript;
  }, [transcript, interimTranscript]);

  return {
    isListening,
    fullText,
    isSupported,
    startListening,
    stopListening,
    clearTranscript,
    error,
  };
}
