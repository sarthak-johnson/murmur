# Murmur

A live companion screen for Claude Code, shown on a second monitor beside the terminal.
It turns a running session into something a person can follow: what is being built right now and why, how the parts tie together, where the plan is, and what each subagent is doing.

Status: design stage.
No product code yet.

## The problem

Developers using coding agents often lose track of what the agent is doing and why.
The terminal shows diffs and tool calls, not the story.
Anthropic's January 2026 study on AI assistance and coding skills found developers who used AI scored about 17% lower on a quiz about the code they had just worked with, while those who asked for explanations kept their understanding.

## Mockups

Open these in a browser.

- [01 Map directions](docs/mockups/01-map-directions.html): route, mind map, and story + plan, compared.
- [02 Story + map + plan](docs/mockups/02-story-map-plan.html): the combined live screen.
- [03 Part drill-down and ideas](docs/mockups/03-part-drilldown-and-ideas.html): clicking a part opens its aim, steps, files, choices and checks, plus the list of whole-screen ideas.
- [04 Phases and tasks](docs/mockups/04-phases-and-tasks.html): Claude's plan as phases and tasks, linked to the map.
