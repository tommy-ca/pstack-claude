# Droid tool mapping for pstack

pstack skills are written in Claude Code tool language (the `Skill` tool, the `Agent` tool, `AskUserQuestion`, Claude model names). On Droid the skills are the same files; only the tool names resolve differently. Read this when a pstack skill names a Claude tool, a driver or bundled skill, or a Claude model. This file is Droid-specific. Claude Code, Codex, Gemini CLI, opencode, Prime Agent, and other runtimes must use their own concrete tools, model names, and configuration paths.

## Tool actions

| pstack / Claude action | Droid equivalent |
|------------------------|------------------|
| Read a file | `Read` |
| Create / edit / delete a file | `Create` / `Edit` |
| Run a shell command | `Execute` |
| Search file contents / find files | `Grep` / `Glob` |
| Fetch a URL (`WebFetch`) | `FetchUrl` |
| Search the web | `WebSearch` |
| Invoke a skill (the `Skill` tool, `/command`) | The `Skill` tool, same name. Follow the instructions it presents. |
| Dispatch a subagent (the `Agent`/`Task` tool) | `Task` with `subagent_type` plus a complexity tier (light, medium, heavy) |
| Dispatch N parallel subagents in one turn | N `Task` calls in one response |
| Track tasks (the todolist; `TaskCreate` / `TaskUpdate`, or `TodoWrite` on Claude Code) | `TodoWrite` in the main Droid session; a subagent surface may lack the tool, so keep a `todo.md` checklist in the work dir |
| Ask the human a fixed-choice question (`AskUserQuestion`) | `AskUser` in the main Droid session; a subagent surface may lack the tool, so ask the question in plain text |

A session may defer a tool such as `WebSearch` or `FetchUrl` until it is needed; load it through `ToolSearch` before use.

## Subagent policy

poteto-mode's Subagents section sets Claude-specific defaults (`subagent_type: "pstack:poteto-agent"`, `run_in_background: true`). On Droid:

- There is no `pstack:poteto-agent` plugin namespace. Route an ad-hoc subagent through the `Task` tool's complexity tiers, backed by `subagentModelSettings` in `~/.factory/settings.json`: light (explorer delegates, fast mechanical edits, cheap workers and implementation dispatches) on `glm-5.3-flash`, with `gpt-6-luna` and `gpt-5.6-luna` as the cheap-worker pool's OpenAI seats, medium (the code playbook roles, the judgment seats, swarm workers) on `glm-5.3`, and heavy (the hardest changes, strongest judgment, contested design) at max effort on the heavy tier's pinned model, named in Model names below. Each tier also carries its per-tier reasoning effort in the same settings.
- A role line of `inherit-parent` or `auto` maps to a `model: inherit` droid, which runs on the parent session's model; dispatch it without a model override.
- Panel arms are personal droids named `pstack-panel-zhipu`, `pstack-panel-google`, and `pstack-panel-grok`, created under `~/.factory/droids/`. Spawn one `Task` call per arm and keep the arms model-diverse.
- There is no `comment-sicko` subagent type either. The **no-comments** skill spawns it on Claude Code; on Droid dispatch a `Task` whose instructions tell it to read `poteto-mode/references/agents/comment-sicko.md` in full first.
- Droid runs every subagent on this machine, so the **swarm** skill's workers and the fan-out playbooks (`orchestrate`, `autopilot-full`, `autopilot-stack`) isolate writers with worktrees.
- A role value's `@<level>` effort suffix has no per-call parameter on Droid; the per-tier effort configured in `~/.factory/settings.json` decides it, and `session` changes nothing.
- Keep the rest of the policy unchanged. Pass file pointers not inlined context, give each worker its own worktree or branch when they write, review every subagent's diff yourself.

## Model names

Skills name Claude defaults (a single-role default for code/prose/judgment plus a diverse-model panel for diverse-model panels; each model-consuming skill lists its own in a Models section). These family names do not resolve on Droid. Substitute your configured Droid models:

- Single-model roles: the Droid medium tier (for example `glm-5.3`), set per tier in `subagentModelSettings`, carries the code playbook roles (`feature`, `refactoring`, `bug-fix`, `perf-issue`, `hillclimb`), the judgment seats (judgment and prose, the how explainer, the why synthesizer, reflect judgment), and swarm workers. Upstream routes the `bug-fix`, `perf-issue`, and `hillclimb` playbooks to its code seat rather than the judgment seat, so on Droid they ride the medium tier, not the heavy tier.
- The hardest changes (cross-cutting design, gnarly concurrency, subtle algorithms, strongest judgment) and contested design: the Droid heavy tier (for example `claude-opus-5-5`), at max effort, matching the upstream opus seat.
- Diverse-model panels (arena runners and the arena cross-judge pool, architect runners, interrogate reviewers): the adversarial signal comes from model diversity, so spawn one subagent per panel arm through the personal `pstack-panel` droids. The three-arm default panel on Droid is `glm-5.3`, `gemini-3.8-flash`, `grok-4.7`.

Droid adds a light tier below the medium one (explorer delegates, fast mechanical edits, cheap workers and implementation dispatches) on `glm-5.3-flash`, with `gpt-6-luna` and `gpt-5.6-luna` as the cheap-worker pool's OpenAI seats. The tiers and their per-tier reasoning effort are configured in `subagentModelSettings` in `~/.factory/settings.json`; `/setup-pstack` writes no Droid configuration.

## Driver and bundled skills pstack references

The [driver policy](../SKILL.md#non-negotiables) selects the app driver. For skills and drivers named by these workflows, use these Droid equivalents:

| Skill or driver named in pstack | On Droid |
|---------------------------------|----------|
| `run` (drive a CLI/TUI to see a change work) | Droid ships no bundled `run` driver. Run the app yourself through `Execute` and observe the real output. |
| Project UI driver | Drive the UI with whatever automation you have, or hand the user a concrete manual check. Do not claim done without observing the artifact. |
| `plugin-dev:skill-development` (Claude's SKILL.md authoring guidance) | Follow your platform's skill-authoring guidance. Keep `name` + `description` frontmatter and progressive disclosure. |
| `loop` (recurring/self-paced re-invocation, used by `babysit`) | Droid has no bundled `loop` skill. Re-run the step yourself on a cadence, or use Droid's `Loop` tool where your installation exposes it. |
| `verify` (bundled on Claude Code as `/verify`) | Droid ships no bundled `verify`. Use the project `verify` skill at `.claude/skills/verify/` when the repo has one (generate it with `/create-verification-skill`), or verify by driving the app yourself. |

## Per-skill notes

Affected skill entry points point here. Most skills need only the tables above. These need one more mapping:

| Skill | On Droid |
|-------|----------|
| `interrogate` | The `subagent_type`/`model`/`readonly` dispatch fields map to `Task`; run the reviewer panel as one `Task` per panel arm through the `pstack-panel` droids, keeping the arms model-diverse. |
| `setup-pstack` | Its Other runtimes table names no Droid path; on Droid the pins live in `~/.factory/settings.json` (see Model names above). The role rows are still the reference for what each tier covers. |
| `no-comments` | There is no `comment-sicko` subagent type; see Subagent policy above. |
| `teach` | Running `how` and `why` in parallel maps to `Task` fan-out; image generation uses Droid's image tool where your installation exposes one. |
| `create-verification-skill` | The generated skill lands under `.claude/skills/verify/` on Claude Code; write it where your Droid installation discovers project skills instead. The app-driving harness is platform-neutral. |
| `maintain-verification-skill` | The parallel per-feature source readers map to `Task` fan-out; the project-local skill lives where your installation discovers project skills, not `.claude/skills/`. |
| `babysit` | `loop` and `AskUserQuestion` resolve through the tables above. |
| `automate-me` | `plugin-dev:skill-development` resolves through the skills table above. |

## Instructions file

Where a pstack skill says "your instructions file", on Droid that is `AGENTS.md` (project root, plus personal defaults in `~/.factory/AGENTS.md`). On Claude Code it is `CLAUDE.md`. The Claude override sheet `~/.claude/pstack-models.md` is not read under Droid; the model pins live in `~/.factory/settings.json`.
