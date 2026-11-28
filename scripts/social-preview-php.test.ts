/** Exercise the real PHP handler without JavaScript, using a local fixture API. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { JSDOM } from "jsdom";

test("raw PHP HTTP responses contain safe public cards, media thumbnails and the working SPA shell", async () => {
  const php = process.env.PHP_BIN || "php";
  const phpArgs = process.env.PHP_TEST_CURL_EXTENSION ? ["-n", "-d", `extension=${process.env.PHP_TEST_CURL_EXTENSION}`] : ["-n"];
  // CI has PHP; local contributors must install it to run this integration test.
  await promisify(execFile)(php, [...phpArgs, "-v"]);
  const folder = await mkdtemp(join(tmpdir(), "osp-preview-"));
  const ids = [1, 2, 3, 4, 5].map(n => Buffer.alloc(32, n).toString("base64url") + "=");
  const calls: string[] = [];
  const version = ids[0];
  const api = createServer((request, response) => {
    calls.push(request.url!);
    const id = decodeURIComponent(request.url!.split("/")[3] ?? "");
    response.setHeader("Content-Type", "application/json");
    const common = { version: 1, public: true, title: 'Rex "><script>alert(1)</script>', description: 'A story with "quotes" & <characters>.' };
    if (id === ids[0]) response.end(JSON.stringify({ ...common, image: { path: `/v1/posts/${encodeURIComponent(id)}/preview/image?version=${version}`, type: "image/jpeg", alt: "A photo" } }));
    else if (id === ids[1]) response.end(JSON.stringify({ ...common, public: false, description: "PRIVATE SECRET", image: { path: "/private", alt: "SECRET" } }));
    else if (id === ids[2]) response.end("unavailable");
    else if (id === ids[3]) response.end(JSON.stringify({ ...common, image: { path: "https://internal.invalid/private", type: "image/jpeg" } }));
    else response.end("x".repeat(17000));
  }).listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  // Reserve an available port for the real PHP HTTP server.
  const probe = createServer().listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as { port: number }).port; await new Promise<void>(done => probe.close(() => done()));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const template = await readFile(new URL("../apps/web/public/post-preview.php", import.meta.url), "utf8");
    await writeFile(join(folder, "post-preview.php"), template.replace("__OSP_PREVIEW_CONFIG__", Buffer.from(JSON.stringify({ api: apiUrl, site: "https://opensocial.online" })).toString("base64")));
    await writeFile(join(folder, "index.html"), await readFile(new URL("../apps/web/index.html", import.meta.url), "utf8"));
    await promisify(execFile)(php, [...phpArgs, "-l", join(folder, "post-preview.php")]);
    child = spawn(php, [...phpArgs, "-S", `127.0.0.1:${port}`, "post-preview.php"], { cwd: folder, stdio: ["ignore", "ignore", "pipe"] });
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(Error("PHP did not start")), 5000);
      child!.once("error", reject);
      child!.stderr!.on("data", data => { if (String(data).includes("started")) { clearTimeout(timer); done(); } });
    });
    const page = async (id: string, ua = "facebookexternalhit/1.1") => {
      const response = await fetch(`http://127.0.0.1:${port}/post/${encodeURIComponent(id)}?viewer=ignored`, { headers: { "User-Agent": ua, Host: "host-header.invalid" } });
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("content-type")!, /text\/html/);
      const html = await response.text();
      const dom = new JSDOM(html); const doc = dom.window.document;
      const meta = (key: string) => doc.querySelector<HTMLMetaElement>(`meta[property="${key}"],meta[name="${key}"]`)?.content;
      assert.ok(doc.querySelector("#root")); assert.ok(doc.querySelector('script[type="module"]'));
      assert.equal(doc.querySelectorAll("script").length, 1, "post text must not create scripts");
      assert.equal(doc.querySelectorAll("title").length, 1); assert.equal(doc.querySelectorAll('meta[name="description"]').length, 1);
      return { doc, meta, html, close: () => dom.window.close() };
    };
    const publicCard = await page(ids[0]!);
    assert.equal(publicCard.meta("og:title"), 'Rex "><script>alert(1)</script>');
    assert.equal(publicCard.meta("twitter:description"), 'A story with "quotes" & <characters>.');
    assert.equal(publicCard.meta("og:image"), `${apiUrl}/v1/posts/${encodeURIComponent(ids[0]!)}/preview/image?version=${version}`);
    assert.equal(publicCard.doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href, `https://opensocial.online/post/${encodeURIComponent(ids[0]!)}`);
    const human = await page(ids[0]!, "Mozilla/5.0"); assert.equal(human.html, publicCard.html); human.close(); publicCard.close();
    for (const id of [ids[1], ids[2], ids[4], "invalid"]) {
      const p = await page(id!); assert.equal(p.meta("og:title"), "Open Social");
      assert.equal(p.meta("og:image"), "https://opensocial.online/social-card.png"); assert.ok(!p.html.includes("PRIVATE SECRET")); p.close();
    }
    const untrusted = await page(ids[3]!); assert.equal(untrusted.meta("og:image"), "https://opensocial.online/social-card.png"); untrusted.close();
    assert.ok(calls.every(path => /^\/v1\/posts\/[A-Za-z0-9_-]{43}%3D\/preview$/.test(path)), "no cookies/viewer/query/host data goes to the API");
  } finally {
    if (child) { child.kill(); await once(child, "exit"); }
    await new Promise<void>(done => api.close(() => done()));
    await rm(folder, { recursive: true, force: true });
  }
});
