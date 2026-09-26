import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isAddress } from "@osp/sdk";
import type { ProfileSummary } from "../../api/indexer";
import { parseProfileUri } from "../../api/profiles";
import { useServices } from "../../api/services";
import { Avatar, Icon } from "../../components/Icon";
import { Button, Card, Empty, Notice, Spinner } from "../../components/ui";
import { errorMessage, shortAddress } from "../../util/format";

export function PeopleSearch({ initialQuery = "" }: { initialQuery?: string }) {
  const { indexer } = useServices();
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ProfileSummary[]>();
  const [error, setError] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const request = ++generation.current;
    const text = query.trim();
    setError(undefined);
    setResults(undefined);
    if (!text) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (isAddress(text) ? indexer.searchProfiles(text, 20) : indexer.searchPeople(text, 20)).then(items => {
        if (request === generation.current) setResults(items);
      }).catch(e => { if (request === generation.current) setError(errorMessage(e)); })
        .finally(() => { if (request === generation.current) setSearching(false); });
    }, revision ? 0 : 250);
    return () => { window.clearTimeout(timer); generation.current++; };
  }, [indexer, query, revision]);
  return <div className="people-search">
    <form role="search" onSubmit={e => { e.preventDefault(); setRevision(x => x + 1); }}>
      <label className="visually-hidden" htmlFor={inputId}>Search nicknames or addresses</label>
      <div className="search-input"><Icon name="search" /><input id={inputId} type="search" value={query} onChange={e => { setRevision(0); setQuery(e.target.value); }} placeholder="Search a nickname or account address" maxLength={64} autoComplete="off" /><Button type="submit" variant="primary" disabled={searching}>Search</Button></div>
      <p className="hint">Names aren’t unique. Check the account address to find the right person.</p>
    </form>
    <div className="search-results" aria-live="polite" aria-busy={searching}>
      {searching && <Spinner label="Finding people" />}
      {error && <Notice kind="error">{error}</Notice>}
      {results?.length === 0 && <Empty>No people found. Try part of their nickname or their account address.</Empty>}
      {results && results.length > 0 && <ul className="list">{results.map(person => {
        const profile = parseProfileUri(person.profileUri);
        return <li key={person.account}><Link className="person-result" to={`/u/${person.account}`}><Avatar account={person.account} name={profile?.display_name} /><span className="person-copy"><strong>{profile?.display_name || shortAddress(person.account)}</strong><span className="mono muted">{person.account}</span>{profile?.bio && <span className="muted person-bio">{profile.bio}</span>}</span><Icon name="arrow" /></Link></li>;
      })}</ul>}
      {!query.trim() && <div className="discovery-empty"><span className="feature-icon"><Icon name="people" size={26}/></span><h2>Your people are here.</h2><p className="muted">Find a familiar name, make a new connection, or bring a friend along.</p></div>}
      {results?.length === 20 && <p className="hint">Showing the first 20 matches. Keep typing to narrow your search.</p>}
    </div>
  </div>;
}
export function PeoplePage() {
  const [params] = useSearchParams();
  return <div className="page"><div className="page-header"><div><p className="eyebrow">MAKE A CONNECTION</p><h1>Find your people</h1></div><Icon name="people" size={30}/></div><Card><PeopleSearch initialQuery={params.get("q") ?? ""} /></Card></div>;
}
