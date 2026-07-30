import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

function fakeReq(protocol: string, forwarded?: string): Request {
  return {
    protocol,
    headers: forwarded ? { "x-forwarded-proto": forwarded } : {},
  } as unknown as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses sameSite=lax and secure=false on local http (demo login works)", () => {
    const opts = getSessionCookieOptions(fakeReq("http"));
    expect(opts.secure).toBe(false);
    expect(opts.sameSite).toBe("lax");
    expect(opts.httpOnly).toBe(true);
  });

  it("uses sameSite=none and secure=true behind https / forwarded proto", () => {
    const opts = getSessionCookieOptions(fakeReq("https"));
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("none");
  });
});
