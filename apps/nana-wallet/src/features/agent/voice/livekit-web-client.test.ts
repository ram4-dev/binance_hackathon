import { describe, expect, it } from "vitest";
import { createLiveKitTokenSource } from "./livekit-web-client";

describe("LiveKit token source selection", () => {
  it("uses the custom endpoint URL when a token URL is configured", () => {
    const ts = createLiveKitTokenSource({
      tokenUrl: "http://localhost:3000/v1/livekit/connection-details",
    });
    expect((ts as unknown as { url?: string }).url).toBe(
      "http://localhost:3000/v1/livekit/connection-details",
    );
  });

  it("falls back to the development token server when no token URL is set", () => {
    const ts = createLiveKitTokenSource({ tokenServerId: "abc-123" });
    expect((ts as unknown as { url?: string }).url).toBe(
      "https://cloud-api.livekit.io/api/v2/sandbox/connection-details",
    );
  });
});
