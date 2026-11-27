import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the page is a static GitHub Pages shell wired to dong-ui", () => {
  assert.match(html, /href="dong-ui\/theme\.css"/);
  assert.match(html, /src="dong-ui\/theme\.js"/);
  assert.match(html, /src="dong-ui\/gh-sync\.js"/);
  assert.match(html, /src="js\/app\.js"/);
  assert.match(html, /href="https:\/\/dong-xuyong\.github\.io\/"/);
  assert.match(html, /class="dong-home-link"/);
  assert.match(html, /data-dong-theme-toggle/);
  assert.match(html, /data-view="today"/);
  assert.match(html, /data-view="closet"/);
  assert.match(html, /data-view="history"/);
  assert.equal(html.includes("photo.thumb"), false);
});

test("app modules parse", () => {
  for (const file of ["js/app.js", "js/engine.js", "js/merge.js", "js/model.js", "js/startup.js", "js/vocab.js", "js/weather.js", "dong-ui/gh-sync.js"]) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || file);
  }
});
