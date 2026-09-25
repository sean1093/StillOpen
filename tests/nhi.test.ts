import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry } from "../scripts/nhi";

afterEach(() => {
  vi.unstubAllGlobals();
});

function networkError(): Error {
  return new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
}

describe("fetchWithRetry", () => {
  it("retries a dropped connection and returns the eventual response", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithRetry("https://example.test/a", { baseDelayMs: 0 });
    expect(await res.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx but returns other 4xx without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithRetry("https://example.test/b", { baseDelayMs: 0 });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt with the URL and underlying cause", async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkError());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithRetry("https://example.test/c", { attempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow("https://example.test/c -> fetch failed: ECONNRESET (after 3 attempts)");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
