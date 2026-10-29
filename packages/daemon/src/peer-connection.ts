import { RTCPeerConnection as PolyfillPeerConnection } from 'node-datachannel/polyfill';

/**
 * node-datachannel passes TURN credentials to libdatachannel inside the URL
 * (`turn:<username>:<credential>@host`) without escaping them. TURN REST usernames contain `:`
 * (`<expiry>:<label>`) and base64 credentials can contain `/`, `+` and `=`, so libdatachannel would
 * cut them short; percent-encoded, it decodes them back.
 */
export function escapeTurnCredentials(config: RTCConfiguration): RTCConfiguration {
  return {
    ...config,
    ...(config.iceServers
      ? {
          iceServers: config.iceServers.map((server) => ({
            ...server,
            ...(server.username !== undefined ? { username: encodeURIComponent(server.username) } : {}),
            ...(server.credential !== undefined ? { credential: encodeURIComponent(server.credential) } : {}),
          })),
        }
      : {}),
  };
}

/** A WebRTC peer connection for the daemon, backed by node-datachannel. */
export function createPeerConnection(config: RTCConfiguration): RTCPeerConnection {
  return new PolyfillPeerConnection(escapeTurnCredentials(config)) as unknown as RTCPeerConnection;
}
