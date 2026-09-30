// Bundled in place of the native `node-datachannel` (the WebRTC backend of webrtc-polyfill).
// A published board ships without node_modules, so the real package would fail the bundle's
// static import and kill the service before it is ready. The client runs with `wrtc: false`, so
// WebRTC peers are never created; these exports exist only to satisfy the import.
function unavailable() {
    throw new Error("WebRTC is not available in the Torrent Viewer service.");
}

export class PeerConnection { constructor() { unavailable(); } }
export class RtcpReceivingSession { constructor() { unavailable(); } }
export class Video { constructor() { unavailable(); } }
export class Audio { constructor() { unavailable(); } }
export function cleanup() {}
