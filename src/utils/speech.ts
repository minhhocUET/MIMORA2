/**
 * User-initiated Read-Aloud helper using Web Speech API (window.speechSynthesis).
 * Strictly NEVER auto-plays audio on mount or scene change; child or helper clicks explicitly.
 * Gracefully degrades when speechSynthesis is unavailable in headless/SSR environments.
 */

export interface SpeakOptions {
  locale?: string;
  speechRate?: 'slow' | 'normal';
  onStart?: () => void;
  onEnd?: () => void;
  onUnavailable?: () => void;
}

export function isSpeechSupported(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    'speechSynthesis' in globalThis &&
    typeof globalThis.SpeechSynthesisUtterance === 'function'
  );
}

export function stopSpeech(): void {
  if (!isSpeechSupported()) {
    return;
  }
  try {
    globalThis.speechSynthesis.cancel();
  } catch {
    // Ignore browser speech cancel edge cases
  }
}

export function speakText(text: string, options: SpeakOptions = {}): boolean {
  const clean = text.trim();
  if (!clean) {
    return false;
  }

  if (!isSpeechSupported()) {
    options.onUnavailable?.();
    return false;
  }

  try {
    globalThis.speechSynthesis.cancel();
    const utterance = new globalThis.SpeechSynthesisUtterance(clean);
    const targetLang = options.locale?.toLowerCase().startsWith('en') ? 'en-US' : 'vi-VN';
    utterance.lang = targetLang;
    utterance.rate = options.speechRate === 'slow' ? 0.82 : 0.96;
    utterance.pitch = 1.02;

    const voices = globalThis.speechSynthesis.getVoices?.() ?? [];
    const matchingVoice = voices.find((v) =>
      v.lang.toLowerCase().startsWith(targetLang.slice(0, 2))
    );
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = () => options.onEnd?.();

    options.onStart?.();
    globalThis.speechSynthesis.speak(utterance);
    return true;
  } catch {
    options.onEnd?.();
    options.onUnavailable?.();
    return false;
  }
}
