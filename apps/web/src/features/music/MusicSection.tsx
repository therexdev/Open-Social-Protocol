import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  contentHash,
  fromBase64url,
  musicConfig,
  musicFee,
  toBase64url,
  type MusicConfig,
  type MusicRecord,
} from "@osp/sdk";
import { useServices } from "../../api/services";
import { Button, Card, Empty, Field, Notice, Spinner } from "../../components/ui";
import { useVault, useVaultStore } from "../../vault/context";
import type { EncryptedStore } from "../../vault/encryptedStore";
import type { UnlockLease } from "../../vault/store";
import { MusicTrack } from "./MusicTrack";
import { shareFreeMusic } from "./musicAccessService";
import { readCollection, type Collection } from "../library/libraryService";
import { useSubmitContext } from "../session";
import {
  musicDraftStore,
  musicDuration,
  musicTokens,
  newMusicDraft,
  prepareAudio,
  uploadMusic,
  type MusicDraft,
} from "./musicService";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function MusicSection({ owner }: { owner: string }) {
  const { protocol } = useServices(),
    account = useVault((s) => s.account),
    status = useVault((s) => s.status);
  return (
    <MusicPanel
      key={`${protocol?.chainId}:${protocol?.deployment.contracts.publications.address}:${owner}:${account}:${status}`}
      owner={owner}
    />
  );
}
function MusicPanel({ owner }: { owner: string }) {
  const services = useServices();
  const { protocol, resolved, indexer } = services,
    session = useVault((s) => s.session),
    account = useVault((s) => s.account),
    vault = useVaultStore(),
    submit = useSubmitContext();
  const mine = account === owner,
    currency = resolved.network === "mainnet" ? "KOIN" : "tKOIN";
  const [config, setConfig] = useState<MusicConfig>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [tracks, setTracks] = useState<Array<{ id: string; record: MusicRecord }>>([]),
    [after, setAfter] = useState<string>(),
    [more, setMore] = useState(false);
  const [draft, setDraft] = useState<MusicDraft>(),
    [store, setStore] = useState<EncryptedStore<MusicDraft>>(),
    [paid, setPaid] = useState(false);
  const [source, setSource] = useState<Awaited<ReturnType<typeof prepareAudio>>>(),
    [title, setTitle] = useState(""),
    [artist, setArtist] = useState(""),
    [description, setDescription] = useState(""),
    [audience, setAudience] = useState(0),
    [groupId, setGroupId] = useState(""),
    [unlockPrice, setUnlockPrice] = useState("0"),
    [groups, setGroups] = useState<Collection[]>([]),
    [busy, setBusy] = useState(false),
    [selecting, setSelecting] = useState(false);
  const [received, setReceived] = useState(0),
    [total, setTotal] = useState(0),
    [notice, setNotice] = useState("");
  const run = useRef({ cancelled: false }),
    unlockLease = useRef<UnlockLease | undefined>(undefined),
    alive = useRef(true),
    selection = useRef(0);
  useEffect(
    () => () => {
      alive.current = false;
      run.current.cancelled = true;
      unlockLease.current?.release();
      selection.current++;
    },
    []
  );
  const list = async (cursor?: string) => {
    if (!protocol) return;
    const result = await protocol.reads.publications.list_music({
      owner,
      ...(cursor && { after: fromBase64url(cursor) }),
    });
    const ids = result?.ids ?? [];
    const values = await Promise.all(
      ids.map(async (id) => ({
        id: toBase64url(id),
        record: (await protocol.reads.publications.get_music({ id }))?.value,
      }))
    );
    if (!alive.current) return;
    const visible = await Promise.all(
      values.map(async (x) => {
        if (!x.record || !x.record.audience || x.record.owner === session?.identity.account)
          return x;
        if (!session) return undefined;
        const access = await protocol.reads.publications.get_music_access({
          id: fromBase64url(x.id),
          buyer: session.identity.account,
        });
        return access?.eligible ? x : undefined;
      })
    );
    if (!alive.current) return;
    const valid = visible.filter(
      (x): x is { id: string; record: MusicRecord } =>
        !!x?.record &&
        x.record.owner === owner &&
        x.record.received === x.record.chunk_hashes.length
    );
    setTracks((old) =>
      cursor ? [...old, ...valid.filter((x) => !old.some((y) => x.id === y.id))] : valid
    );
    setAfter(ids.length ? toBase64url(ids[ids.length - 1]!) : undefined);
    setMore(ids.length === 20);
  };
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        if (!protocol) throw new Error("Connect to an Open Social network to view Music.");
        const c = await musicConfig(protocol);
        if (!alive.current) return;
        setConfig(c);
        await list();
        if (session && mine) {
          const saved = await musicDraftStore(session, protocol),
            pending = await saved.load();
          if (!alive.current) return;
          setStore(saved);
          setDraft(pending);
          if (pending) {
            setTitle(pending.title);
            setArtist(pending.artist ?? "");
            setDescription(pending.description ?? "");
            setAudience(pending.audience ?? 0);
            setGroupId(pending.groupId ?? "");
            setUnlockPrice(pending.unlockPrice ?? "0");
            const record = (
              await protocol.reads.publications.get_music({
                id: fromBase64url(pending.id),
              })
            )?.value;
            if (!alive.current) return;
            setPaid(!!record);
            setReceived(record?.received ?? 0);
            setTotal(Math.ceil(pending.size / 16384));
          }
        }
      } catch (e) {
        if (alive.current) setError(message(e));
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!session || !protocol || !mine || !config || config.version < 2) return;
    let cancelled = false;
    void (async () => {
      const found: Collection[] = [];
      let after: string | undefined;
      do {
        const page = await indexer.collections({
          viewer: session.identity.account,
          kind: 2,
          after,
        });
        for (const item of page.items) {
          try {
            const group = await readCollection({ services, session }, item.id);
            if (group.record.kind === 2) found.push(group);
          } catch {
            /* no current access */
          }
        }
        after = page.next;
      } while (after && !cancelled);
      if (!cancelled) setGroups(found);
    })().catch((e) => {
      if (!cancelled) setError(message(e));
    });
    return () => {
      cancelled = true;
    };
  }, [session, protocol, mine, config?.version, indexer]);
  const choose = async (file?: File) => {
    const ticket = ++selection.current;
    setSource(undefined);
    if (!file) return;
    setSelecting(true);
    setError("");
    try {
      const result = await prepareAudio(file);
      if (!alive.current || selection.current !== ticket) return;
      if (
        draft &&
        (toBase64url(contentHash(result.bytes)) !== (draft.sourceDigest ?? draft.digest) ||
          result.bytes.length !== (draft.sourceSize ?? draft.size))
      )
        throw new Error("Select the same audio file to resume your saved upload.");
      setSource(result);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      if (alive.current && selection.current === ticket) setError(message(e));
    } finally {
      if (alive.current && selection.current === ticket) setSelecting(false);
    }
  };
  const start = async () => {
    if (!submit || !source || !config || !store || !session || unlockLease.current) return;
    const task = { cancelled: false };
    run.current = task;
    setBusy(true);
    setError("");
    setNotice("");
    let lease: UnlockLease | undefined;
    try {
      lease = vault.getState().keepUnlocked();
      unlockLease.current = lease;
      const pending =
        draft ??
        newMusicDraft({
          owner,
          payer: submit.signer.getAddress(),
          title,
          artist,
          description,
          audience,
          groupId,
          unlockPrice,
          identity: session.identity,
          client: protocol,
          ...source,
          config,
        });
      await store.save(pending); // Must succeed before any payment, including the first attempt.
      setDraft(pending);
      setTitle(pending.title);
      await uploadMusic(
        submit,
        pending,
        source.bytes,
        () => {
          if (task.cancelled || !alive.current)
            throw new Error(
              "Upload paused. Resume with the same file; payment is recorded on chain."
            );
          if (vault.getState().session !== session)
            throw new Error("Your account is locked. Unlock it to resume this upload.");
        },
        (n, count, payment) => {
          if (!task.cancelled && alive.current) lease?.renew();
          if (alive.current) {
            setReceived(n);
            setTotal(count);
            setPaid(payment);
          }
        }
      );
      await shareFreeMusic(services, submit, session, pending, () => {
        if (task.cancelled || !alive.current || vault.getState().session !== session)
          throw new Error("Sharing paused. Resume this upload to finish delivering access.");
        lease?.renew();
      });
      await store.clear();
      if (!alive.current) return;
      setDraft(undefined);
      setSource(undefined);
      setTitle("");
      setArtist("");
      setDescription("");
      setAudience(0);
      setGroupId("");
      setUnlockPrice("0");
      setPaid(false);
      setTotal(0);
      setNotice("Your track is published on your profile.");
      await list();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      lease?.release();
      if (unlockLease.current === lease) unlockLease.current = undefined;
      if (alive.current) setBusy(false);
    }
  };
  const refreshQuote = async () => {
    if (!protocol || !draft || !store) return;
    setBusy(true);
    setError("");
    try {
      const record = (
        await protocol.reads.publications.get_music({
          id: fromBase64url(draft.id),
        })
      )?.value;
      if (record) {
        setPaid(true);
        setReceived(record.received);
        return;
      }
      const c = await musicConfig(protocol);
      setConfig(c);
      const next = {
        ...draft,
        configRevision: c.revision,
        fee: musicFee(draft.size, c.rate_per_mb),
        recipient: c.recipient,
      };
      await store.save(next);
      setDraft(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (
      !store ||
      !window.confirm(
        "Forget this saved upload? Any payment already made is not refunded. Keep it to resume without paying again."
      )
    )
      return;
    try {
      await store.clear();
      setDraft(undefined);
      setSource(undefined);
      setPaid(false);
      setTitle("");
      setTotal(0);
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  const quoteSize =
    (source?.bytes.length ?? 0) + (audience !== 0 || Number(unlockPrice) > 0 ? 16 : 0);
  const fee =
    draft?.fee ??
    (source && config && quoteSize <= config.max_bytes
      ? musicFee(quoteSize, config.rate_per_mb)
      : undefined);
  return (
    <section className="stack" aria-label="Profile music">
      <Card title="Music">
        <p className="hint">
          Music stored on Koinos. Open a track to listen, unlock access, or join the comments.
        </p>
        {loading ? (
          <Spinner label="Loading music" />
        ) : (
          <>
            {tracks.map((track) => (
              <MusicTrack key={track.id} {...track} />
            ))}
            {!tracks.length && <Empty>No music uploaded yet.</Empty>}
            {more && (
              <Button onClick={() => void list(after).catch((e) => setError(message(e)))}>
                More tracks
              </Button>
            )}
          </>
        )}
      </Card>
      {mine && !session && (
        <Notice>
          <Link to="/me">Unlock your account</Link> to upload music.
        </Notice>
      )}
      {mine && session && config && !loading && (
        <Card title={draft ? "Resume audio upload" : "Upload music"}>
          {!config.enabled && (
            <Notice>
              New music uploads are not enabled on this network yet. Paid uploads can still resume.
            </Notice>
          )}
          <Field label="Track title">
            {(id) => (
              <input
                id={id}
                value={title}
                maxLength={240}
                disabled={busy || !!draft}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your track a name"
              />
            )}
          </Field>
          <Field label="Artist name">
            {(id) => (
              <input
                id={id}
                value={artist}
                maxLength={240}
                disabled={busy || !!draft || config.version < 2}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist or band"
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => (
              <textarea
                id={id}
                value={description}
                maxLength={2000}
                disabled={busy || !!draft || config.version < 2}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="About this track, credits, or lyrics"
                rows={3}
              />
            )}
          </Field>
          <Field label="Who can listen?">
            {(id) => (
              <select
                id={id}
                value={audience}
                disabled={busy || !!draft || config.version < 2}
                onChange={(e) => setAudience(Number(e.target.value))}
              >
                <option value={0}>Public</option>
                <option value={1}>Friends only</option>
                <option value={2}>Group</option>
              </select>
            )}
          </Field>
          {audience === 2 && (
            <Field label="Group">
              {(id) => (
                <select
                  id={id}
                  value={groupId}
                  disabled={busy || !!draft}
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  <option value="">Choose a group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {audience === 2 && !groups.length && (
            <Notice>
              Join or <Link to="/groups">create a group</Link> before choosing group access.
            </Notice>
          )}
          <Field
            label="OSAT unlock price"
            hint="0 is free. Use whole transferable OSAT; free usage credits cannot buy music."
          >
            {(id) => (
              <input
                id={id}
                type="number"
                min="0"
                max="1000000"
                step="1"
                value={unlockPrice}
                disabled={busy || !!draft || config.version < 2}
                onChange={(e) => setUnlockPrice(e.target.value)}
              />
            )}
          </Field>
          {Number(unlockPrice) > 0 && (
            <Notice>
              Keep Open Social open and unlocked to deliver purchases automatically. Buyers can
              refund undelivered access after 24 hours. Friends and group restrictions still apply
              to paid tracks.
            </Notice>
          )}
          <Field
            label={draft ? "Select the same audio file to continue" : "Audio file"}
            hint={`MP3, M4A, Ogg, WAV or WebM · up to ${(
              (config.max_bytes || 10485760) / 1048576
            ).toFixed(1)} MiB`}
          >
            {(id) => (
              <input
                id={id}
                type="file"
                accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,audio/x-wav,audio/webm"
                disabled={busy || selecting}
                onChange={(e) => void choose(e.target.files?.[0])}
              />
            )}
          </Field>
          {selecting && <Spinner label="Reading audio" />}
          {source && quoteSize > config.max_bytes && (
            <Notice kind="error">
              Audio including encryption exceeds the size limit. Choose a slightly smaller file.
            </Notice>
          )}
          {draft && !source && !selecting && (
            <Notice>
              Select the original audio file above to enable Resume upload. Your payment and
              confirmed chunks are saved.
            </Notice>
          )}
          {busy && unlockLease.current && !run.current.cancelled && (
            <Notice>
              Auto-lock is paused while this upload makes progress. Keep this page open and your
              device awake. You can switch browser tabs; closing the page or locking the account
              pauses the upload.
            </Notice>
          )}
          {(source || draft) && (
            <p>
              {musicDuration(draft?.durationMs ?? source!.durationMs)} ·{" "}
              {((draft?.size ?? source!.bytes.length) / 1000000).toFixed(2)} MB
            </p>
          )}
          {fee && (
            <div className="music-price">
              <strong>
                {paid ? "Paid" : "Upload fee"}: {musicTokens(fee)} {currency}
              </strong>
              <p className="hint">
                {paid
                  ? "Resume this upload without paying the fee again."
                  : "One payment reserves this file. Interrupted uploads can resume without another fee."}
              </p>
            </div>
          )}
          <p className="hint">
            Current rate: {Number(config.rate_per_mb) / 100000000} {currency} per MB, rounded up.
            This is a token payment, separate from Mana. Your payment settings determine who
            supplies transaction Mana.
          </p>
          <p className="hint">
            Track titles, artist names, descriptions and audience labels are public on-chain
            metadata. Restricted or paid audio and comments are encrypted. People who receive audio
            can save or share it. Upload fees are not refunded for abandoned uploads; keep the
            original file to resume.
          </p>
          {(draft?.recipient || config.recipient) && (
            <details>
              <summary>Payment recipient</summary>
              <p className="mono address">{draft?.recipient || config.recipient}</p>
            </details>
          )}
          {total > 0 && (
            <div role="status" aria-live="polite">
              <progress value={received} max={total} aria-label="Audio upload progress" />
              <p className="hint">
                {received} / {total} chunks confirmed · {Math.floor((received / total) * 100)}%
              </p>
            </div>
          )}
          <div className="row wrap">
            <Button
              variant="primary"
              busy={busy}
              disabled={
                !source ||
                !title.trim() ||
                (audience === 2 && !groupId) ||
                !/^(0|[1-9][0-9]*)$/.test(unlockPrice) ||
                Number(unlockPrice) > 1000000 ||
                !submit ||
                !store ||
                selecting ||
                (!config.enabled && !paid) ||
                (!draft && !!source && quoteSize > config.max_bytes)
              }
              onClick={() => void start()}
            >
              {draft ? "Resume upload" : `Pay ${fee ? musicTokens(fee) : ""} ${currency} & upload`}
            </Button>
            {busy && (
              <Button
                onClick={() => {
                  run.current.cancelled = true;
                  unlockLease.current?.release();
                  setNotice("Pausing after the current transaction confirms…");
                }}
              >
                Pause
              </Button>
            )}
            {draft && !busy && (
              <>
                <Button onClick={() => void refreshQuote()}>Check payment / refresh quote</Button>
                <Button variant="ghost" onClick={() => void discard()}>
                  Forget saved upload
                </Button>
              </>
            )}
          </div>
        </Card>
      )}
      {notice && <Notice kind="success">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </section>
  );
}
