import { useState } from "react";
import { Button, ConfirmDialog } from "../components/ui";
import { Icon } from "../components/Icon";
import { applyUpdate, usePwa } from "./state";
export function InstallButton() {
  const { prompt, installed } = usePwa();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  if (installed) return <span className="installed-label"><Icon name="check" /> App installed</span>;
  return <><Button variant="ghost" className="install-button" busy={busy} onClick={async () => {
    if (!prompt) { setHelp(true); return; }
    setBusy(true);
    try { await prompt.prompt(); await prompt.userChoice; } catch { setHelp(true); }
    finally { usePwa.setState({ prompt: undefined }); setBusy(false); }
  }}><Icon name="download" /> Install app</Button><ConfirmDialog open={help} title="Open Social, one tap away" confirmLabel="Got it" cancelLabel="Close" onConfirm={() => setHelp(false)} onCancel={() => setHelp(false)}><p>Install Open Social to open it from your home screen in its own window.</p><p><strong>iPhone or iPad:</strong> open this site in Safari, tap Share, then Add to Home Screen.</p><p><strong>Android or desktop:</strong> look for Install app or Add to Home Screen in your browser’s menu or address bar.</p><p className="muted">If your browser doesn’t offer installation, you can still use the website normally.</p></ConfirmDialog></>;
}
export function PwaStatus() {
  const { offline, updateAvailable } = usePwa();
  const [review, setReview] = useState(false);
  return <>{offline && <div className="banner banner-info" role="status">You’re offline. Your account is still on this device. Reconnect to load posts or publish.</div>}{updateAvailable && <div className="banner update-banner" role="status"><span>A fresh version is ready.</span><Button variant="ghost" onClick={() => setReview(true)}>Update app</Button></div>}<ConfirmDialog open={review} title="Update Open Social?" confirmLabel="Update and reload" onCancel={() => setReview(false)} onConfirm={applyUpdate}><p>Finish or copy anything you’re writing first. Updating reloads this tab.</p></ConfirmDialog></>;
}
