import { useState } from 'react';

export interface VideoPlaybackProps {
  /** A short-lived delivery URL supplied by the future video API module. */
  playbackUrl: string;
  posterUrl?: string;
  title: string;
}

/**
 * Isolated native playback surface for the Stage 3 evidence slice. It intentionally
 * accepts a delivery URL rather than importing the shared API client, so it can land
 * without changing the concurrent Stage 2 API contract.
 */
export function VideoPlayback({ playbackUrl, posterUrl, title }: VideoPlaybackProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p role="alert">
        This video could not be played. Refresh the page to request a new playback link.
      </p>
    );
  }

  return (
    <video
      aria-label={title}
      controls
      onError={() => setFailed(true)}
      playsInline
      poster={posterUrl}
      preload="metadata"
      src={playbackUrl}
    >
      Your browser does not support video playback.
    </video>
  );
}
