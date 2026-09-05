import { useCallback, useEffect, useState } from "react";
import { APP_VERSION, FACEBOOK_ORIGINS } from "../shared/config";
import { errorMessage } from "../shared/format";
import type { AdapterStatusView, SettingsView, VaultStatusView } from "../shared/protocol";
import { rpc } from "../shared/rpc";
import type { Settings } from "../shared/settings";

function lines(values: string[]): string {
  return values.join("\n");
}
function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function OptionsApp() {
  const [view, setView] = useState<SettingsView | undefined>();
  const [adapters, setAdapters] = useState<AdapterStatusView | undefined>();
  const [vault, setVault] = useState<VaultStatusView | undefined>();
  const [form, setForm] = useState<Partial<Settings>>({});
  const [rpcText, setRpcText] = useState("");
  const [sponsorText, setSponsorText] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [passphrase, setPassphrase] = useState("");
  const [exported, setExported] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const [s, a, v] = await Promise.all([rpc<SettingsView>("settings.get"), rpc<AdapterStatusView>("adapter.status"), rpc<VaultStatusView>("vault.status")]);
      setView(s);
      setAdapters(a);
      setVault(v);
      setForm(s.settings);
      setRpcText(lines(s.settings.rpcUrls));
      setSponsorText(lines(s.settings.sponsorUrls));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setError(undefined);
    setMessage(undefined);
    try {
      await fn();
      setMessage(label);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function enableFacebook() {
    await act("Facebook adapter enabled.", async () => {
      // The permission prompt must be triggered from this page (user gesture); the service worker registers the script.
      const granted = await chrome.permissions.request({ origins: FACEBOOK_ORIGINS });
      if (!granted) throw new Error("Permission was not granted.");
      await rpc("adapter.enable", { adapter: "facebook" });
    });
  }

  async function disableFacebook() {
    await act("Facebook adapter disabled and permission removed.", () => rpc("adapter.disable", { adapter: "facebook" }));
  }

  async function saveEndpoints() {
    await act("Settings saved.", () =>
      rpc("settings.update", {
        patch: {
          network: form.network,
          rpcUrls: parseLines(rpcText),
          indexerUrl: form.indexerUrl ?? "",
          sponsorUrls: parseLines(sponsorText),
          payment: form.payment,
          autoLockMinutes: Number(form.autoLockMinutes ?? 15),
        },
      }),
    );
  }

  if (!view || !adapters || !vault) return <div className="options">{error ? <div className="error">{error}</div> : "Loading…"}</div>;

  return (
    <div className="options">
      <h1>Open Social Protocol</h1>
      <p className="muted">
        Version {APP_VERSION} · network <strong>{view.resolved.network}</strong> · {view.resolved.deployed ? "contracts deployed" : view.resolved.deploymentMessage}
      </p>
      {message && <div className="notice">{message}</div>}
      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>Facebook adapter</h2>
        <p className="muted">
          Adds a clearly labeled "Also publish to Open Social Protocol" control to the Facebook composer. It only reads the text you typed in the composer, only when you tick the box and press Post, and nothing is published until you confirm in the side panel. Requires access to {FACEBOOK_ORIGINS.join(" and ")}.
        </p>
        <p>
          Status: {adapters.facebook.registered ? <span className="pill good">active</span> : adapters.facebook.granted ? <span className="pill warn">permission granted, not active</span> : <span className="pill">off</span>}
        </p>
        <div className="row">
          {adapters.facebook.registered ? (
            <button className="danger" onClick={disableFacebook}>
              Disable and remove site access
            </button>
          ) : (
            <button className="primary" onClick={enableFacebook}>
              Enable (asks for site access)
            </button>
          )}
        </div>
        <label className="row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            disabled={!adapters.facebook.registered}
            checked={adapters.feedInsertion}
            onChange={(e) => act(e.target.checked ? "Labeled feed cards enabled." : "Labeled feed cards disabled.", () => rpc("settings.update", { patch: { feedInsertion: e.target.checked } }))}
          />
          <span>Show a labeled "Open Social Protocol posts" box (up to 5 public posts) at the top of the Facebook feed (off by default)</span>
        </label>
      </section>

      <section className="card">
        <h2>Endpoints</h2>
        <label>
          <span className="lbl">Network</span>
          <select value={form.network ?? ""} onChange={(e) => setForm({ ...form, network: e.target.value })}>
            {view.networks.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="lbl">RPC endpoints (one per line; empty = deployment defaults: {view.resolved.rpcUrls.join(", ") || "none"})</span>
          <textarea value={rpcText} onChange={(e) => setRpcText(e.target.value)} />
        </label>
        <label>
          <span className="lbl">Indexer URL (empty = deployment default: {view.resolved.indexerUrl || "none"})</span>
          <input type="url" value={form.indexerUrl ?? ""} onChange={(e) => setForm({ ...form, indexerUrl: e.target.value })} placeholder="https://indexer.example.org" />
        </label>
        <label>
          <span className="lbl">Sponsors (one per line; empty = deployment defaults: {view.resolved.sponsorUrls.join(", ") || "none"})</span>
          <textarea value={sponsorText} onChange={(e) => setSponsorText(e.target.value)} />
        </label>
        <label>
          <span className="lbl">Payment</span>
          <select value={form.payment ?? "sponsor-then-self"} onChange={(e) => setForm({ ...form, payment: e.target.value as Settings["payment"] })}>
            <option value="sponsor-then-self">Sponsored when possible, otherwise pay myself</option>
            <option value="self-only">Always pay myself</option>
            <option value="sponsor-only">Sponsored only (fail otherwise)</option>
          </select>
        </label>
        <label>
          <span className="lbl">Auto-lock after minutes of inactivity (0 = never)</span>
          <input type="number" min={0} max={1440} value={form.autoLockMinutes ?? 15} onChange={(e) => setForm({ ...form, autoLockMinutes: Number(e.target.value) })} />
        </label>
        <button className="primary" onClick={saveEndpoints}>
          Save
        </button>
      </section>

      <section className="card">
        <h2>Account</h2>
        <p className="muted">
          {vault.status === "empty" ? "No account in this browser." : `Account ${vault.account} · vault ${vault.status} · ${vault.mode === "device" ? "device key only (identity seed not stored here)" : "identity seed stored here"}`}
          {vault.device && ` · device ${vault.device.address} until ${new Date(Number(vault.device.expiresAt)).toLocaleDateString()}`}
        </p>
        <div className="row">
          <button onClick={() => act("Locked.", () => rpc("vault.lock"))} disabled={vault.status !== "unlocked"}>
            Lock now
          </button>
        </div>
        <label style={{ marginTop: 12 }}>
          <span className="lbl">Passphrase (for export / removal)</span>
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" />
        </label>
        <div className="row">
          <button
            disabled={vault.status === "empty" || passphrase.length === 0}
            onClick={() =>
              act("Identity exported below. Store it safely; it is the whole account.", async () => {
                const { identity } = await rpc<{ identity: string }>("vault.export", { passphrase });
                setExported(identity);
              })
            }
          >
            Export identity file
          </button>
          <button
            className="danger"
            disabled={vault.status === "empty" || passphrase.length === 0}
            onClick={() => {
              if (confirm("Remove the account from this browser? Only the identity file can restore it.")) void act("Account removed from this browser.", () => rpc("vault.destroy", { passphrase }));
            }}
          >
            Remove account from this browser
          </button>
        </div>
        {exported && (
          <div style={{ marginTop: 8 }}>
            <textarea readOnly value={exported} />
            <a download={`osp-identity-${vault.account}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(exported)}`}>
              Download identity file
            </a>
          </div>
        )}
      </section>

      <section className="card">
        <h2>About and security model</h2>
        <ul className="muted">
          <li>Keys never enter a web page. The Facebook adapter runs in the isolated world and can only send the composer text and a feed request to the service worker.</li>
          <li>Signing and encryption happen in the service worker. Pages (side panel, this page) and content scripts talk to it through validated messages only.</li>
          <li>By default this browser holds a 30-day device key with publish / react / comment / relationships capabilities, plus the reading key. The identity seed is not kept unless you chose so.</li>
          <li>Every publication needs an explicit confirmation in the side panel showing the audience and the permanence notice.</li>
          <li>Retries reuse the same idempotency key; unknown outcomes are looked up on chain before anything is re-sent.</li>
          <li>No telemetry.</li>
        </ul>
      </section>
    </div>
  );
}
