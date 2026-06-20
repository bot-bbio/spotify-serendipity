/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Spotify application Client ID — a *public* identifier, safe for client-side
   * use with the Authorization Code + PKCE flow (PKCE replaces the secret, which
   * must never reach the browser). Injected at build/dev time from a `.env` file;
   * see `.env.example`.
   */
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
