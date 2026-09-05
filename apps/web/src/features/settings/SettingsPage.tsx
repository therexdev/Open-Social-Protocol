import { useState } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../../api/services";
import { Button, Card, ConfirmDialog, Details, Field, Notice } from "../../components/ui";
import { APP_VERSION, DEPLOYMENT_REGISTRY, DOCS, knownNetworks, presetRpc, ENV } from "../../config";
import { parseList, useSettings, type PaymentPreference } from "../../stores/settings";
import { downloadText } from "../../util/download";
import { errorMessage } from "../../util/format";
import { useVault } from "../../vault/store";
import { Devices } from "./Devices";
import { RecoveryContacts } from "./RecoveryContacts";

function EndpointsSection() {
  const settings = useSettings();
  const { resolved } = useServices();
  const [rpc, setRpc] = useState(settings.rpcUrls.join("\n"));
  const [indexer, setIndexer] = useState(settings.indexerUrl);
  const [sponsors, setSponsors] = useState(settings.sponsorUrls.join("\n"));
  const networks = knownNetworks();
  const save = () => {
    settings.update({ rpcUrls: parseList(rpc), indexerUrl: indexer.trim(), sponsorUrls: parseList(sponsors) });
  };
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Network" hint={resolved.deployed ? `Contracts deployed (chain ${resolved.chainId ?? ""}).` : (resolved.deploymentMessage ?? "")}>
        {(id) => (
          <select id={id} value={settings.network} onChange={(e) => settings.update({ network: e.target.value })}>
            {networks.map((n) => (
              <option key={n} value={n}>
                {n}
                {DEPLOYMENT_REGISTRY.deployments[n] ? "" : " (not deployed)"}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="RPC endpoints (one per line, tried in order)" hint={`Default: ${presetRpc(settings.network).join(", ") || "none"}`}>
        {(id) => <textarea id={id} value={rpc} onChange={(e) => setRpc(e.target.value)} rows={2} spellCheck={false} placeholder={presetRpc(settings.network).join("\n")} />}
      </Field>
      <Field label="Indexer URL" hint={`Default: ${ENV.indexerUrl || resolved.deployment?.indexers?.[0] || "none configured"}`}>
        {(id) => <input id={id} type="url" value={indexer} onChange={(e) => setIndexer(e.target.value)} placeholder="https://indexer.example.org" />}
      </Field>
      <Field label="Sponsors (one per line, tried in order)" hint={`Default: ${(ENV.sponsorUrls.length > 0 ? ENV.sponsorUrls : (resolved.deployment?.sponsors ?? [])).join(", ") || "none"}`}>
        {(id) => <textarea id={id} value={sponsors} onChange={(e) => setSponsors(e.target.value)} rows={2} spellCheck={false} placeholder="https://sponsor.example.org" />}
      </Field>
      <Field label="Who pays for network actions" hint="Sponsors pay the network fee for you within their policy; otherwise your own account pays.">
        {(id) => (
          <select id={id} value={settings.payment} onChange={(e) => settings.update({ payment: e.target.value as PaymentPreference })}>
            <option value="sponsor-then-self">Sponsors first, then my own account</option>
            <option value="sponsor-only">Sponsors only (never pay myself)</option>
            <option value="self-only">Always pay from my own account</option>
          </select>
        )}
      </Field>
      <div className="row">
        <Button type="submit" variant="primary">
          Save endpoints
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            settings.reset();
            setRpc("");
            setIndexer("");
            setSponsors("");
          }}
        >
          Reset to defaults
        </Button>
      </div>
    </form>
  );
}

function IdentitySection() {
  const vault = useVault();
  const settings = useSettings();
  const [error, setError] = useState<string | undefined>();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [exported, setExported] = useState(false);

  const exportIdentity = () => {
    try {
      const json = vault.exportFile();
      downloadText(`open-social-identity-${vault.account?.slice(0, 8) ?? "account"}.json`, json);
      setExported(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const enroll = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await vault.enrollPasskey(passphrase);
      setPassphrase("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p>
        Account <span className="mono">{vault.account}</span>
      </p>
      <p>
        Your identity file contains the secret that controls this account and decrypts your friends-only posts. Store it somewhere safe and private; anyone
        with it can act as you. It is the way to use the account on another device or in another client.
      </p>
      <div className="row">
        <Button variant="primary" onClick={exportIdentity} disabled={vault.status !== "unlocked"}>
          Export identity file
        </Button>
        <Button onClick={() => vault.lock()} disabled={vault.status !== "unlocked"}>
          Lock now
        </Button>
      </div>
      {exported && <Notice kind="success">Saved. Keep the file private.</Notice>}
      <Field label="Auto-lock after (minutes of inactivity, 0 = never)">
        {(id) => (
          <input
            id={id}
            type="number"
            min={0}
            max={720}
            value={settings.autoLockMinutes}
            onChange={(e) => {
              const minutes = Math.max(0, Number(e.target.value) || 0);
              settings.update({ autoLockMinutes: minutes });
              vault.setAutoLockMs(minutes * 60_000);
            }}
          />
        )}
      </Field>
      <Details summary="Passkey unlock">
        {vault.passkeyAvailable ? (
          vault.passkeyEnrolled ? (
            <div className="stack">
              <p>A passkey can unlock this account on this device. Your passphrase still works.</p>
              <Button onClick={() => void vault.removePasskey()}>Remove passkey</Button>
            </div>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void enroll();
              }}
            >
              <p>Unlock with your device's biometrics or PIN instead of typing the passphrase. Requires a passkey with the PRF extension.</p>
              <Field label="Confirm your passphrase">{(id) => <input id={id} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" />}</Field>
              <Button type="submit" busy={busy} disabled={passphrase.length === 0}>
                Set up passkey
              </Button>
            </form>
          )
        ) : (
          <p className="muted">Passkeys with the PRF extension are not available in this browser; the passphrase is used.</p>
        )}
      </Details>
      {error && <Notice kind="error">{error}</Notice>}
      <Details summary="Remove this account from this device">
        <p>Removes the encrypted vault and cached keys from this browser. Without an exported identity file the account cannot be recovered.</p>
        <Button variant="danger" onClick={() => setConfirmForget(true)}>
          Remove from this device
        </Button>
        <ConfirmDialog open={confirmForget} title="Remove the account from this device?" confirmLabel="Remove" danger onCancel={() => setConfirmForget(false)} onConfirm={() => void vault.destroy().then(() => setConfirmForget(false))}>
          <p>Make sure you exported the identity file first. This cannot be undone.</p>
        </ConfirmDialog>
      </Details>
    </div>
  );
}

function AboutSection() {
  const { resolved } = useServices();
  return (
    <div className="stack">
      <p>
        Open Social is a protocol, not a service. This web client ({APP_VERSION}) is one of several interchangeable frontends; nothing here is required to use
        your account.
      </p>
      <ul>
        <li>
          <strong>Network:</strong> {resolved.network}. Your posts and relationships live on the Koinos blockchain; encryption happens on this device.
        </li>
        <li>
          <strong>Indexer</strong> ({resolved.indexerUrl || "none"}): a read cache rebuilt from public chain history. Anyone can run one (`apps/indexer`) and you can
          point this client at it above.
        </li>
        <li>
          <strong>Sponsors</strong> ({resolved.sponsorUrls.join(", ") || "none"}): pay network fees on your behalf within a published policy. If they refuse or
          disappear you can pay yourself or pick another (`apps/sponsor`).
        </li>
        <li>
          <strong>Client:</strong> replace this app with any conforming client, for example the browser extension, by importing your identity file.
        </li>
        <li>
          <strong>RPC:</strong> any Koinos node for the selected network works.
        </li>
      </ul>
      <p>
        Source and documentation: <a href={DOCS.repository}>{DOCS.repository}</a>. No analytics or telemetry are collected.
      </p>
    </div>
  );
}

export function SettingsPage() {
  const account = useVault((s) => s.account);
  const status = useVault((s) => s.status);
  const { resolved } = useServices();
  return (
    <div className="page">
      <h1>Settings</h1>
      <Card title="Network and endpoints">
        <EndpointsSection />
      </Card>
      <Card title="Your account">
        {status === "unlocked" ? (
          <IdentitySection />
        ) : status === "locked" ? (
          <p>
            Unlock your account to export it or change its protection. <Link to="/">Go to unlock</Link>
          </p>
        ) : (
          <p>
            No account on this device. <Link to="/welcome">Create or import one</Link>.
          </p>
        )}
      </Card>
      {account && status === "unlocked" && resolved.deployed && (
        <>
          <Card title="Recovery contacts">
            <RecoveryContacts account={account} />
          </Card>
          <Card title="Devices">
            <Devices account={account} />
          </Card>
        </>
      )}
      {account && status === "unlocked" && !resolved.deployed && (
        <Card title="Recovery contacts and devices">
          <p className="muted">Available once the protocol contracts are deployed on {resolved.network}.</p>
        </Card>
      )}
      <Card title="About and decentralization">
        <AboutSection />
      </Card>
    </div>
  );
}
