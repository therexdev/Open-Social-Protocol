import { useEffect } from "react";
import { useToasts } from "../stores/toasts";
import { Details } from "./ui";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      for (const toast of useToasts.getState().toasts) {
        if (!toast.sticky && toast.kind !== "pending" && now - toast.createdAt > 8000) dismiss(toast.id);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [dismiss]);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <div className="toast-main">
            <strong>{toast.title}</strong>
            {toast.message && <p>{toast.message}</p>}
            {toast.details && toast.details.length > 0 && (
              <Details summary="Details">
                <ul className="toast-details">
                  {toast.details.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </Details>
            )}
          </div>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
