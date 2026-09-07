import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

async function enableDevelopmentMocks() {
  if (!import.meta.env.DEV) return;
  // Opt-out for real end-to-end runs against the live backend (see docs/demo-runbook.md).
  if (import.meta.env["VITE_MSW"] === "0") {
    // A previously registered MSW service worker keeps intercepting requests
    // (including LiveKit's WebSocket) even when the app no longer starts it.
    // Unregister it so the opt-out actually reaches the network.
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (registration.active?.scriptURL.includes("mockServiceWorker")) {
          await registration.unregister();
        }
      }
    }
    return;
  }
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

await enableDevelopmentMocks();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
