/**
 * Sound Alert Service
 * Manages audio notifications for batch processing completion
 */

export type SoundType = "success" | "error" | "warning" | "info";

interface SoundConfig {
  type: SoundType;
  volume: number; // 0-1
  enabled: boolean;
}

class SoundAlertService {
  private audioContext: AudioContext | null = null;
  private oscillators: Map<string, OscillatorNode> = new Map();
  private volume: number = 0.5;
  private enabled: boolean = true;
  private preloadedAudio: Map<SoundType, HTMLAudioElement> = new Map();

  constructor() {
    this.initializeAudioContext();
    this.preloadSounds();
  }

  /**
   * Initialize Web Audio API context
   */
  private initializeAudioContext(): void {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();
    } catch (error) {
      console.warn("Web Audio API not supported:", error);
    }
  }

  /**
   * Preload audio files for instant playback
   */
  private preloadSounds(): void {
    const sounds: Record<SoundType, string> = {
      success: "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==",
      error: "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==",
      warning: "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==",
      info: "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==",
    };

    Object.entries(sounds).forEach(([type, dataUrl]) => {
      const audio = new Audio();
      audio.src = dataUrl;
      audio.preload = "auto";
      this.preloadedAudio.set(type as SoundType, audio);
    });
  }

  /**
   * Play success sound (uplifting chime)
   */
  playSuccess(): void {
    if (!this.enabled) return;
    this.playTone({
      frequency: 523.25, // C5
      duration: 0.3,
      type: "sine",
      envelope: { attack: 0.05, decay: 0.25 },
    });
  }

  /**
   * Play error sound (warning tone)
   */
  playError(): void {
    if (!this.enabled) return;
    this.playTone({
      frequency: 349.23, // F4
      duration: 0.5,
      type: "sine",
      envelope: { attack: 0.05, decay: 0.45 },
    });
  }

  /**
   * Play warning sound
   */
  playWarning(): void {
    if (!this.enabled) return;
    this.playTone({
      frequency: 440, // A4
      duration: 0.4,
      type: "sine",
      envelope: { attack: 0.05, decay: 0.35 },
    });
  }

  /**
   * Play info sound
   */
  playInfo(): void {
    if (!this.enabled) return;
    this.playTone({
      frequency: 587.33, // D5
      duration: 0.25,
      type: "sine",
      envelope: { attack: 0.05, decay: 0.2 },
    });
  }

  /**
   * Generic tone player using Web Audio API
   */
  private playTone(config: {
    frequency: number;
    duration: number;
    type: OscillatorType;
    envelope: { attack: number; decay: number };
  }): void {
    if (!this.audioContext) {
      console.warn("Web Audio API not available");
      return;
    }

    try {
      const ctx = this.audioContext;
      const now = ctx.currentTime;

      // Create oscillator
      const oscillator = ctx.createOscillator();
      oscillator.type = config.type;
      oscillator.frequency.value = config.frequency;

      // Create gain node for volume and envelope
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(
        this.volume,
        now + config.envelope.attack
      );
      gainNode.gain.linearRampToValueAtTime(
        0,
        now + config.envelope.attack + config.envelope.decay
      );

      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Play sound
      oscillator.start(now);
      oscillator.stop(now + config.envelope.attack + config.envelope.decay);

      // Store reference for cleanup
      const id = `tone-${Date.now()}`;
      this.oscillators.set(id, oscillator);

      // Clean up after sound finishes
      setTimeout(() => {
        this.oscillators.delete(id);
      }, (config.envelope.attack + config.envelope.decay) * 1000);
    } catch (error) {
      console.error("Error playing tone:", error);
    }
  }

  /**
   * Play complex success notification (multiple tones)
   */
  playSuccessNotification(): void {
    if (!this.enabled) return;

    const ctx = this.audioContext;
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, time: 0, duration: 0.2 }, // C5
      { freq: 659.25, time: 0.15, duration: 0.2 }, // E5
      { freq: 783.99, time: 0.3, duration: 0.4 }, // G5
    ];

    notes.forEach(({ freq, time, duration }) => {
      try {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(this.volume, now + time + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      } catch (error) {
        console.error("Error playing note:", error);
      }
    });
  }

  /**
   * Play complex error notification (descending tones)
   */
  playErrorNotification(): void {
    if (!this.enabled) return;

    const ctx = this.audioContext;
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [
      { freq: 349.23, time: 0, duration: 0.2 }, // F4
      { freq: 329.63, time: 0.15, duration: 0.2 }, // E4
      { freq: 293.66, time: 0.3, duration: 0.4 }, // D4
    ];

    notes.forEach(({ freq, time, duration }) => {
      try {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(this.volume, now + time + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      } catch (error) {
        console.error("Error playing note:", error);
      }
    });
  }

  /**
   * Set volume level (0-1)
   */
  setVolume(level: number): void {
    this.volume = Math.max(0, Math.min(1, level));
    localStorage.setItem("soundAlertVolume", this.volume.toString());
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    return this.volume;
  }

  /**
   * Enable/disable sound alerts
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem("soundAlertEnabled", enabled.toString());
  }

  /**
   * Check if sound alerts are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Load preferences from localStorage
   */
  loadPreferences(): void {
    const savedVolume = localStorage.getItem("soundAlertVolume");
    if (savedVolume) {
      this.volume = parseFloat(savedVolume);
    }

    const savedEnabled = localStorage.getItem("soundAlertEnabled");
    if (savedEnabled !== null) {
      this.enabled = savedEnabled === "true";
    }
  }

  /**
   * Stop all playing sounds
   */
  stopAll(): void {
    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch (error) {
        console.error("Error stopping oscillator:", error);
      }
    });
    this.oscillators.clear();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopAll();
    this.preloadedAudio.clear();
  }
}

// Export singleton instance
export const soundAlertService = new SoundAlertService();

// Load preferences on initialization
soundAlertService.loadPreferences();
