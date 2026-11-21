import { describe, expect, it } from "vitest";
import { classifyStatus, type FetchFn, TmdbClient } from "../src/client";

function recorder(respond: (url: URL) => Response | Promise<Response>) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetch: FetchFn = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return respond(url);
  };
  return { fetch, calls };
}

const V4 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl";

describe("TmdbClient", () => {
  it("sends a v4 token as Bearer and never in the URL", async () => {
    const r = recorder(() => Response.json({ id: 1, original_title: "x" }));
    let requests = 0;
    const res = await new TmdbClient({ token: V4, fetch: r.fetch, onRequest: () => requests++ }).movie(1);
    expect(res.ok).toBe(true);
    expect(r.calls[0]!.headers.Authorization).toBe(`Bearer ${V4}`);
    expect(r.calls[0]!.url.searchParams.has("api_key")).toBe(false);
    expect(r.calls[0]!.url.searchParams.get("append_to_response")).toContain("credits");
    expect(requests).toBe(1);
  });

  it("sends a v3 key as api_key", async () => {
    const r = recorder(() => Response.json({ genres: [] }));
    await new TmdbClient({ token: "0123456789abcdef0123456789abcdef", fetch: r.fetch }).genres("ru");
    expect(r.calls[0]!.url.searchParams.get("api_key")).toBe("0123456789abcdef0123456789abcdef");
    expect(r.calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("classifies errors and surfaces TMDB's status_message", async () => {
    const r = recorder(() => Response.json({ status_code: 34, status_message: "The resource you requested could not be found." }, { status: 404 }));
    const res = await new TmdbClient({ token: V4, fetch: r.fetch }).movie(404);
    expect(res).toMatchObject({ ok: false, kind: "not_found", message: expect.stringContaining("could not be found") });
  });

  it("treats network errors as transient", async () => {
    const res = await new TmdbClient({
      token: V4,
      fetch: () => Promise.reject(new TypeError("network down")),
    }).movie(1);
    expect(res).toMatchObject({ ok: false, kind: "transient", status: 0 });
  });

  it("classifyStatus", () => {
    expect([404, 429, 401, 503, 408, 400].map(classifyStatus)).toEqual([
      "not_found",
      "rate_limited",
      "auth",
      "transient",
      "transient",
      "bad_request",
    ]);
  });
});
