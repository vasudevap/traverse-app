# TRA-47 video evidence spike - implementation record

## Executable slice

The video worker now accepts an isolated `video-transcode` queue payload, downloads
one source object from S3, runs FFmpeg to create a browser-compatible MP4 plus JPEG
thumbnail, uploads both assets, and records per-attempt processing milliseconds.
Malformed payloads dead-letter; S3 and FFmpeg failures retain pg-boss retry behavior.

The client-side playback component is intentionally independent of the shared API
client. It accepts only a short-lived delivery URL and native browser playback
attributes, allowing it to be integrated after the concurrent Stage 2 API work
converges.

## Local evidence result

The worker contract and synthetic object-store flow passed its focused tests. A real
FFmpeg timing could not be produced in this worktree because `ffmpeg`, `ffprobe`,
Docker, and Podman are unavailable. No AWS credentials or NonProd object-store
environment were supplied, so signed delivery and browser playback could not be
measured without fabricating evidence.

## Convergence requirement

After ADP-02 lands, add the shared video domain migration and authenticated API
contract that creates upload URLs, persists video-message state, enqueues the worker
payload, and resolves an authorized short-lived playback URL. Then deploy the worker
image with FFmpeg, run one synthetic WebM upload in NonProd, and record upload,
transcode, signed-delivery, and browser-playback timings before creating Stage 3
delivery child ADPs.
