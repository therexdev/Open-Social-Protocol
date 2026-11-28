import { create } from "zustand";

export type UsageLimitKind = "daily" | "account" | "service";
export interface UsagePrompt {
  kind: UsageLimitKind;
  chainId: string;
  payer: string;
  /** Privacy aliases and sponsor-owned allocations must never be funding targets. */
  canUseOwnAccount: boolean;
  resetAt?: number;
}
const key = (notice: UsagePrompt) => `${notice.chainId}:${notice.payer}:${notice.kind}`;
export const useUsagePrompt = create<{
  notice?: UsagePrompt;
  dismissed: Record<string, number>;
  open: (notice: UsagePrompt, background?: boolean) => void;
  close: () => void;
}>()((set, get) => ({
  dismissed: {},
  open(notice, background = false) {
    const state = get();
    if (state.notice && key(state.notice) === key(notice)) {
      if (notice.canUseOwnAccount && !state.notice.canUseOwnAccount) set({ notice });
      return;
    }
    if (background && (state.dismissed[key(notice)] ?? 0) > Date.now()) return;
    set({ notice });
  },
  close() {
    const state = get();
    set({ notice: undefined, dismissed: state.notice ? { ...state.dismissed, [key(state.notice)]: Date.now() + 300000 } : state.dismissed });
  },
}));
