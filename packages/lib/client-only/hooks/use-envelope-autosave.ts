import { useCallback, useEffect, useRef, useState } from 'react';

export function useEnvelopeAutosave<T>(saveFn: (data: T) => Promise<void>, delay = 1000) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<T | null>(null);
  const pendingPromiseRef = useRef<Promise<void> | null>(null);

  const [isPending, setIsPending] = useState(false);
  const [isCommiting, setIsCommiting] = useState(false);

  // Lets the scheduled save re-arm itself without depending on the callback
  // identity, which changes whenever the caller re-renders.
  const triggerSaveRef = useRef<(data: T) => void>(() => undefined);

  const triggerSave = useCallback(
    (data: T) => {
      lastArgsRef.current = data;

      // A debounce or promise means something is pending
      setIsPending(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      timeoutRef.current = setTimeout(async () => {
        if (!lastArgsRef.current) {
          return;
        }

        // Something is still being saved. Anything created by that save does
        // not have an id yet, and the server treats a record with no id as a
        // new one, so sending the same thing again now makes it create a
        // second copy. Wait for the running save to come back with the ids
        // before sending anything else.
        if (pendingPromiseRef.current) {
          await pendingPromiseRef.current.catch(() => undefined);

          if (lastArgsRef.current) {
            triggerSaveRef.current(lastArgsRef.current);
          } else {
            // A flush took the pending changes while we were waiting, so there
            // is nothing left to save and nothing left to report as saving.
            timeoutRef.current = null;
            setIsPending(false);
          }

          return;
        }

        const args = lastArgsRef.current;
        lastArgsRef.current = null;
        timeoutRef.current = null;

        setIsCommiting(true);
        pendingPromiseRef.current = saveFn(args);

        try {
          await pendingPromiseRef.current;
        } finally {
          // eslint-disable-next-line require-atomic-updates
          pendingPromiseRef.current = null;
          setIsCommiting(false);
          setIsPending(false);
        }
      }, delay);
    },
    [saveFn, delay],
  );

  triggerSaveRef.current = triggerSave;

  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (pendingPromiseRef.current) {
      // Already running → wait for it
      await pendingPromiseRef.current;
      return;
    }

    if (lastArgsRef.current) {
      const args = lastArgsRef.current;
      lastArgsRef.current = null;

      setIsCommiting(true);
      setIsPending(true);

      pendingPromiseRef.current = saveFn(args);
      try {
        await pendingPromiseRef.current;
      } finally {
        // eslint-disable-next-line require-atomic-updates
        pendingPromiseRef.current = null;
        setIsCommiting(false);
        setIsPending(false);
      }
    }
  }, [saveFn]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (timeoutRef.current || pendingPromiseRef.current) {
        void flush();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [flush]);

  return { triggerSave, flush, isPending, isCommiting };
}
