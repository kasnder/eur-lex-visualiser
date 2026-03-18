import React, { useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, m } from "framer-motion";

export function Accordion({ title, children, defaultOpen = false, isOpen, onToggle }) {
  const MotionPanel = m.div;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (isOpen !== undefined) {
      setOpen(isOpen);
    }
  }, [isOpen]);

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setOpen(!open);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:bg-gray-800 dark:border-gray-700">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium dark:text-gray-200"
        onClick={handleToggle}
      >
        <span>{title}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <MotionPanel
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="border-t p-2 dark:border-gray-700 dark:text-gray-300"
          >
            {children}
          </MotionPanel>
        )}
      </AnimatePresence>
    </div>
  );
}
