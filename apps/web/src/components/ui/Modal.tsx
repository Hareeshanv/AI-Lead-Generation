import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Button } from "./Button";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer }) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-lg glass-panel rounded-2xl border border-white/10 shadow-2xl p-6 overflow-hidden focus:outline-none"
      >
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h3 id={titleId} className="text-lg font-semibold text-foreground">
            {title}
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="pt-4 border-t border-border flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
};
