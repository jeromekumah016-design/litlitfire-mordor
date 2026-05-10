import React, { useState, useEffect } from "react";
import { soundAlertService } from "@/services/soundAlertService";
import { toastService } from "@/services/toastService";
import { useToast } from "@/contexts/ToastContext";
import { Volume2, VolumeX, Bell, BellOff } from "lucide-react";

/**
 * Notification Settings Component
 * Allows users to configure sound and toast notifications
 */
export function NotificationSettings() {
  const { info } = useToast();
  const [soundEnabled, setSoundEnabled] = useState(soundAlertService.isEnabled());
  const [soundVolume, setSoundVolume] = useState(soundAlertService.getVolume() * 100);
  const [toastPosition, setToastPosition] = useState(toastService.getConfig().position);
  const [toastDuration, setToastDuration] = useState(toastService.getConfig().defaultDuration / 1000);
  const [maxToasts, setMaxToasts] = useState(toastService.getConfig().maxToasts);

  /**
   * Handle sound enabled toggle
   */
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    soundAlertService.setEnabled(enabled);
    info(
      "Sound Alerts",
      enabled ? "Sound alerts enabled" : "Sound alerts disabled"
    );
  };

  /**
   * Handle volume change
   */
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = parseFloat(e.target.value);
    setSoundVolume(volume);
    soundAlertService.setVolume(volume / 100);
  };

  /**
   * Handle toast position change
   */
  const handlePositionChange = (
    position: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right"
  ) => {
    setToastPosition(position);
    toastService.setConfig({ position });
  };

  /**
   * Handle toast duration change
   */
  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const duration = parseInt(e.target.value);
    setToastDuration(duration);
    toastService.setConfig({ defaultDuration: duration * 1000 });
  };

  /**
   * Handle max toasts change
   */
  const handleMaxToastsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const max = parseInt(e.target.value);
    setMaxToasts(max);
    toastService.setConfig({ maxToasts: max });
  };

  /**
   * Test sound
   */
  const handleTestSound = () => {
    soundAlertService.playSuccessNotification();
    info("Test Sound", "Playing success notification sound...");
  };

  return (
    <div className="space-y-6 p-6 bg-white rounded-lg border border-gray-200">
      <h2 className="text-xl font-semibold text-gray-900">Notification Settings</h2>

      {/* Sound Alerts Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-800 flex items-center gap-2">
          <Volume2 className="w-5 h-5" />
          Sound Alerts
        </h3>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <label className="flex items-center gap-3 cursor-pointer flex-1">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => handleSoundToggle(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">
              {soundEnabled ? "Sound alerts enabled" : "Sound alerts disabled"}
            </span>
          </label>
          {soundEnabled ? (
            <Volume2 className="w-5 h-5 text-green-500" />
          ) : (
            <VolumeX className="w-5 h-5 text-gray-400" />
          )}
        </div>

        {/* Volume Control */}
        {soundEnabled && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Volume: {Math.round(soundVolume)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={soundVolume}
              onChange={handleVolumeChange}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <button
              onClick={handleTestSound}
              className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
            >
              Test Sound
            </button>
          </div>
        )}
      </div>

      {/* Toast Notifications Section */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <h3 className="text-lg font-medium text-gray-800 flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Toast Notifications
        </h3>

        {/* Position */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Position</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              "top-left",
              "top-center",
              "top-right",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ].map((pos) => (
              <button
                key={pos}
                onClick={() =>
                  handlePositionChange(
                    pos as
                      | "top-left"
                      | "top-center"
                      | "top-right"
                      | "bottom-left"
                      | "bottom-center"
                      | "bottom-right"
                  )
                }
                className={`px-3 py-2 text-xs font-medium rounded transition-colors ${
                  toastPosition === pos
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {pos.replace("-", " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Auto-dismiss Duration: {toastDuration}s
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={toastDuration}
            onChange={handleDurationChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Max Toasts */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            Max Visible Toasts: {maxToasts}
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={maxToasts}
            onChange={handleMaxToastsChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      {/* Info Message */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          💡 Your notification preferences are automatically saved and will persist across sessions.
        </p>
      </div>
    </div>
  );
}

export default NotificationSettings;
