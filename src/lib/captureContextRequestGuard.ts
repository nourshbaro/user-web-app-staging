type SessionRef = {
  current: string | null;
};

export function shouldInitializeCaptureContext(
  paymentMethod: string,
  sessionId: string | null,
): sessionId is string {
  return paymentMethod === "cybersource" && sessionId !== null;
}

export function beginCaptureContextRequest(
  captureSessionRef: SessionRef,
  captureRetrySessionRef: SessionRef,
  sessionId: string,
  force = false,
) {
  if (force) {
    if (captureRetrySessionRef.current === sessionId) return false;
    captureRetrySessionRef.current = sessionId;
  } else if (captureSessionRef.current === sessionId) {
    return false;
  }

  captureSessionRef.current = sessionId;
  return true;
}

export function releaseCaptureContextRetry(
  captureRetrySessionRef: SessionRef,
  sessionId: string,
  force: boolean,
) {
  if (force && captureRetrySessionRef.current === sessionId) {
    captureRetrySessionRef.current = null;
  }
}

export function invalidateCaptureContextRequestRefs(
  captureSessionRef: SessionRef,
  captureRetrySessionRef: SessionRef,
  currentSessionId: string | null,
) {
  if (captureSessionRef.current !== currentSessionId) {
    captureSessionRef.current = null;
  }

  if (captureRetrySessionRef.current !== currentSessionId) {
    captureRetrySessionRef.current = null;
  }
}