export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Redirects to our backend which handles Google OAuth (or local demo login).
// `next` is an optional same-origin path to land on after sign-in.
export const getLoginUrl = (next: string = "/books") => {
  const path = next.startsWith("/") && !next.startsWith("//") ? next : "/books";
  return `/api/auth/google?next=${encodeURIComponent(path)}`;
};
