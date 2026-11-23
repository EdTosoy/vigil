'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Restore a record fragment once its streamed content has rendered. */
export function useRecordFragment(
  children: ReactNode,
  block: ScrollLogicalPosition,
) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let id: string;
        try {
          id = decodeURIComponent(window.location.hash.slice(1));
        } catch {
          return;
        }
        if (!id.startsWith('record-')) return;
        const record = document.getElementById(id);
        if (!record || !region.current?.contains(record)) return;
        record.scrollIntoView({
          block,
          inline: 'nearest',
          behavior: 'instant',
        });
      });
    };
    restore();
    window.addEventListener('hashchange', restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', restore);
    };
  }, [children, block]);
  return region;
}

export function RecordFragment({ children }: { children: ReactNode }) {
  const region = useRecordFragment(children, 'start');
  return <div ref={region}>{children}</div>;
}
