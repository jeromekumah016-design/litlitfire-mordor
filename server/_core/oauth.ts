import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

function getRedirectUri(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.get("host");
  return `${proto}://${host}/api/oauth/callback`;
}

export function registerOAuthRoutes(app: Express) {
  // Redirect to Google OAuth consent screen
  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (!ENV.googleClientId) {
      res.status(500).json({ error: "GOOGLE_CLIENT_ID is not configured" });
      return;
    }
    const redirectUri = getRedirectUri(req);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("access_type", "online");
    res.redirect(url.toString());
  });

  // Google OAuth callback
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    if (error || !code) {
      res.status(400).json({ error: error ?? "Missing code" });
      return;
    }

    try {
      const redirectUri = getRedirectUri(req);

      // Exchange code for tokens
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenResp.ok) {
        const body = await tokenResp.text().catch(() => "");
        console.error("[OAuth] Token exchange failed:", tokenResp.status, body);
        res.status(500).json({ error: "Token exchange failed" });
        return;
      }

      const tokenData = (await tokenResp.json()) as { access_token: string };

      // Get user info from Google
      const userResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userResp.ok) {
        res.status(500).json({ error: "Failed to get user info" });
        return;
      }

      const userInfo = (await userResp.json()) as {
        id: string;
        email: string;
        name: string;
      };

      const openId = `google_${userInfo.id}`;

      await db.upsertUser({
        openId,
        name: userInfo.name ?? null,
        email: userInfo.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: userInfo.name ?? "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (err) {
      console.error("[OAuth] Callback failed:", err);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
