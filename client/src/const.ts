export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Redirects to our backend which handles Google OAuth
export const getLoginUrl = () => "/api/auth/google";
