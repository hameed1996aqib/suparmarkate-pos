import { useEffect } from "react";

type UsePosShortcutsInput = {
  onFocusBarcode: () => void;
  onHoldCart: () => void;
  onSubmitSale: () => void;
  onPrintLastReceipt: () => void;
  onEscape: () => void;
};

export function usePosShortcuts({
  onFocusBarcode,
  onHoldCart,
  onSubmitSale,
  onPrintLastReceipt,
  onEscape,
}: UsePosShortcutsInput) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();

      const isTyping =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.getAttribute("contenteditable") === "true";

      if (event.key === "F2") {
        event.preventDefault();
        onFocusBarcode();
        return;
      }

      if (event.key === "F4") {
        event.preventDefault();
        onHoldCart();
        return;
      }

      if (event.key === "F8") {
        event.preventDefault();
        onPrintLastReceipt();
        return;
      }

      if (event.key === "F9") {
        event.preventDefault();
        onSubmitSale();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }

      if (!isTyping) {
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onFocusBarcode, onHoldCart, onPrintLastReceipt, onSubmitSale, onEscape]);
}