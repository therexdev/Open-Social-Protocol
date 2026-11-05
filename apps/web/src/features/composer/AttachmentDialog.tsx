import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";

export function AttachmentDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useId();
  useEffect(() => {
    const element = dialog.current!;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    return () => { if (element.open && typeof element.close === "function") element.close(); };
  }, []);
  return <dialog ref={dialog} className="dialog attachment-dialog" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="attachment-heading"><h2 id={heading}>{title}</h2>
      <Button variant="ghost" onClick={onClose} aria-label="Close"><Icon name="close" size={20}/></Button>
    </div>
    {children}
  </dialog>;
}
