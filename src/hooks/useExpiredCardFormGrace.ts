import { advanceGraceElapsed, expiredCardFormAction } from "@/lib/checkoutFlow";
import { useEffect, useRef, type RefObject } from "react";

/**
 * The reservation timer ended while the card form is open (`active`). The
 * form is kept (covered by the screen) for the grace period in
 * `expiredCardFormAction`, so a result CyberSource is already processing can
 * still arrive; with no result by then, `onClose` is called. `graceRef` is
 * kept true while the grace period runs, for the screen's synchronous Back
 * guards. Only foreground time counts (`advanceGraceElapsed`): after the app
 * returns from the background, a result the paused WebView now delivers still
 * gets the rest of the grace period.
 */
export function useExpiredCardFormGrace(
  active: boolean,
  graceRef: RefObject<boolean>,
  resultReceived: () => boolean,
  onClose: () => void,
) {
  const elapsedRef = useRef(0);
  const resultReceivedRef = useRef(resultReceived);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    resultReceivedRef.current = resultReceived;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    graceRef.current = active;
    if (!active) return;
    let lastTickAt = Date.now();
    const check = () => {
      const now = Date.now();
      elapsedRef.current = advanceGraceElapsed(elapsedRef.current, lastTickAt, now);
      lastTickAt = now;
      const action = expiredCardFormAction({
        resultReceived: resultReceivedRef.current(),
        elapsedMs: elapsedRef.current,
      });
      if (action === "close") onCloseRef.current();
    };
    const interval = setInterval(check, 1000);
    return () => {
      clearInterval(interval);
      graceRef.current = false;
    };
  }, [active, graceRef]);
}
