import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AUDIENCE } from "@osp/sdk";
import { Button, Card, Empty, Notice } from "../../components/ui";
import { formatDateTime } from "../../util/format";
import type { DraftRecord } from "../../vault/store";
import { useSession } from "../session";
import { ComposerForm } from "./ComposerForm";
import { listDrafts, removeDraft } from "./drafts";
import { usePublish } from "./usePublish";
import { errorMessage } from "../../util/format";

export function ComposerPage() {
  const session = useSession();
  const navigate = useNavigate();
  const { publish } = usePublish();
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [resume, setResume] = useState<DraftRecord | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (!session) return;
    setDrafts(await listDrafts(session));
  }, [session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const retry = async (draft: DraftRecord) => {
    setBusy(draft.id);
    setError(undefined);
    try {
      const outcome = await publish({ draft });
      await reload();
      navigate(`/post/${outcome.postId}`);
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
          onPublished={(outcome) => {
            void reload();
            navigate(`/post/${outcome.postId}`);
          }}
          onCancel={resume ? () => setResume(undefined) : undefined}
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
                    {draft.state === "unknown" ? "Outcome unknown: the network did not answer. Retry checks whether it was published before sending again." : draft.state === "failed" ? `Failed: ${draft.lastError ?? "unknown error"}` : "Draft"} · {formatDateTime(draft.updatedAt)}
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
