# Visual Toast Notifications & Sound Alerts Implementation Guide

## Overview

This guide explains how to integrate comprehensive visual toast notifications and sound alerts for batch PDF processing completion. The system provides real-time feedback with customizable notifications, sound effects, and user preferences.

---

## Architecture

### Sound Alert System (`client/src/services/soundAlertService.ts`)

**Features:**
- Web Audio API for generating tones (no external audio files needed)
- Multiple sound types: success, error, warning, info
- Complex notifications with multiple tones for better UX
- Volume control (0-100%)
- Enable/disable toggle
- Automatic preference persistence

**Sound Types:**
- **Success**: Uplifting 3-note ascending chime (C5→E5→G5)
- **Error**: Descending warning tones (F4→E4→D4)
- **Warning**: Single tone at A4 frequency
- **Info**: Single tone at D5 frequency

### Toast Notification Service (`client/src/services/toastService.ts`)

**Features:**
- Toast queue management with max limit
- Multiple toast types: success, error, info, warning
- Auto-dismiss with configurable duration
- Manual dismiss button
- Action buttons for user interactions
- Toast positioning (6 positions)
- Listener-based updates for React integration
- Preference persistence

**Configuration:**
```typescript
interface ToastConfig {
  position: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  maxToasts: number;
  defaultDuration: number; // milliseconds
}
```

### React Integration

**ToastContext** (`client/src/contexts/ToastContext.tsx`):
- Provides toast functionality to entire app
- useToast hook for accessing notifications

**ToastContainer** (`client/src/components/ToastContainer.tsx`):
- Renders all active toasts
- Handles animations and lifecycle
- Responsive and accessible

**NotificationSettings** (`client/src/components/NotificationSettings.tsx`):
- User preferences UI
- Sound volume control
- Toast position selection
- Duration and max toasts configuration
- Test sound button

---

## Integration Steps

### Step 1: Setup Toast Provider

**File**: `client/src/main.tsx`

```typescript
import { ToastProvider } from "@/contexts/ToastContext";
import { ToastContainer } from "@/components/ToastContainer";

function App() {
  return (
    <ToastProvider>
      {/* Your app content */}
      <ToastContainer />
    </ToastProvider>
  );
}
```

### Step 2: Use Notifications in Components

**Basic Usage:**

```typescript
import { useToast } from "@/contexts/ToastContext";

function MyComponent() {
  const { success, error, info, warning } = useToast();

  const handleSuccess = () => {
    success("Success!", "Operation completed successfully");
  };

  const handleError = () => {
    error("Error", "Something went wrong");
  };

  return (
    <button onClick={handleSuccess}>Show Success</button>
  );
}
```

### Step 3: Integrate with Progress Tracking

**File**: `client/src/pages/PDFUploadForm.tsx` or similar

```typescript
import { useProcessingProgress } from "@/hooks/useProcessingProgress";
import { useCompletionNotifications } from "@/hooks/useCompletionNotifications";
import { soundAlertService } from "@/services/soundAlertService";

export default function PDFUploadForm() {
  const { progress, isComplete } = useProcessingProgress({
    bookId,
    enabled: !!bookId,
    onComplete: (data) => {
      // Show completion notification
      if (data.status === "completed") {
        notifications.showProcessingComplete(
          data.processedPages,
          Math.round((Date.now() - startTime) / 1000)
        );
      } else if (data.status === "failed") {
        notifications.showProcessingError(
          data.failedPages,
          data.totalPages
        );
      }
    },
  });

  const notifications = useCompletionNotifications({
    showToast: true,
    playSound: true,
  });

  return (
    <div>
      {/* Your form */}
    </div>
  );
}
```

### Step 4: Add Settings Page

**File**: `client/src/pages/Settings.tsx` or similar

```typescript
import { NotificationSettings } from "@/components/NotificationSettings";

export default function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <NotificationSettings />
    </div>
  );
}
```

---

## API Reference

### Sound Alert Service

```typescript
import { soundAlertService } from "@/services/soundAlertService";

// Play individual sounds
soundAlertService.playSuccess();
soundAlertService.playError();
soundAlertService.playWarning();
soundAlertService.playInfo();

// Play complex notifications
soundAlertService.playSuccessNotification(); // 3-note chime
soundAlertService.playErrorNotification();   // Descending tones

// Volume control
soundAlertService.setVolume(0.5);  // 0-1
soundAlertService.getVolume();     // Returns current volume

// Enable/disable
soundAlertService.setEnabled(true);
soundAlertService.isEnabled();

// Load/save preferences
soundAlertService.loadPreferences();
soundAlertService.destroy();
```

### Toast Service

```typescript
import { toastService } from "@/services/toastService";

// Show notifications
toastService.success("Title", "Message", options);
toastService.error("Title", "Message", options);
toastService.info("Title", "Message", options);
toastService.warning("Title", "Message", options);

// Manage toasts
toastService.remove(toastId);
toastService.clear();
toastService.getToasts();

// Configuration
toastService.setConfig({ position: "top-right", maxToasts: 5 });
toastService.getConfig();
toastService.loadConfig();

// Lifecycle
toastService.subscribe((toasts) => {
  console.log("Toasts updated:", toasts);
});
```

### useToast Hook

```typescript
import { useToast } from "@/contexts/ToastContext";

const {
  toasts,           // Current toasts array
  success,          // Show success toast
  error,            // Show error toast
  info,             // Show info toast
  warning,          // Show warning toast
  remove,           // Remove specific toast
  clear,            // Clear all toasts
  setConfig,        // Update configuration
} = useToast();
```

### useCompletionNotifications Hook

```typescript
import { useCompletionNotifications } from "@/hooks/useCompletionNotifications";

const {
  showSuccess,
  showError,
  showInfo,
  showProcessingComplete,
  showProcessingError,
  showProcessingStarted,
} = useCompletionNotifications({
  showToast: true,
  playSound: true,
  toastDuration: 5000,
  onNotificationShown: () => {},
});

// Show processing complete
showProcessingComplete(pageCount, processingTimeInSeconds);

// Show processing error
showProcessingError(failedPages, totalPages);

// Show processing started
showProcessingStarted(pageCount);
```

---

## Features

### 1. Visual Toast Notifications

- **4 Types**: Success (green), Error (red), Info (blue), Warning (yellow)
- **Icons**: Automatic icons based on type
- **Animations**: Smooth slide-in and fade-out transitions
- **Actions**: Optional action buttons for user interaction
- **Auto-dismiss**: Configurable duration (default 5 seconds)
- **Stacking**: Multiple toasts displayed with proper spacing
- **Responsive**: Mobile-friendly positioning

### 2. Sound Alerts

- **Web Audio API**: No external files needed
- **Procedural Generation**: Tones generated on-the-fly
- **Multiple Types**: Success, error, warning, info
- **Complex Notifications**: Multi-tone sequences for better UX
- **Volume Control**: 0-100% adjustable
- **Enable/Disable**: Toggle sound on/off
- **Preloading**: Instant playback without delay

### 3. User Preferences

- **Persistence**: Saved to localStorage
- **Sound Settings**: Volume, enable/disable
- **Toast Settings**: Position, duration, max count
- **Test Button**: Preview sounds before saving
- **Accessibility**: High contrast, keyboard navigation

### 4. Accessibility

- **ARIA Labels**: Proper screen reader support
- **Keyboard Navigation**: Tab through toast actions
- **Focus Management**: Proper focus handling
- **High Contrast**: Support for high contrast mode
- **Reduced Motion**: Respects prefers-reduced-motion
- **Color Not Alone**: Icons and colors for clarity

---

## Customization

### Change Toast Position

```typescript
const { setConfig } = useToast();
setConfig({ position: "bottom-center" });
```

### Customize Sound Volume

```typescript
soundAlertService.setVolume(0.7); // 70% volume
```

### Add Custom Toast Type

```typescript
// Extend ToastType and add handling in ToastContainer
type ToastType = "success" | "error" | "info" | "warning" | "custom";
```

### Disable Sounds

```typescript
soundAlertService.setEnabled(false);
```

---

## Performance Considerations

1. **Web Audio API**: Lightweight, no external files
2. **Toast Queue**: Limited to 5 toasts by default (configurable)
3. **Auto-cleanup**: Toasts auto-dismiss after duration
4. **Lazy Loading**: Sound context created on first use
5. **Memory**: Automatic cleanup of event listeners

---

## Browser Support

- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Full support (iOS 14.5+)
- **Mobile**: Full support with responsive positioning

---

## Troubleshooting

### Sound Not Playing

1. Check if sound is enabled: `soundAlertService.isEnabled()`
2. Check volume level: `soundAlertService.getVolume()`
3. Check browser audio permissions
4. Test with: `soundAlertService.playSuccessNotification()`

### Toasts Not Showing

1. Ensure ToastProvider wraps your app
2. Ensure ToastContainer is rendered
3. Check useToast is called within ToastProvider
4. Check browser console for errors

### Preferences Not Persisting

1. Check localStorage is enabled
2. Check browser privacy settings
3. Clear localStorage and try again
4. Check for localStorage quota exceeded

---

## Examples

### Example 1: Show Success After Upload

```typescript
const { showProcessingComplete } = useCompletionNotifications();

const handleUploadComplete = (pageCount: number, duration: number) => {
  showProcessingComplete(pageCount, duration);
};
```

### Example 2: Show Error with Retry

```typescript
const { error } = useToast();

const handleProcessingError = () => {
  error("Processing Failed", "Some pages failed to process", {
    action: {
      label: "Retry",
      onClick: () => {
        // Retry logic
      },
    },
  });
};
```

### Example 3: Custom Notification

```typescript
const { success } = useToast();

success("Custom Title", "Custom message", {
  duration: 10000, // 10 seconds
  action: {
    label: "View",
    onClick: () => {
      window.location.href = "/gallery";
    },
  },
});
```

---

## Next Steps

1. Integrate ToastProvider in main.tsx
2. Add ToastContainer to App.tsx
3. Update PDFUploadForm with completion notifications
4. Add NotificationSettings to settings page
5. Test notifications with various scenarios
6. Gather user feedback and iterate

