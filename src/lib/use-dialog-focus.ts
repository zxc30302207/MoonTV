'use client';

import { RefObject, useEffect, useRef } from 'react';

/** Keep keyboard focus in an open modal and return it to its trigger on close. */
export function useDialogFocus(
  open: boolean,
  ref: RefObject<HTMLElement>,
  onClose: () => void,
  returnFocus?: RefObject<HTMLElement>
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous =
      returnFocus?.current || (document.activeElement as HTMLElement | null);
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
        )
      ).filter(
        (element) =>
          !element.hidden && element.getAttribute('aria-hidden') !== 'true'
      );
    (focusable()[0] || dialog).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref, returnFocus]);
}
