/** Raised when bytes or text received from a peer do not form a valid protocol message. */
export class ProtocolError extends Error {
  override name = 'ProtocolError';
}

/** Raised when a stream frame's signature does not match the session's host key. */
export class FrameVerificationError extends ProtocolError {
  override name = 'FrameVerificationError';
}
