import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useServices } from "../../api/services";
import { Field, Notice, Spinner } from "../../components/ui";
import { useSession } from "../session";
import { readCollection, type Collection } from "../library/libraryService";

/** Only offer groups whose current membership can be verified on chain. */
export function GroupPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled: boolean }) {
  const services = useServices();
  const session = useSession();
  const [groups, setGroups] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setGroups([]);
    setError("");
    const load = async () => {
      if (!session) return;
      const found: Collection[] = [];
      const viewer = session.identity.account;
      let after: string | undefined;
      do {
        const page = await services.indexer.collections({ kind: 2, viewer, after });
        for (const row of page.items) {
          if (!active) return;
          try {
            const group = await readCollection({ services, session }, row.id);
            if (group.record.kind === 2 && !group.record.closed && (group.record.owner === viewer || group.record.members.includes(viewer))) found.push(group);
          } catch { /* An expired membership or missing group key prevents posting. */ }
        }
        after = page.next;
      } while (after && active);
      if (active) setGroups(found);
    };
    void load().catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [services, session]);
  return <div>
    <Field label="Group">{id => <select id={id} value={value} required disabled={disabled || loading} onChange={e => onChange(e.target.value)}>
      <option value="">Choose a group</option>
      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>}</Field>
    {loading && <Spinner label="Loading groups"/>}
    {error && <Notice kind="error">{error}</Notice>}
    {!loading && !groups.length && <p className="hint">Open <Link to="/groups">your groups</Link> to create a group or check your memberships.</p>}
  </div>;
}
