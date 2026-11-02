import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Signer } from "@osp/sdk";
import { MentionTextarea } from "./MentionTextarea";
import { buildProfileDocument } from "../../api/profiles";
import { encodeMention } from "../../util/mentions";

const mocks = vi.hoisted(() => ({ search: vi.fn(), friends: [] as string[], blocked: [] as string[], blockedBy: [] as string[], names: {} as Record<string, string> }));
vi.mock("../../api/services", () => {
  const indexer = { configured: true, searchPeople: mocks.search };
  return { useServices: () => ({ indexer }) };
});
vi.mock("../messages/useMessagePeople", () => ({ useMessagePeople: () => ({
  friends: mocks.friends, blocked: mocks.blocked, graph: { blockedBy: mocks.blockedBy },
  loading: false, name: (account: string) => mocks.names[account] || account,
}) }));

const me = Signer.fromSeed("picker-self").getAddress(), friend = Signer.fromSeed("picker-friend").getAddress();
const stranger = Signer.fromSeed("picker-stranger").getAddress(), blocked = Signer.fromSeed("picker-blocked").getAddress();
const blockedBy = Signer.fromSeed("picker-blocked-by").getAddress();
const profile = (account: string, name: string) => ({ account, profileUri: buildProfileDocument({ display_name: name }).uri });
let root: Root, container: HTMLDivElement, textarea: HTMLTextAreaElement;
const save = vi.fn(), submit = vi.fn();

beforeEach(() => {
  vi.useFakeTimers(); mocks.search.mockReset().mockResolvedValue([]); save.mockClear(); submit.mockClear();
  mocks.friends = [friend]; mocks.names = { [friend]: "Zoë Friend" }; mocks.blocked = [blocked]; mocks.blockedBy = [blockedBy];
});
afterEach(async () => {
  await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers();
});
async function mount(initial = "") {
  function Harness() {
    const [value, setValue] = useState(initial);
    return <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <label htmlFor="post">Post text</label>
      <MentionTextarea id="post" account={me} value={value} onValueChange={next => { save(next); setValue(next); }}/>
      <button type="submit">Publish</button>
    </form>;
  }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness/>));
  textarea = container.querySelector("textarea")!;
  await act(async () => textarea.focus());
}
async function type(text: string, caret = text.length) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(key: string, extra = {}) {
  await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })));
}
const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];

it("opens friends on @, matches accents, puts friends first and excludes self and blocked accounts", async () => {
  mocks.search.mockResolvedValue([profile(stranger, "Zoe Adams"), profile(friend, "Zoë Friend"), profile(me, "Zoe Me"), profile(blocked, "Zoe Blocked"), profile(blockedBy, "Zoe Blocked by")]);
  await mount(); await type("Hello @");
  expect(options()).toHaveLength(1); expect(options()[0]?.textContent).toContain("Zoë Friend");
  expect(mocks.search).not.toHaveBeenCalled();
  await type("Hello @zoe");
  expect(options()[0]?.textContent).toContain("Zoë Friend");
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(options()).toHaveLength(2);
  expect(options()[0]?.textContent).toContain(friend); expect(options()[1]?.textContent).toContain(stranger);
  await type("Hello @nobody");
  expect(options()).toHaveLength(0);
});

it("selects duplicate names by their account, preserves surrounding text and never submits on selection", async () => {
  mocks.names[friend] = "Alex Kim";
  mocks.search.mockResolvedValue([profile(stranger, "Alex Kim"), profile(friend, "Alex Kim")]);
  await mount(); await type("Hello @Al, welcome", 9);
  await act(async () => vi.advanceTimersByTimeAsync(250));
  for (const k of ["ArrowDown", "ArrowDown", "Enter"]) await key(k);
  expect(textarea.value).toBe("Hello @Alex Kim, welcome");
  expect(textarea.selectionStart).toBe("Hello @Alex Kim".length);
  expect(save).toHaveBeenLastCalledWith(`Hello ${encodeMention("Alex Kim", stranger)}, welcome`);
  expect(submit).not.toHaveBeenCalled(); expect(options()).toHaveLength(0);
});

it("ignores stale searches and failures leave matching friends selectable", async () => {
  let finish!: (people: unknown[]) => void;
  mocks.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValue(new Error("Offline"));
  await mount(); await type("@Old"); await act(async () => vi.advanceTimersByTimeAsync(250));
  await type("@zoe"); await act(async () => vi.advanceTimersByTimeAsync(250));
  await act(async () => finish([profile(stranger, "Old Name")]));
  expect(options()).toHaveLength(1); expect(options()[0]?.textContent).toContain(friend);
  expect(container.textContent).toContain("People search is unavailable");
  await act(async () => options()[0]!.click());
  expect(textarea.value).toBe("@Zoë Friend "); expect(document.activeElement).toBe(textarea);
  expect(save).toHaveBeenLastCalledWith(`${encodeMention("Zoë Friend", friend)} `);
});

it("dismisses with Escape, Tab and outside focus, and does not select during IME composition", async () => {
  await mount(); await type("@"); await key("ArrowDown");
  await key("Enter", { isComposing: true }); expect(textarea.value).toBe("@");
  await key("Escape"); expect(options()).toHaveLength(0);
  await type("@z"); expect(options()).toHaveLength(1);
  await key("Tab"); expect(options()).toHaveLength(0);
  await type("@zo"); expect(options()).toHaveLength(1);
  await act(async () => container.querySelector<HTMLButtonElement>('[type="submit"]')!.focus());
  expect(options()).toHaveLength(0); expect(submit).not.toHaveBeenCalled();
});

it("keeps linked names when resuming a draft and drops the target if that name is edited", async () => {
  await mount(`Hello ${encodeMention("Zoë Friend", friend)}!`);
  expect(textarea.value).toBe("Hello @Zoë Friend!");
  await type("Hello @Zoë Friend! More text");
  expect(save).toHaveBeenLastCalledWith(`Hello ${encodeMention("Zoë Friend", friend)}! More text`);
  await type("Hello @Zoe Friend! More text");
  expect(save).toHaveBeenLastCalledWith("Hello @Zoe Friend! More text");
});
