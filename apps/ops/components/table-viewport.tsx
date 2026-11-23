'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Display-only scroll state. Financial values remain server-rendered children. */
export function TableViewport({
  children,
  label,
  identity = false,
}: {
  children: ReactNode;
  label: string;
  identity?: boolean;
}) {
  const region = useRef<HTMLDivElement>(null);
  const hint = useId();
  const [pinned, setPinned] = useState(true);
  const [overflow, setOverflow] = useState(false);
  const [position, setPosition] = useState('start');
  useEffect(() => {
    // A return fragment can arrive before streamed rows or hydration. Restore
    // only an existing row in this table after its committed children render.
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
        const row = document.getElementById(id);
        if (!row || !region.current?.contains(row)) return;
        row.scrollIntoView({
          block: 'center',
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
  }, [children]);
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const measure = () => {
      const headerHeight =
        element.querySelector('thead')?.getBoundingClientRect().height ?? 0;
      element.style.setProperty('--table-header', headerHeight + 'px');
      setOverflow(element.scrollWidth > element.clientWidth + 1);
      setPosition(
        element.scrollLeft < 1
          ? 'start'
          : element.scrollLeft + element.clientWidth >= element.scrollWidth - 1
            ? 'end'
            : 'middle',
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, []);
  return (
    <div
      className={`table-viewport${identity && pinned ? ' pin-identity' : ''}`}
    >
      <div className="table-tools" hidden={!overflow}>
        <span id={hint}>
          {position === 'start'
            ? 'More columns to the right →'
            : position === 'end'
              ? '← More columns to the left'
              : '← More columns in both directions →'}{' '}
          <span className="scroll-instruction">
            Focus table and use arrow keys, or swipe.
          </span>
        </span>
        {identity && (
          <label>
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
            />
            Pin record identity
          </label>
        )}
      </div>
      <div
        ref={region}
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label={label}
        aria-describedby={overflow ? hint : undefined}
        onFocusCapture={(event) => {
          // Reveal a keyboard-focused link beside the pinned identity column.
          const element = region.current;
          const target = event.target as HTMLElement;
          const cell = target.closest('td, th');
          if (!element || !cell || cell.closest('thead')) return;
          const top =
            element.getBoundingClientRect().top +
            (element.querySelector('thead')?.getBoundingClientRect().height ??
              0) +
            6;
          if (target.getBoundingClientRect().top < top)
            element.scrollTop -= top - target.getBoundingClientRect().top;
          if (
            cell === cell.parentElement?.firstElementChild ||
            !identity ||
            !pinned
          )
            return;
          const boundary =
            element.getBoundingClientRect().left +
            (element
              .querySelector('tbody tr > :first-child')
              ?.getBoundingClientRect().width ?? 0);
          const left = target.getBoundingClientRect().left;
          if (left < boundary + 6) element.scrollLeft -= boundary + 6 - left;
        }}
      >
        {children}
      </div>
    </div>
  );
}
