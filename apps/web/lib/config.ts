// In development the web app (:3000) and the server (:4000) run separately,
// so NEXT_PUBLIC_SERVER_URL points at the server. In production the server
// serves the web app itself, so we default to the same origin.
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ??
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:4000");
