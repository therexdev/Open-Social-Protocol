import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";

export function MessageSettingsDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && dialog.close) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog className="dialog message-settings-dialog" ref={ref} aria-labelledby="message-settings-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="message-settings-title">Message settings</h2>
      <Button variant="ghost" onClick={onClose} aria-label="Close message settings"><Icon name="close"/></Button>
    </header>
    {children}
  </dialog>;
}
