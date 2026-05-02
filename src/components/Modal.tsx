/**
 * Modal — overlay + centered panel, mobile = full-screen sheet, escape to
 * dismiss, click-outside to dismiss. Manages focus: traps Tab inside the
 * panel while open, focuses the panel on open, and restores focus to the
 * element that had it before the modal mounted on close.
 */

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Remember what had focus when we opened so we can put it back on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer to next tick so the panel is in the DOM before focus moves.
    queueMicrotask(() => panelRef.current?.focus());
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap. Find tabbable elements inside the panel and wrap.
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths: Record<typeof size, string> = {
    sm: "sm:max-w-sm",
    md: "sm:max-w-lg",
    lg: "sm:max-w-2xl",
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-surface w-full ${widths[size]} sm:rounded-lg shadow-xl border border-subtle flex flex-col sm:max-h-[90vh] outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <h2 id={titleId} className="text-sm font-semibold text-heading">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 rounded hover:bg-hover text-muted min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-subtle flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
