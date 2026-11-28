import { Link } from "react-router-dom";
import { BrandMark, Icon } from "../../components/Icon";
import { CopyButton } from "../../components/ui";
import { BROWSER_PLUGIN } from "./pluginRelease";

export function BrowserPluginPage() {
  return <div className="page plugin-page">
    <section className="plugin-hero">
      <div className="plugin-hero-copy"><span className="plugin-release"><Icon name="puzzle" size={17}/> CHROME DESKTOP <span className="plugin-beta">BETA {BROWSER_PLUGIN.version}</span></span>
        <h1>Your people.<br/><span>Beyond one website.</span></h1>
        <p className="plugin-lead">Open Social is more than a destination. Bring your network into the places you already browse.</p>
        <div className="plugin-hero-actions"><a className="btn btn-primary" href={BROWSER_PLUGIN.download} download><Icon name="download"/> Download Chrome beta</a><button type="button" className="btn btn-ghost" onClick={() => document.getElementById("install")?.scrollIntoView({ behavior: "smooth", block: "start" })}>How to install <Icon name="down" size={17}/></button></div>
        <p className="hint">Version {BROWSER_PLUGIN.version} beta · Desktop Chrome 116 or newer · Manual installation</p>
        <p className="plugin-mobile-note">On your phone? Open this page in Chrome on your computer to install the plugin.</p>
      </div>
      <div className="plugin-preview" aria-hidden="true">
        <div className="plugin-preview-bar"><span/><span/><span/><div>Your everyday browsing</div><Icon name="puzzle" size={18}/></div>
        <div className="plugin-preview-body"><div className="plugin-preview-feed"><span className="plugin-preview-label">YOUR SOCIAL FEED</span><div className="preview-native"><i/><b/><b/></div><div className="preview-social"><BrandMark/><span>Open Social</span><small>Your network travels with you.</small><p>Same people.<br/>More places to connect.</p><div><Icon name="heart" size={16}/><Icon name="message" size={16}/><Icon name="people" size={16}/></div></div><div className="preview-native"><i/><b/><b/></div></div><div className="plugin-preview-panel"><BrandMark/><strong>Open Social</strong><span><Icon name="home" size={16}/> Feed</span><span><Icon name="people" size={16}/> Friends</span><span><Icon name="message" size={16}/> Messages</span><div><Icon name="lock" size={22}/><small>Your keys.<br/>Your connections.</small></div></div></div>
        <p className="plugin-preview-caption">A standalone side panel, with optional social-site connections.</p>
      </div>
    </section>
    <section className="plugin-features" aria-label="What the plugin does">
      <article><Icon name="layers" size={25}/><h2>A home beside any tab</h2><p>Read and post, join groups, share photos, listen to music, and message friends from the Open Social side panel.</p></article>
      <article><Icon name="globe" size={25}/><h2>Your feed in more places</h2><p>Choose to see Open Social posts inside supported Facebook and X feeds. Connect each site only when you want to.</p></article>
      <article><Icon name="send" size={25}/><h2>Share while you’re there</h2><p>Use the Open Social checkbox in a supported site’s composer to share your text and the published post link with your Open Social audience.</p></article>
    </section>
    <section className="plugin-install card" id="install"><div className="plugin-section-heading"><span className="feature-icon"><Icon name="download" size={25}/></span><div><p className="eyebrow">GET SET UP</p><h2>Install the beta in a few minutes.</h2></div></div>
      <p>This beta is distributed as a ZIP. You’ll load its extracted folder into desktop Chrome.</p>
      <ol className="plugin-steps">
        <li><h3>Download and extract</h3><p>Download the beta above. Extract the ZIP into a folder you’ll keep, such as <code>OpenSocial-Plugin</code>. Its top level should contain <code>manifest.json</code>.</p></li>
        <li><h3>Open Chrome’s extension manager</h3><p>Enter <code>chrome://extensions</code> in a new tab, then turn on <strong>Developer mode</strong>.</p><CopyButton text="chrome://extensions" label="Copy extensions address"/></li>
        <li><h3>Choose the extracted folder</h3><p>Press <strong>Load unpacked</strong> and select the folder containing <code>manifest.json</code>. Keep that folder in place while the extension is installed.</p></li>
        <li><h3>Pin and open Open Social</h3><p>Use Chrome’s puzzle-piece menu to pin Open Social. Click its toolbar icon to open the side panel.</p></li>
      </ol>
      <a href={BROWSER_PLUGIN.chromeGuide} target="_blank" rel="noopener noreferrer" className="plugin-doc-link">Chrome’s official installation guide <Icon name="arrow" size={16}/></a>
    </section>
    <section className="plugin-use card"><div className="plugin-section-heading"><span className="feature-icon"><Icon name="spark" size={25}/></span><div><p className="eyebrow">MAKE IT YOURS</p><h2>One account. More ways to use it.</h2></div></div>
      <ol className="plugin-steps">
        <li><h3>Bring your existing account</h3><p>If you already use the website, export your identity backup from <strong>Settings → Account</strong> and import it in the plugin’s sign-in flow. Set a passphrase and keep your backup safe. Website sign-in is separate from the plugin.</p></li>
        <li><h3>Connect Facebook or X</h3><p>In the plugin, open <strong>More → Browser connections</strong>. Connect your account, unlock the site connection and complete device authorization when prompted. Enable only the sites you want and approve their site-access requests.</p></li>
        <li><h3>Browse, interact and share</h3><p>Refresh the connected site to see Open Social cards. When posting there, check <strong>Also publish to Open Social Protocol</strong> and choose your Open Social audience. The Open Social copy follows the original post’s published link.</p></li>
      </ol>
      <div className="plugin-note"><Icon name="info" size={21}/><p>Native Facebook/X images and videos stay on those sites; the cross-post includes your text and link. Post media directly in the Open Social panel to host it with Open Social. Each site keeps its own audience setting.</p></div>
      <p className="hint">A saved browser connection may use a different account from the side panel. Check the account shown in Browser connections before sharing.</p>
    </section>
    <div className="plugin-detail-grid"><section className="card"><span className="plugin-beta">BETA {BROWSER_PLUGIN.version}</span><h2>What to expect</h2><p>The beta includes mainnet support, hosted media playback, encrypted private content, and the latest simplified free-usage experience.</p><p>Facebook and X can change their pages. If sharing pauses, check <strong>More → Unfinished browser posts</strong> before retrying so you don’t post twice.</p><a href="https://github.com/therexdev/Open-Social-Protocol/issues" target="_blank" rel="noopener noreferrer">Report a problem <Icon name="arrow" size={16}/></a></section>
      <section className="card"><Icon name="shield" size={24}/><h2>Your choices stay yours.</h2><p>Site integrations are optional. The side panel works without them. Your Open Social keys stay in the plugin’s protected local vault; supported sites don’t receive your private reading keys.</p><p>The plugin doesn’t import your Facebook/X friends or old posts automatically. Friends-only content is encrypted for its recipients.</p><Link to="/about">Learn about the protocol <Icon name="arrow" size={16}/></Link></section></div>
    <section className="card plugin-update"><h2>Already using the beta?</h2><p>Save unsent text, extract the new download into your existing plugin folder, then use <strong>Reload</strong> on its card in <code>chrome://extensions</code>. Refresh Facebook and X afterwards. Keep the extension installed to retain its account and local history.</p><p>Moving from testnet? Select <strong>mainnet</strong> in <strong>Settings → Network & endpoints</strong> and clear old RPC, indexer and sponsor overrides. Site integrations have separate network settings in the extension’s <strong>Options</strong> page; update those too.</p><div className="row wrap"><a className="btn btn-primary" href={BROWSER_PLUGIN.download} download><Icon name="download"/> Get beta {BROWSER_PLUGIN.version}</a><a href={BROWSER_PLUGIN.checksum}>Download SHA-256 checksum</a></div></section>
  </div>;
}
