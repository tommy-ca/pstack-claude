// models.json is the model policy every stamped Models section, the override
// sheet, and the Codex mapping derive from. Nothing else validates its shape,
// and a role label is the runtime join key between the override sheet the
// user writes and the prose that tells the agent which role to look up.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadModels, resolveModels, section } from "../tools/generate.mjs";
import { markdownFiles } from "../tools/validate-skills.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsDir = join(repoRoot, "plugins/pstack/skills");
const raw = JSON.parse(readFileSync(join(repoRoot, "plugins/pstack/models.json"), "utf8"));
const models = loadModels();
const available = new Set(models.available.map((m) => m.slug));
const codexAvailable = new Set(models.codex.available.map((m) => m.slug));

describe("models.json shape", () => {
  test("available slugs are unique and the defaults are among them", () => {
    expect(available.size).toBe(models.available.length);
    expect(available.has(models.singleRoleDefault)).toBe(true);
    for (const slug of models.panel) expect(available.has(slug)).toBe(true);
    expect(new Set(models.panel).size).toBe(models.panel.length);
  });

  test("every role names an available model or the panel, and a skill directory that exists", () => {
    const labels = new Set();
    for (const role of raw.roles) {
      expect(typeof role.role).toBe("string");
      expect(labels.has(role.role)).toBe(false);
      labels.add(role.role);
      expect(existsSync(join(skillsDir, role.skill, "SKILL.md"))).toBe(true);
      if (role.models === "panel") continue;
      expect(Array.isArray(role.models) && role.models.length > 0).toBe(true);
      for (const slug of role.models) expect(available.has(slug)).toBe(true);
    }
  });

  test("the panel is written once and resolved by reference", () => {
    const literal = raw.roles.filter((r) => Array.isArray(r.models) && r.models.join() === raw.panel.join());
    expect(literal).toEqual([]);
    const resolved = resolveModels(raw).roles.filter((r) => raw.roles.find((x) => x.role === r.role).models === "panel");
    expect(resolved.length).toBeGreaterThan(0);
    for (const role of resolved) expect(role.models).toEqual(raw.panel);
  });

  test("role entries stay one row so a role change is a one-line diff", () => {
    const text = readFileSync(join(repoRoot, "plugins/pstack/models.json"), "utf8");
    const rows = raw.available.length + raw.roles.length + raw.codex.roles.length;
    expect(text.match(/^\s*\{ "/gm)).toHaveLength(rows);
  });

  test("the Codex CLI catalog contains selectable models and valid defaults", () => {
    expect(models.codex.catalogVersion).toBe("0.159.2");
    expect(models.codex.available.map((m) => m.slug).sort()).toEqual([
      "gpt-6-astra",
      "gpt-6.1-sol",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ].sort());
    expect(codexAvailable.size).toBe(models.codex.available.length);
    expect(codexAvailable.has(models.codex.singleRoleDefault)).toBe(true);
    expect(codexAvailable.has(models.codex.strongestRoleDefault)).toBe(true);
    for (const slug of models.codex.panelQuad) expect(codexAvailable.has(slug)).toBe(true);
    expect(new Set(models.codex.panelQuad).size).toBe(models.codex.panelQuad.length);
  });

  test("Codex roles use the exact Claude role labels and explicit Codex defaults", () => {
    const expected = {
      "feature, refactoring": ["gpt-6.1-sol"],
      "bug-fix": ["gpt-6-astra"],
      "perf-issue": ["gpt-6-astra"],
      "hillclimb": ["gpt-6-astra"],
      "judgment and prose": ["gpt-6.1-sol"],
      "strongest judgment": ["gpt-6-astra"],
      "how explorer": ["gpt-6.1-sol"],
      "how explainer": ["gpt-6.1-sol"],
      "why investigators": ["gpt-6.1-sol"],
      "why synthesizer": ["gpt-6.1-sol"],
      "reflect tooling": ["gpt-6.1-sol"],
      "reflect judgment, divergent, synthesizer": ["gpt-6-astra"],
      "arena runners": "panel",
      "arena cross-judge pool": "panel",
      "swarm workers": ["gpt-6.1-sol"],
      "architect runners": "panel",
      "interrogate reviewers": "panel",
    };
    expect(raw.codex.roles.map((r) => r.role)).toEqual(raw.roles.map((r) => r.role));
    expect(Object.fromEntries(raw.codex.roles.map(({ role, models }) => [role, models]))).toEqual(expected);
    for (const role of models.codex.roles) {
      expect(existsSync(join(skillsDir, role.skill, "SKILL.md"))).toBe(true);
      for (const slug of role.models) expect(codexAvailable.has(slug)).toBe(true);
    }
  });

  test("Codex panel roles resolve through panelQuad instead of Claude panel", () => {
    const resolved = resolveModels(raw);
    const panels = resolved.codex.roles.filter((r) => raw.codex.roles.find((x) => x.role === r.role).models === "panel");
    expect(panels).toHaveLength(4);
    for (const role of panels) expect(role.models).toEqual(raw.codex.panelQuad);
    expect(resolved.codex.panelQuad).not.toEqual(resolved.panel);
  });
});

describe("role labels reach the prose", () => {
  // The prose may hyphenate a label ("how-explorer" for the sheet's
  // "how explorer") and names only the first segment of a comma-joined label.
  const normalize = (text) => text.toLowerCase().replace(/[-\s]+/g, " ");

  function skillProse(skill) {
    return markdownFiles(join(skillsDir, skill))
      .map((file) => {
        const lines = readFileSync(file, "utf8").split("\n");
        const owned = section("Models")(lines);
        if (owned) lines.splice(owned[0] - 1, owned[1] - owned[0] + 1);
        return lines.join("\n");
      })
      .join("\n");
  }

  for (const role of models.roles) {
    test(`"${role.role}" is named by the ${role.skill} skill outside its stamped section`, () => {
      const needle = normalize(role.role.split(",")[0]);
      expect(normalize(skillProse(role.skill))).toContain(needle);
    });
  }
});
