import { expect, it } from "vitest";
import { Signer } from "@osp/sdk";
import { formatMarkdown } from "./markdownFormat";
import { readMentionText, writeMentionText } from "./mentionText";
import { encodeMention } from "../../util/mentions";

it("formats selected names without losing the tagged account, and leaves a selection ready to edit", () => {
  const account = Signer.fromSeed("formatted-name").getAddress();
  const draft = readMentionText(`Hello ${encodeMention("Alice", account)}!`);
  const next = formatMarkdown(draft, 6, 12, "bold");
  expect(next.value.text).toBe("Hello **@Alice**!");
  expect(writeMentionText(next.value)).toBe(`Hello **${encodeMention("Alice", account)}**!`);
  expect(next.value.text.slice(next.start, next.end)).toBe("@Alice");
});
it("formats selected paragraphs as a list and handles an empty first line", () => {
  const next = formatMarkdown(readMentionText("Intro\nFirst\nSecond\nEnd"), 6, 18, "numbered");
  expect(next.value.text).toBe("Intro\n1. First\n2. Second\nEnd");
  expect(formatMarkdown(readMentionText("\nNext"), 0, 0, "heading").value.text).toBe("## \nNext");
});
