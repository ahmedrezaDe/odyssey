// Browser-native TTS via Web Speech API — zero external dependencies.

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  voiceName?: string;
  onEnd?: () => void;
  onStart?: () => void;
  onError?: (err: SpeechSynthesisErrorEvent) => void;
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(text: string, opts: SpeakOptions = {}): SpeechSynthesisUtterance | null {
  if (!isSpeechSupported()) return null;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1.02;
  u.pitch = opts.pitch ?? 0.95;
  if (opts.voiceName) {
    const v = window.speechSynthesis.getVoices().find((x) => x.name === opts.voiceName);
    if (v) u.voice = v;
  }
  if (opts.onStart) u.onstart = opts.onStart;
  if (opts.onEnd) u.onend = opts.onEnd;
  if (opts.onError) u.onerror = opts.onError;
  window.speechSynthesis.speak(u);
  return u;
}

export function stopSpeaking() {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
