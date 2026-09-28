#!/usr/bin/env python3
"""Pin check for the Droid pstack model policy.

Two surfaces, each with a flag: --factory-dir (default ~/.factory) walks
settings.json for every key ending in model or reasoningeffort and parses the
droids/*.md frontmatter, and --models-json (default the repo's
plugins/pstack/models.json) checks the droid section. Every pin runs the same
unconditional gauntlet in order: the BANNED exact-match denylist, the
claude-sonnet substring rule, the Gemini Pro regex, the PRICES known-slug
table, and the 2x ceiling. A settings key ending in model or reasoningeffort
carries a string, or a list whose string items are each pinned; any other
value under such a key fails. Droid frontmatter strips an unquoted trailing
comment before the value is pinned, and a non-markdown regular file directly
under droids/ fails. The droid section pins every key whose value is a string
or a list of strings, so a future mirrored tier cannot evade the gauntlet,
and an empty panel fails. An explicitly passed --factory-dir must exist and
yield at least one pin; the default ~/.factory is skipped when absent. A
missing models.json or droid section fails. FILTER_OK exits 0, FILTER_FAIL
exits 1.
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

CEILING = 2.0

EFFORTS = {"off", "minimal", "none", "low", "medium", "high", "xhigh", "max"}

GEMINI_PRO = re.compile(r"gemini.*[-_.]pro")

# Audited 2026-09-28 against https://docs.factory.ai/models.
# gpt-6-luna (0.04x) and gpt-5.6-luna (0.08x) are user-mandated allowed
# cheap-worker slugs from the same audit. gpt-5.6-luna is deliberately NOT
# marked dominated by gpt-6-luna despite the older-generation-higher-price
# pattern; the mandate overrides that rule.
PRICES = {
    "glm-5.3-flash": 0.06,
    "glm-5.3": 0.56,
    "claude-opus-5-5": 1.6,
    "claude-opus-5": 2.0,
    "gpt-6-sol": 0.8,
    "gpt-6-luna": 0.04,
    "gpt-5.6-luna": 0.08,
    "grok-4.7": 0.8,
}
# gemini-3.8-flash is 0.3x promotional before 2027-01-01, then 0.6x.
if datetime.date.today() < datetime.date(2027, 1, 1):
    PRICES["gemini-3.8-flash"] = 0.3
    GEMINI_NOTE = "0.3x promotional before 2027-01-01"
else:
    PRICES["gemini-3.8-flash"] = 0.6
    GEMINI_NOTE = "0.6x standard on or after 2027-01-01"

BANNED = {
    "claude-fable-5": "over budget at 4x",
    "claude-fable-5.1": "over budget at 4x",
    "claude-opus-5-5-fast": "over budget at 3.2x",
    "gpt-6-astra": "over budget at 4x",
    "gpt-5.5": "over budget at 2x",
    "gpt-5.5-fast": "over budget at 5x",
    "gpt-5.5-pro": "over budget at 12x",
    "claude-opus-5": "over budget at 2x",
    "claude-opus-5-fast": "over budget at 4x",
    "claude-opus-4-8": "over budget at 2x",
    "claude-opus-4-8-fast": "over budget at 4x",
    "claude-opus-4-7": "over budget at 2x",
    "claude-opus-4-6": "over budget at 2x",
    "claude-opus-4-5-20251101": "over budget at 2x",
    "glm-5.2": "dominated by glm-5.3 at 0.56x",
    "glm-5.2-fast": "dominated by glm-5.3 at 0.56x",
    "gpt-5.6-sol": "dominated by gpt-6-sol at 0.8x",
    "gpt-5.6-sol-fast": "dominated by gpt-6-sol at 0.8x",
    "gemini-3.7-flash": "dominated by gemini-3.8-flash at the same price",
    "grok-4.5": "dominated by grok-4.7 at 0.8x",
    "grok-4.6": "dominated by grok-4.7 at 0.8x",
    "claude-sonnet-5": "claude-sonnet-* banned",
    "claude-sonnet-4-6": "claude-sonnet-* banned",
    "claude-sonnet-4-5-20250929": "claude-sonnet-* banned",
    "gemini-3.1-pro-preview": "Gemini Pro banned",
    "deepseek-v4-flash-0731": "legacy, scheduled for removal",
    "deepseek-v4-pro": "legacy, scheduled for removal",
    "minimax-m2.7": "legacy, scheduled for removal",
    "kimi-k2.5": "legacy, scheduled for removal",
    "glm-5.1": "legacy, scheduled for removal",
}


def walk(node, path, models, efforts, failures):
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}" if path else key
            lowered = key.lower()
            if lowered.endswith("model") or lowered.endswith("reasoningeffort"):
                bucket = models if lowered.endswith("model") else efforts
                if isinstance(value, str):
                    bucket[child] = value
                elif isinstance(value, list):
                    for index, item in enumerate(value):
                        if isinstance(item, str):
                            bucket[f"{child}[{index}]"] = item
                        else:
                            failures.append(
                                f"non-string {key}[{index}] value at settings:{child}[{index}]: {item!r}"
                            )
                else:
                    failures.append(f"non-string {key} value at settings:{child}: {value!r}")
            walk(value, child, models, efforts, failures)
    elif isinstance(node, list):
        for index, item in enumerate(node):
            walk(item, f"{path}[{index}]", models, efforts, failures)


def frontmatter(text):
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    fields = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return fields
        key, sep, value = line.partition(":")
        if sep:
            value = value.strip()
            # Strip an unquoted trailing comment, so `model: slug # note`
            # pins the slug; a quoted value keeps its quoted span.
            if len(value) > 1 and value[0] in "'\"" and value.find(value[0], 1) != -1:
                value = value[1 : value.find(value[0], 1)].strip("'\"")
            else:
                value = re.split(r"\s#", value, 1)[0].strip().strip("'\"")
            fields[key.strip()] = value
    return None


def price_pin(where, slug, failures):
    if slug in BANNED:
        failures.append(f"banned slug {slug} at {where}: {BANNED[slug]}")
    if "sonnet" in slug.lower():
        failures.append(f"sonnet family slug {slug} at {where}")
    if GEMINI_PRO.search(slug.lower()):
        failures.append(f"gemini pro family slug {slug} at {where}")
    if slug not in PRICES:
        failures.append(f"unknown slug {slug} at {where}")
        return None
    mult = PRICES[slug]
    if mult >= CEILING:
        failures.append(f"over ceiling {slug} ({mult}x) at {where}")
    return mult


def collect_factory(factory, explicit, pins, efforts, inherit, failures):
    skipped = []
    if explicit and not factory.is_dir():
        failures.append(f"--factory-dir {factory} does not exist or is not a directory")
        return skipped
    before = len(pins)
    settings_path = factory / "settings.json"
    if settings_path.is_file():
        try:
            settings = json.loads(settings_path.read_text())
        except (OSError, json.JSONDecodeError) as error:
            failures.append(f"unreadable settings.json at {settings_path}: {error}")
        else:
            found, levels = {}, {}
            walk(settings, "", found, levels, failures)
            for where, slug in found.items():
                pins[f"settings:{where}"] = slug
            for where, value in levels.items():
                efforts[f"settings:{where}"] = value
    else:
        skipped.append(f"skipped: no settings.json at {settings_path}")
    droids = factory / "droids"
    if not droids.is_dir():
        skipped.append(f"skipped: no droids dir at {droids}")
        if explicit and len(pins) == before:
            failures.append(f"--factory-dir {factory} yielded no pins")
        return skipped
    for entry in sorted(droids.iterdir()):
        if entry.is_file() and entry.suffix != ".md":
            failures.append(f"non-markdown file in the droids dir at {entry.name}")
    for droid in sorted(droids.glob("*.md")):
        where = f"droid:{droid.name}"
        try:
            fields = frontmatter(droid.read_text())
        except OSError as error:
            failures.append(f"unreadable droid at {where}: {error}")
            continue
        if fields is None:
            failures.append(f"no frontmatter at {where}")
            continue
        if "model" not in fields:
            failures.append(f"no model key in frontmatter at {where}")
            continue
        model = fields["model"]
        if model == "inherit":
            inherit.append(where)
        else:
            pins[where] = model
        effort = fields.get("reasoningEffort")
        if effort is not None:
            efforts[f"{where}.reasoningEffort"] = effort
        if droid.name.startswith("pstack-panel-"):
            if model == "inherit":
                failures.append(f"panel droid must pin a non-inherit model at {where}")
            if effort is None:
                failures.append(f"panel droid missing reasoningEffort at {where}")
    if explicit and len(pins) == before:
        failures.append(f"--factory-dir {factory} yielded no pins")
    return skipped


def collect_models_json(target, pins, failures):
    try:
        data = json.loads(target.read_text())
    except FileNotFoundError:
        failures.append(f"models-json missing at {target}")
        return
    except (OSError, json.JSONDecodeError) as error:
        failures.append(f"unreadable models-json at {target}: {error}")
        return
    droid = data.get("droid") if isinstance(data, dict) else None
    if not isinstance(droid, dict):
        failures.append(f"no droid section at {target}")
        return
    tiers = data.get("tiers") if isinstance(data, dict) else None
    if not isinstance(tiers, dict):
        failures.append(f"no tiers section to mirror at {target}")
    else:
        missing = sorted(set(tiers) - set(droid))
        extra = sorted(set(droid) - set(tiers))
        if missing:
            failures.append(f"droid section missing tiers keys {missing} at {target}")
        if extra:
            failures.append(f"droid section carries extra keys {extra} at {target}")
    # Pin every key whose value is a string or a list of strings, so a future
    # mirrored tier can never evade the gauntlet.
    for key in sorted(droid):
        value = droid[key]
        if isinstance(value, str):
            if value:
                pins[f"models-json:droid.{key}"] = value
            else:
                failures.append(f"empty {key} slug in the droid section at {target}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                where = f"models-json:droid.{key}[{index}]"
                if isinstance(item, str) and item:
                    pins[where] = item
                else:
                    failures.append(f"empty or non-string {key}[{index}] slug at {where}")
        else:
            failures.append(f"non-string {key} value at models-json:droid.{key}")
    for key in ("default", "strongest"):
        if not (isinstance(droid.get(key), str) and droid[key]):
            failures.append(f"missing or empty {key} slug in the droid section at {target}")
    panel = droid.get("panel")
    if not isinstance(panel, list):
        failures.append(f"no panel list in the droid section at {target}")
    elif not panel:
        failures.append(f"empty panel list in the droid section at {target}")
    else:
        slugs = [slug for slug in panel if isinstance(slug, str)]
        if len(set(slugs)) != len(slugs):
            failures.append(f"duplicate panel slugs {slugs} at {target}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Droid pstack model pins against the policy.")
    parser.add_argument(
        "--factory-dir",
        type=Path,
        default=None,
        help="Droid config dir holding settings.json and droids/ (default: ~/.factory)",
    )
    parser.add_argument(
        "--models-json",
        type=Path,
        default=REPO_ROOT / "plugins/pstack/models.json",
        help="models.json whose droid section is checked (default: the repo's)",
    )
    args = parser.parse_args()

    explicit_factory = args.factory_dir is not None
    factory_dir = args.factory_dir if explicit_factory else Path.home() / ".factory"

    pins = {}
    efforts = {}
    inherit = []
    failures = []
    skipped = collect_factory(factory_dir, explicit_factory, pins, efforts, inherit, failures)
    collect_models_json(args.models_json, pins, failures)

    for where in sorted(efforts):
        if efforts[where] not in EFFORTS:
            failures.append(f"invalid reasoningEffort {efforts[where]!r} at {where}")

    max_mult = 0.0
    for where in sorted(pins):
        mult = price_pin(where, pins[where], failures)
        if mult is not None:
            max_mult = max(max_mult, mult)

    for line in skipped:
        print(line)
    print(f"pins={len(pins)} max={max_mult:.2f}x")
    for where in sorted(pins):
        slug = pins[where]
        price = PRICES.get(slug)
        price_text = f"{price:.2f}x" if price is not None else "?x"
        note = f" ({GEMINI_NOTE})" if slug == "gemini-3.8-flash" else ""
        print(f"  {slug:18s} {price_text:>6s}  {where}{note}")
    for where in inherit:
        print(f"  {'inherit':18s} {'-':>6s}  {where}")
    print(f"efforts={len(efforts)}")
    for where in sorted(efforts):
        print(f"  {efforts[where]:8s} {where}")
    if failures:
        print("FILTER_FAIL")
        for index, failure in enumerate(failures, 1):
            print(f" {index}. {failure}")
        return 1
    print("FILTER_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
