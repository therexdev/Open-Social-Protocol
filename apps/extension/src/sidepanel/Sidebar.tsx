import { useRef, useState } from "react";
import { App } from "./App";

/** Keep the full client mounted when visiting browser tools so uploads keep running. */
export function Sidebar() {
  const [tools, setTools] = useState(new URLSearchParams(location.hash.slice(1)).has("post"));
  const [toolsOpened, setToolsOpened] = useState(tools);
  const frame = useRef<HTMLIFrameElement>(null);
  const appUrl = chrome.runtime.getURL("social/index.html");
  const openTab = () => {
    const hash = frame.current?.contentWindow?.location.hash || "#/";
    void chrome.tabs.create({ url: appUrl + hash });
  };
  return <div className="extension-shell">
    <nav className="extension-toolbar" aria-label="Extension views">
      <button aria-pressed={!tools} onClick={() => setTools(false)}>Social</button>
      <button aria-pressed={tools} onClick={() => { setToolsOpened(true); setTools(true); }}>Browser tools</button>
      <button onClick={openTab} title="Open the full app in a browser tab">Open in tab ↗</button>
    </nav>
    <iframe ref={frame} className="social-frame" title="Open Social app" src={appUrl + "#/"} allow="microphone; camera" hidden={tools}/>
    <div className="browser-tools" hidden={!tools}>{toolsOpened && <App/>}</div>
  </div>;
}
