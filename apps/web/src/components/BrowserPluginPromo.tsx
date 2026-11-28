import { Link } from "react-router-dom";
import { create } from "zustand";
import { BROWSER_PLUGIN } from "../features/plugin/pluginRelease";
import { Icon } from "./Icon";

const DISMISSED_KEY = "osp.web.plugin-promo-dismissed";
function wasDismissed(): boolean {
  try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}
// Both placements share the preference, including when the viewport changes.
const usePluginPromo = create<{ dismissed: boolean; dismiss(): void }>(set => ({
  dismissed: wasDismissed(),
  dismiss() {
    set({ dismissed: true });
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Still dismiss for this visit when storage is unavailable. */ }
  },
}));

export function BrowserPluginPromo({ variant = "rail" }: { variant?: "rail" | "inline" }) {
  const { dismissed, dismiss } = usePluginPromo();
  if (dismissed || (typeof location !== "undefined" && location.protocol === "chrome-extension:")) return null;
  return <section className={`plugin-promo plugin-promo-${variant}`} aria-label="Open Social browser plugin">
    <button type="button" className="plugin-promo-close" aria-label="Dismiss browser plugin suggestion" title="Dismiss" onClick={dismiss}><Icon name="close" size={14}/></button>
    <span className="plugin-promo-icon"><Icon name="puzzle" size={24}/></span>
    <div className="plugin-promo-copy"><span className="eyebrow">CHROME PLUGIN <span className="plugin-beta">BETA</span></span>
      <h2>Take your network with you.</h2>
      <p>Bring Open Social into Facebook and X. Your people, beyond one website.</p>
      <Link to={BROWSER_PLUGIN.page} className={variant === "rail" ? "btn btn-primary" : "plugin-promo-link"}>Explore the plugin <Icon name="arrow" size={16}/></Link>
    </div>
  </section>;
}
