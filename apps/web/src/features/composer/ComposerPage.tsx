import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AUDIENCE } from "@osp/sdk";
import { Button, Card, Empty, Notice } from "../../components/ui";
import { formatDateTime } from "../../util/format";
import type { DraftRecord } from "../../vault/store";
import { useSession } from "../session";
import { ComposerForm } from "./ComposerForm";
import { listDrafts, removeDraft, subscribeDrafts } from "./drafts";
import { usePublish } from "./usePublish";
import { errorMessage } from "../../util/format";

export function ComposerPage() {
  const session = useSession();
  const navigate = useNavigate();
  const { start } = usePublish();
  const [params, setParams] = useSearchParams();
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [resume, setResume] = useState<DraftRecord | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (!session) return;
    const saved = await listDrafts(session);
    setDrafts(saved.filter(d => d.state === "failed" || d.state === "draft" || (!d.scope && d.state !== "published")));
    const selected = saved.find(d => d.id === params.get("draft") && (d.state === "failed" || d.state === "draft"));
    if (params.has("draft")) setResume(current => current?.id === selected?.id ? current : selected);
  }, [session, params]);

  useEffect(() => {
    void reload();
    return subscribeDrafts(() => { void reload(); });
  }, [reload]);

  const retry = async (draft: DraftRecord) => {
    setBusy(draft.id);
    setError(undefined);
    try {
      await start({ draft });
      await reload();
      navigate(draft.audience === AUDIENCE.FRIENDS ? "/?feed=friends" : "/");
    } catch (e) {
      setError(errorMessage(e));
      await reload();
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page">
      <h1>New post</h1>
      <Card>
        <ComposerForm
          key={resume?.id ?? "new"}
          draft={resume}
          defaultAudience={AUDIENCE.EVERYONE}
          onSubmitted={(draft) => {
            void reload();
            navigate(draft.audience === AUDIENCE.FRIENDS ? "/?feed=friends" : "/");
          }}
          onCancel={resume ? () => { setResume(undefined); setParams({}); } : undefined}
        />
      </Card>
      <Card title="Unsent drafts">
        {error && <Notice kind="error">{error}</Notice>}
        {drafts.length === 0 ? (
          <Empty>Drafts that could not be sent are kept here, encrypted on this device, so a retry never creates a duplicate post.</Empty>
        ) : (
          <ul className="list">
            {drafts.map((draft) => (
              <li key={draft.id} className="list-item">
                <div>
                  <p className="preview-line">{draft.text}</p>
                  <p className="muted">
                    {draft.state === "unknown"
                      ? "Outcome unknown: the network did not answer. Checking the saved attempt prevents duplicate posts."
                      : draft.state === "submitting"
                        ? "Interrupted while sending. Checking the saved attempt prevents duplicate posts."
                        : draft.state === "failed"
                          ? `Failed: ${draft.lastError ?? "unknown error"}`
                          : "Draft"}{" "}
                    · {formatDateTime(draft.updatedAt)}
                  </p>
                </div>
                <div className="row">
                  <Button variant="primary" onClick={() => void retry(draft)} busy={busy === draft.id}>
                    Retry
                  </Button>
                  <Button variant="ghost" onClick={() => setResume(draft)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (session) await removeDraft(session, draft.id);
                      await reload();
                    }}
                  >
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
