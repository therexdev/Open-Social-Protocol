/** Transient status messages (pending / confirmed / failed) with optional technical details. */
import { create } from "zustand";
import { randomId } from "../util/bytes";

export type ToastKind = "pending" | "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Technical details shown only inside an expander (transaction id, Mana used, ...). */
  details?: string[];
  createdAt: number;
  /** Sticky toasts stay until dismissed. */
  sticky?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, "id" | "createdAt"> & { id?: string }): string;
  update(id: string, patch: Partial<Omit<Toast, "id">>): void;
  dismiss(id: string): void;
  clear(): void;
}

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push(toast) {
    const id = toast.id ?? randomId(8);
    set((state) => ({ toasts: [...state.toasts.filter((t) => t.id !== id), { ...toast, id, createdAt: Date.now() }] }));
    return id;
  },
  update(id, patch) {
    set((state) => ({ toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clear() {
    set({ toasts: [] });
  },
}));

export function toast(kind: ToastKind, title: string, message?: string, details?: string[]): string {
  return useToasts.getState().push({ kind, title, ...(message && { message }), ...(details && { details }) });
}
