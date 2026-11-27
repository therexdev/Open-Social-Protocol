import { Link } from "react-router-dom";
import { BROWSER_PLUGIN } from "../features/plugin/pluginRelease";
import { Icon } from "./Icon";

export function BrowserPluginPromo({ variant = "rail" }: { variant?: "rail" | "inline" }) {
  if (typeof location !== "undefined" && location.protocol === "chrome-extension:") return null;
  return <section className={`plugin-promo plugin-promo-${variant}`} aria-label="Open Social browser plugin">
    <span className="plugin-promo-icon"><Icon name="puzzle" size={24}/></span>
    <div className="plugin-promo-copy"><span className="eyebrow">CHROME PLUGIN <span className="plugin-beta">BETA</span></span>
      <h2>Take your network with you.</h2>
      <p>Bring Open Social into Facebook and X. Your people, beyond one website.</p>
      <Link to={BROWSER_PLUGIN.page} className={variant === "rail" ? "btn btn-primary" : "plugin-promo-link"}>Explore the plugin <Icon name="arrow" size={16}/></Link>
    </div>
  </section>;
}
