import React, { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg glass-panel rounded-2xl border border-white/10 shadow-2xl p-6 overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
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
