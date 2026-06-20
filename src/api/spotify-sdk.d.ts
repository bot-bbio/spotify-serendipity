/**
 * Ambient type declarations for the Spotify Web Playback SDK
 * (https://sdk.scdn.co/spotify-player.js). Only the surface the playback layer
 * uses is typed, so `playback.ts` stays free of `any`. The SDK injects the global
 * `window.Spotify` and invokes `window.onSpotifyWebPlaybackSDKReady` when loaded.
 */

interface Window {
  onSpotifyWebPlaybackSDKReady: () => void;
  Spotify: typeof Spotify;
}

declare namespace Spotify {
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }

  interface Image {
    url: string;
    height: number | null;
    width: number | null;
  }

  interface Album {
    uri: string;
    name: string;
    images: Image[];
  }

  interface Artist {
    uri: string;
    name: string;
  }

  interface Track {
    uri: string;
    id: string | null;
    name: string;
    duration_ms: number;
    album: Album;
    artists: Artist[];
  }

  interface PlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    track_window: { current_track: Track };
  }

  interface WebPlaybackInstance {
    device_id: string;
  }

  interface Error {
    message: string;
  }

  type ErrorType =
    | 'initialization_error'
    | 'authentication_error'
    | 'account_error'
    | 'playback_error';

  interface Player {
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(
      event: 'ready' | 'not_ready',
      cb: (instance: WebPlaybackInstance) => void,
    ): boolean;
    addListener(event: 'player_state_changed', cb: (state: PlaybackState | null) => void): boolean;
    addListener(event: ErrorType, cb: (error: Error) => void): boolean;
    removeListener(event: string): boolean;
    getCurrentState(): Promise<PlaybackState | null>;
    togglePlay(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    setName(name: string): Promise<void>;
    setVolume(volume: number): Promise<void>;
  }

  const Player: {
    new (init: PlayerInit): Player;
  };
}
