import { GroupMusic } from "../music/GroupMusic";
import { PendingPosts } from "../composer/PendingPosts";
import { usePublishing } from "../composer/PublishingProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { AUDIENCE, newEpochKey, toBase64url } from "@osp/sdk";
import { useServices } from "../../api/services";
import type { PostView } from "../../api/indexer";
import {
  Button,
  Card,
  Empty,
  Field,
  Notice,
  Spinner,
  Tabs,
} from "../../components/ui";
import { MediaPhoto } from "../../components/MediaPhoto";
import { useVault, useVaultStore } from "../../vault/context";
import { useSubmitContext } from "../session";
import { ComposerForm } from "../composer/ComposerForm";
import type { MediaAttachment } from "../composer/publish";
import { usePagedPosts } from "../feed/FeedPage";
import { usePostContent } from "../feed/usePostContent";
import { PostCard } from "../feed/PostCard";
import { AccountPicker } from "./AccountPicker";
import {
  canReadCollection,
  attachmentFromContent,
  putAlbumPhoto,
  readAlbumPhoto,
  readCollection,
  removeAlbumPhoto,
  saveCollection,
  type Collection,
  type LibraryContext,
} from "./libraryService";

function useLibrary(): LibraryContext {
  const services = useServices(),
    session = useVault((s) => s.session),
    submit = useSubmitContext(),
    vault = useVaultStore();
  return useMemo(
    () => ({
      services,
      session,
      submit,
      assertActive: () => {
        if (vault.getState().session !== session)
          throw new Error("Account locked or changed. Unlock to continue.");
      },
    }),
    [services, session, submit, vault]
  );
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function CollectionEditor({
  kind,
  previous,
  onSaved,
  onCancel,
}: {
  kind: number;
  previous?: Collection;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const ctx = useLibrary(),
    [id] = useState(() => previous?.id ?? toBase64url(newEpochKey()));
  const [name, setName] = useState(previous?.name ?? ""),
    [members, setMembers] = useState(previous?.record.members ?? []);
  const [audience, setAudience] = useState(
      previous?.record.audience ?? AUDIENCE.CUSTOM
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await saveCollection(ctx, {
        id,
        name,
        kind,
        audience,
        members: audience === AUDIENCE.EVERYONE ? [] : members,
        previous,
      });
      onSaved(id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={`${previous ? "Manage" : "Create"} ${
        kind === 2 ? "group" : "album"
      }`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              maxLength={120}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          )}
        </Field>
        {kind === 1 && (
          <Field label="Who can see this album">
            {(id) => (
              <select
                id={id}
                value={audience}
                onChange={(e) => setAudience(Number(e.target.value))}
                disabled={busy || !!previous}
              >
                <option value={AUDIENCE.CUSTOM}>
                  Private · selected people
                </option>
                <option value={AUDIENCE.EVERYONE}>Public</option>
              </select>
            )}
          </Field>
        )}
        {audience === AUDIENCE.CUSTOM && (
          <AccountPicker
            value={members}
            onChange={setMembers}
            disabled={busy}
          />
        )}
        <p className="hint">
          {kind === 2
            ? "Members can post in this group. New members receive future group posts."
            : "You can add and remove photos without uploading them again. Added members receive the existing album too."}{" "}
          Removing someone stops future sharing and removes the collection from
          their current view. Earlier content and keys may remain in their
          possession.
        </p>
        <p className="hint">
          Names and photo descriptions are encrypted for private collections.
          Account membership is public routing information. Saving uses 1 usage
          unit.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="row">
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!ctx.submit}
          >
            Save {kind === 2 ? "group" : "album"}
          </Button>
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
export function CollectionList({
  kind,
  owner,
  choose,
}: {
  kind: number;
  owner?: string;
  choose?: (collection: Collection) => void;
}) {
  const navigate = useNavigate();
  const ctx = useLibrary(),
    viewer = ctx.session?.identity.account;
  const [items, setItems] = useState<Collection[]>([]),
    [next, setNext] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false);
  const load = useCallback(
    async (after?: string) => {
      setBusy(true);
      setError("");
      try {
        const page = await ctx.services.indexer.collections({
          kind,
          owner,
          viewer,
          after,
        });
        const results = await Promise.allSettled(
          page.items.map((item) => readCollection(ctx, item.id))
        );
        const opened = results.flatMap((r) =>
          r.status === "fulfilled" ? [r.value] : []
        );
        setItems((old) => (after ? [...old, ...opened] : opened));
        setNext(page.next);
        if (results.some((r) => r.status === "rejected"))
          setError(
            "Some collections are still confirming or their reading keys are unavailable. Retry to check again."
          );
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [ctx, kind, owner, viewer]
  );
  useEffect(() => {
    setItems([]);
    void load();
  }, [load]);
  return (
    <div className="stack">
      {(!owner || owner === viewer) && !choose && (
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          disabled={!ctx.submit}
        >
          Create {kind === 2 ? "group" : "album"}
        </Button>
      )}
      {creating && (
        <CollectionEditor
          kind={kind}
          onCancel={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            navigate(`/collections/${id}`);
          }}
        />
      )}
      {error && (
        <Notice kind="error">
          {error} <Button onClick={() => void load()}>Retry</Button>
        </Notice>
      )}
      {!busy && !items.length && !error && (
        <Empty>
          {kind === 2
            ? "No groups yet. Groups shared with you appear here."
            : "No albums yet."}
        </Empty>
      )}
      <div className="collection-grid">
        {items
          .filter((item) => canReadCollection(item.record, viewer))
          .map((item) => (
            <Card key={item.id} title={item.name}>
              <p className="hint">
                {item.record.audience === AUDIENCE.EVERYONE
                  ? "Public"
                  : `${item.record.members.length + 1} people · private`}
              </p>
              {choose ? (
                <Button onClick={() => choose(item)}>Add to this album</Button>
              ) : (
                <Link className="btn" to={`/collections/${item.id}`}>
                  Open {kind === 2 ? "group" : "album"}
                </Link>
              )}
            </Card>
          ))}
      </div>
      {busy && <Spinner />}
      {next && (
        <Button disabled={busy} onClick={() => void load(next)}>
          Load more
        </Button>
      )}
    </div>
  );
}
function PhotoTile({
  media,
  owner,
  select,
}: {
  media: MediaAttachment;
  owner: string;
  select?: (media: MediaAttachment) => void;
}) {
  const ctx = useLibrary(),
    mine = ctx.session?.identity.account === owner;
  const [adding, setAdding] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const add = async (collection: Collection) => {
    setBusy(true);
    setNotice("");
    try {
      await putAlbumPhoto(ctx, collection, media);
      setAdding(false);
      setNotice("Added to album.");
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  };
  const archived =
    media.url.startsWith("osp-photo://") || media.url.startsWith("ipfs://");
  return (
    <div className="gallery-photo">
      {archived ? (
        <MediaPhoto
          location={media.url}
          hash={toBase64url(media.contentHash)}
          mime={media.mime}
          alt={media.altText}
          encryption={media.encryption}
        />
      ) : (
        <a href={media.url} target="_blank" rel="noreferrer">
          Open externally hosted photo
        </a>
      )}
      {media.altText && <p>{media.altText}</p>}
      {select ? (
        <Button disabled={busy} onClick={() => select(media)}>
          Choose photo
        </Button>
      ) : (
        mine && (
          <Button disabled={busy} onClick={() => setAdding((v) => !v)}>
            Add to album
          </Button>
        )
      )}
      {adding && (
        <div className="gallery-album-picker">
          <CollectionList
            kind={1}
            owner={owner}
            choose={(collection) => void add(collection)}
          />
          <Button onClick={() => setAdding(false)}>Close albums</Button>
          <p className="hint">
            Adding an existing photo costs 1 usage unit for the album entry;
            storage is not charged again. Sharing the album also shares this
            copy.
          </p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
function PostPhotos({
  post,
  select,
}: {
  post: PostView;
  select?: (media: MediaAttachment) => void;
}) {
  const opened = usePostContent(post);
  if (!opened || !("content" in opened)) return null;
  return (
    <>
      {opened.content.media.map((m, i) =>
        m.mime.startsWith("image/") ? (
          <div key={`${post.postId}:${i}`}>
            <PhotoTile
              media={attachmentFromContent(opened.content, i)}
              owner={post.author}
              select={select}
            />
            {!select && (
              <Link className="gallery-source" to={`/post/${post.postId}`}>
                Open photo post · manage sharing
              </Link>
            )}
          </div>
        ) : null
      )}
    </>
  );
}
export function PhotoGallery({
  owner,
  select,
}: {
  owner: string;
  select?: (media: MediaAttachment) => void;
}) {
  const publishing = usePublishing();
  const { indexer } = useServices(),
    viewer = useVault((s) => s.session?.identity.account),
    [tab, setTab] = useState<"all" | "albums">("all"),
    [adding, setAdding] = useState(false);
  const posts = usePagedPosts(
    (cursor) =>
      indexer.accountPosts(owner, {
        viewer,
        limit: 30,
        ...(cursor && { cursor }),
      }),
    [indexer, owner, viewer]
  );
  return (
    <div className="stack">
      {!select && (
        <Tabs
          value={tab}
          onChange={setTab}
          label="Photo views"
          options={[
            { value: "all", label: "All photos" },
            { value: "albums", label: "Albums" },
          ]}
        />
      )}
      {tab === "albums" ? (
        <CollectionList kind={1} owner={owner} />
      ) : (
        <>
          {owner === viewer && !select && (
            <Button variant="primary" onClick={() => setAdding((v) => !v)}>
              {adding ? "Close upload" : "Add photos"}
            </Button>
          )}
          {adding && (
            <Card title="Add to your photos">
              <ComposerForm
                defaultAudience={AUDIENCE.CUSTOM}
                galleryOnly
                onSubmitted={() => {
                  setAdding(false);
                  void posts.refresh();
                }}
                onCancel={() => setAdding(false)}
              />
            </Card>
          )}
          <p className="hint">
            Photos from posts and photos saved directly to this profile appear
            here when you have access.
          </p>
          {posts.error && <Notice kind="error">{posts.error}</Notice>}
          {owner === viewer && (
            <PendingPosts
              posts={publishing.posts.filter((d) => d.galleryOnly)}
              indexed={posts.items}
            />
          )}
          <div className="photo-gallery">
            {posts.items.map((post) => (
              <PostPhotos
                key={`${post.postId}:${post.contentHash}`}
                post={post}
                select={select}
              />
            ))}
          </div>
          {posts.loading && <Spinner />}
          {posts.hasMore && (
            <Button disabled={posts.loading} onClick={() => void posts.more()}>
              Load more photos
            </Button>
          )}
          {!posts.loading && !posts.items.length && (
            <Empty>No photos yet.</Empty>
          )}
        </>
      )}
    </div>
  );
}
export function GroupsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Your groups</h1>
      </div>
      <p className="muted">
        Private spaces shared with you, including groups you created.
      </p>
      <CollectionList kind={2} />
    </div>
  );
}
export function CollectionPage() {
  const { id = "" } = useParams(),
    ctx = useLibrary();
  const [collection, setCollection] = useState<Collection>(),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [adding, setAdding] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void readCollection(ctx, id)
      .then((v) => {
        if (active)
          setCollection((old) =>
            old?.id === v.id && old.record.revision === v.record.revision
              ? old
              : v
          );
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [id, ctx, revision]);
  // Membership revocations are reflected while the view remains open too.
  useEffect(() => {
    const timer = setInterval(() => setRevision((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [id]);
  if (error)
    return (
      <div className="page">
        <Notice kind="error">{error}</Notice>
        <Button onClick={() => setRevision((n) => n + 1)}>Retry</Button>
      </div>
    );
  if (!collection || collection.id !== id)
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  if (!canReadCollection(collection.record, ctx.session?.identity.account))
    return (
      <div className="page">
        <Notice>This collection is no longer shared with your account.</Notice>
      </div>
    );
  const mine = collection.record.owner === ctx.session?.identity.account;
  return (
    <div className="page stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            {collection.record.kind === 2 ? "PRIVATE GROUP" : "PHOTO ALBUM"}
          </p>
          <h1>{collection.name}</h1>
        </div>
        {mine && (
          <Button onClick={() => setEditing((v) => !v)}>Manage sharing</Button>
        )}
      </div>
      {editing && (
        <CollectionEditor
          kind={collection.record.kind}
          previous={collection}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setRevision((n) => n + 1);
          }}
        />
      )}
      {collection.record.kind === 2 && <GroupMusic key={`${collection.id}:${collection.record.revision}`} groupId={collection.id} />}
      {collection.record.kind === 2 ? (
        <GroupFeed collection={collection} />
      ) : (
        <>
          {mine && (
            <Button onClick={() => setAdding((v) => !v)}>
              {adding ? "Close photo picker" : "Add from my photos"}
            </Button>
          )}
          {adding && (
            <Card title="Choose a photo">
              <PhotoGallery
                owner={collection.record.owner}
                select={(media) => {
                  void putAlbumPhoto(ctx, collection, media)
                    .then(() => {
                      setAdding(false);
                      setRevision((n) => n + 1);
                    })
                    .catch((e) => setError(message(e)));
                }}
              />
            </Card>
          )}
          <AlbumPhotos collection={collection} refresh={revision} />
        </>
      )}
    </div>
  );
}
function GroupFeed({ collection }: { collection: Collection }) {
  const publishing = usePublishing();
  const { indexer } = useServices(),
    viewer = useVault((s) => s.session?.identity.account);
  const posts = usePagedPosts(
    (cursor) =>
      indexer.collectionPosts(collection.id, {
        viewer,
        ...(cursor && { cursor }),
      }),
    [indexer, collection.id, viewer]
  );
  return (
    <>
      <PendingPosts
        posts={publishing.posts.filter((d) => d.collectionId === collection.id)}
        indexed={posts.items}
      />
      <Card title="Post in this group">
        <ComposerForm
          collectionId={collection.id}
          defaultAudience={AUDIENCE.CUSTOM}
          onSubmitted={() => void posts.refresh()}
        />
      </Card>
      {posts.error && <Notice kind="error">{posts.error}</Notice>}
      {posts.items.map((p) => (
        <PostCard key={`${p.postId}:${p.contentHash}`} post={p} />
      ))}
      {posts.loading && <Spinner />}
      {posts.hasMore && (
        <Button onClick={() => void posts.more()}>Load more posts</Button>
      )}
    </>
  );
}
function AlbumPhotos({
  collection,
  refresh,
}: {
  collection: Collection;
  refresh: number;
}) {
  const ctx = useLibrary(),
    [items, setItems] = useState<Awaited<ReturnType<typeof readAlbumPhoto>>[]>(
      []
    ),
    [next, setNext] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (after?: string) => {
      setBusy(true);
      setError("");
      try {
        const page = await ctx.services.indexer.albumItems(
          collection.id,
          after
        );
        const results = await Promise.allSettled(
          page.items.map((item) => readAlbumPhoto(ctx, collection, item.id))
        );
        setItems((old) =>
          after
            ? [
                ...old,
                ...results.flatMap((r) =>
                  r.status === "fulfilled" ? [r.value] : []
                ),
              ]
            : results.flatMap((r) =>
                r.status === "fulfilled" ? [r.value] : []
              )
        );
        setNext(page.next);
        if (results.some((r) => r.status === "rejected"))
          setError(
            "Some photos are still confirming or their reading keys are unavailable."
          );
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [ctx, collection.id, collection.record.revision, refresh]
  );
  useEffect(() => {
    void load();
  }, [load]);
  const mine = ctx.session?.identity.account === collection.record.owner;
  return (
    <>
      {error && (
        <Notice kind="error">
          {error}
          <Button onClick={() => void load()}>Retry</Button>
        </Notice>
      )}
      <div className="photo-gallery">
        {items.map((item) => (
          <div key={item.id}>
            {item.content.media.map((_, index) => (
              <PhotoTile
                key={index}
                media={attachmentFromContent(item.content, index)}
                owner={collection.record.owner}
              />
            ))}
            {mine && (
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void removeAlbumPhoto(ctx, collection, item.id, item.revision)
                    .then(() => load())
                    .catch((e) => {
                      setError(message(e));
                      setBusy(false);
                    });
                }}
              >
                Remove from album
              </Button>
            )}
          </div>
        ))}
      </div>
      {busy && <Spinner />}
      {next && (
        <Button onClick={() => void load(next)}>Load more photos</Button>
      )}
      {!busy && !items.length && <Empty>This album has no photos yet.</Empty>}
    </>
  );
}
