import { describe, expect, it } from "vitest";
import { unauthedFetch } from "./test-utils.js";

describe("GET /api/v1/health", () => {
  it("returns ok without auth", async () => {
    const res = await unauthedFetch("/api/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; version: string } };
    expect(body.data.status).toBe("ok");
    expect(body.data.version).toBe("test");
  });
});
