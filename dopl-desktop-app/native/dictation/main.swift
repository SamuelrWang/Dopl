// dopl-dictation — the desktop composer's speech engine (2026-10-08).
//
// WHY A HELPER: Electron's `webkitSpeechRecognition` posts audio to Google with the Chromium
// build's API key and Electron ships none, so it can never work there. This binary uses Apple's
// own `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`: free, no key, and the audio
// never leaves the Mac.
//
// PROTOCOL (stdout, one JSON object per line; `main/dictation.js` is the only reader):
//   dopl-dictation probe  [--locale xx-YY]   → one {"type":"probe", …} line, exit 0. Reads
//                                              status only; NEVER prompts.
//   dopl-dictation listen [--locale xx-YY]   → {"type":"start"} once capture is live, then
//                                              {"type":"partial","text"} / {"type":"final","text"},
//                                              {"type":"error","code","message"} on a fault,
//                                              {"type":"end"} last. Asks for Speech Recognition
//                                              and Microphone access first (the OS prompt is
//                                              attributed to Dopl.app, the responsible process).
// stdin: a line "stop" or EOF ends the session gracefully (the final result is flushed first).
//
// Privacy prompts read their text from the APP's Info.plist: NSSpeechRecognitionUsageDescription
// and NSMicrophoneUsageDescription (package.json › build.mac.extendInfo).

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
  fflush(stdout)
}

func arg(_ name: String) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

func speechStatus() -> String {
  switch SFSpeechRecognizer.authorizationStatus() {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}

func micStatus() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "unknown"
  }
}

/// The recognizer for the asked locale, else the system's own. Nil when neither exists.
func makeRecognizer(_ id: String?) -> SFSpeechRecognizer? {
  if let id = id, !id.isEmpty, let r = SFSpeechRecognizer(locale: Locale(identifier: id)) { return r }
  return SFSpeechRecognizer()
}

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
let localeArg = arg("--locale")

if mode == "probe" {
  let r = makeRecognizer(localeArg)
  emit([
    "type": "probe",
    "speech": speechStatus(),
    "mic": micStatus(),
    "hasMic": AVCaptureDevice.default(for: .audio) != nil,
    "recognizer": r != nil,
    "available": r?.isAvailable ?? false,
    "onDevice": r?.supportsOnDeviceRecognition ?? false,
    "locale": r?.locale.identifier ?? "",
  ])
  exit(0)
}

guard mode == "listen" else {
  emit(["type": "error", "code": "usage", "message": "usage: dopl-dictation probe|listen [--locale id]"])
  exit(64)
}

final class Session {
  let recognizer: SFSpeechRecognizer
  let audio = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var stopping = false
  var finished = false

  init(recognizer: SFSpeechRecognizer) { self.recognizer = recognizer }

  func fail(_ code: String, _ message: String) {
    emit(["type": "error", "code": code, "message": message])
    end(1)
  }

  func end(_ status: Int32 = 0) {
    if finished { return }
    finished = true
    audio.stop()
    audio.inputNode.removeTap(onBus: 0)
    emit(["type": "end"])
    exit(status)
  }

  /// A fresh request + task. Called at start and again after each final result, so a pause that
  /// makes the recognizer finalize does not end the operator's dictation.
  func beginTask() {
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.requiresOnDeviceRecognition = true
    req.shouldReportPartialResults = true
    if #available(macOS 13.0, *) { req.addsPunctuation = true }
    request = req
    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      DispatchQueue.main.async { self?.handle(result, error, req) }
    }
  }

  func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?, _ req: SFSpeechAudioBufferRecognitionRequest) {
    if finished { return }
    if let result = result {
      let text = result.bestTranscription.formattedString
      if result.isFinal {
        if !text.isEmpty { emit(["type": "final", "text": text]) }
        if stopping { end(); return }
        if req === request { beginTask() }
        return
      }
      if !text.isEmpty { emit(["type": "partial", "text": text]) }
    }
    if let error = error as NSError? {
      if stopping { end(); return }
      // 1110 = no speech detected: an ordinary quiet ending, not a fault.
      if error.code == 1110 {
        emit(["type": "error", "code": "no-speech", "message": error.localizedDescription])
        end()
        return
      }
      fail("failed", "\(error.domain) \(error.code): \(error.localizedDescription)")
    }
  }

  func start() {
    guard recognizer.supportsOnDeviceRecognition else {
      fail("on-device-unavailable", "no on-device model for \(recognizer.locale.identifier)")
      return
    }
    let input = audio.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.channelCount > 0, format.sampleRate > 0 else {
      fail("no-mic", "no audio input")
      return
    }
    beginTask()
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
    }
    audio.prepare()
    do {
      try audio.start()
    } catch {
      fail("no-mic", "audio engine: \(error.localizedDescription)")
      return
    }
    emit(["type": "start", "locale": recognizer.locale.identifier])
  }

  /// Graceful stop: close the audio, let the recognizer flush its final result, then exit. A
  /// recognizer that never answers is cut off after 2.5s; the renderer keeps the last partial.
  func stop() {
    if stopping || finished { return }
    stopping = true
    audio.stop()
    audio.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.end() }
  }
}

var session: Session?

func requestAccessThenStart() {
  SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
      let code = status == .restricted ? "speech-restricted" : "speech-denied"
      DispatchQueue.main.async {
        emit(["type": "error", "code": code, "message": "speech recognition not authorized"])
        emit(["type": "end"])
        exit(3)
      }
      return
    }
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      DispatchQueue.main.async {
        guard granted else {
          let code = AVCaptureDevice.authorizationStatus(for: .audio) == .restricted ? "mic-restricted" : "mic-denied"
          emit(["type": "error", "code": code, "message": "microphone not authorized"])
          emit(["type": "end"])
          exit(3)
        }
        guard let r = makeRecognizer(localeArg) else {
          emit(["type": "error", "code": "locale-unsupported", "message": "no recognizer"])
          emit(["type": "end"])
          exit(2)
        }
        let s = Session(recognizer: r)
        session = s
        s.start()
      }
    }
  }
}

// stdin: "stop" or EOF ends the session. EOF also covers the parent dying.
Thread.detachNewThread {
  while let line = readLine(strippingNewline: true) {
    if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
  }
  DispatchQueue.main.async {
    if let s = session { s.stop() } else { emit(["type": "end"]); exit(0) }
  }
}

requestAccessThenStart()
dispatchMain()
