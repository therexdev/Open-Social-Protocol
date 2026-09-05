/** Devices authorized for the account (indexer list, verified against the chain) with revocation. */
import { useCallback, useEffect, useState } from "react";
import { CAPABILITY } from "@osp/sdk";
import type { DeviceView } from "../../api/indexer";
import { useServices } from "../../api/services";
import { Button, Empty, Notice } from "../../components/ui";
import { submitAction } from "../../tx/submit";
import { errorMessage, formatDateTime } from "../../util/format";
import { useCanAct, useSubmitContext } from "../session";

function capabilities(bits: number): string {
  const names: string[] = [];
  if (bits & CAPABILITY.PUBLISH) names.push("post");
  if (bits & CAPABILITY.REACT) names.push("react");
  if (bits & CAPABILITY.COMMENT) names.push("comment");
  if (bits & CAPABILITY.RELATIONSHIPS) names.push("friends");
  if (bits & CAPABILITY.COMMUNITY) names.push("communities");
  if (bits & CAPABILITY.PROFILE) names.push("profile");
  return names.join(", ") || "none";
}

export function Devices({ account }: { account: string }) {
  const { indexer, protocol } = useServices();
  const can = useCanAct();
  const ctx = useSubmitContext();
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [deviceEpoch, setDeviceEpoch] = useState<number | undefined>();

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      const profile = indexer.configured ? await indexer.profile(account) : undefined;
      let list = profile?.devices ?? [];
      let epoch = profile?.deviceEpoch;
      if (protocol) {
        try {
          const identity = (await protocol.reads.identity.get_identity({ account }))?.value;
          if (identity) epoch = identity.device_epoch;
          // The chain is authoritative for each device's current state.
          list = await Promise.all(
            list.map(async (d) => {
              const record = (await protocol.reads.identity.get_device({ account, device: d.device }))?.value;
              return record ? { ...d, revoked: record.revoked, expiresAt: record.expires_at, capabilities: record.capabilities, deviceEpoch: record.device_epoch, label: record.label } : d;
            }),
          );
        } catch (e) {
          setError(`Could not verify devices against the network: ${errorMessage(e)}`);
        }
      }
      setDevices(list);
      setDeviceEpoch(epoch);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [account, indexer, protocol]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (device: string) => {
    if (!ctx) return;
    setBusy(device);
    try {
      const op = await ctx.client.ops.identity.revoke_device({ account, device });
      await submitAction(ctx, [op], { label: "Revoking the device", success: "Device revoked" });
      await refresh();
    } catch {
      // toast
    } finally {
      setBusy(undefined);
    }
  };

  const now = Date.now();
  return (
    <div className="stack">
      <p>
        This web client acts with your account key itself. Other clients (for example the browser extension) can be given limited device keys; they are listed
        here and can be revoked at any time.
      </p>
      {error && <Notice kind="warning">{error}</Notice>}
      {devices.length === 0 ? (
        <Empty>No devices are authorized for this account.</Empty>
      ) : (
        <ul className="list">
          {devices.map((d) => {
            const expired = Number(d.expiresAt) <= now;
            const stale = deviceEpoch !== undefined && d.deviceEpoch !== deviceEpoch;
            const active = !d.revoked && !expired && !stale;
            return (
              <li key={d.device} className="list-item">
                <div>
                  <strong>{d.label || "Unnamed device"}</strong> <span className="mono muted">{d.device}</span>
                  <p className="muted">
                    {active ? "Active" : d.revoked ? "Revoked" : expired ? "Expired" : "Void (account recovered)"} · can {capabilities(d.capabilities)} · until {formatDateTime(d.expiresAt)}
                  </p>
                </div>
                {active && (
                  <Button variant="danger" onClick={() => void revoke(d.device)} busy={busy === d.device} disabled={!can.ok} title={can.ok ? undefined : can.reason}>
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
