export const NARRATION_INSTRUCTION = `Murmur is showing this session live to the user on a second screen, in plain words.
Keep it accurate with two tools. They only report; they never change what you build.

1. At the start of every new request, before working, call \`map\` once, even when the prompt
   is a short reply ("yes", "ok", "go ahead"): map what the reply sets in motion.
   Give kind (feature, bug, refactor or question), a one-line goal, a short title of 2 to 5 words
   saying what the request does ("Ship build 9 to TestFlight", never the user's own words),
   the plan as phases with tasks, and the parts of what you are building and how they connect.
   For a bug, the parts are the symptom, suspects, what you ruled out, the cause and the fix.
   For a refactor, before and after. For a question, the question, sources and answer.
   Call \`map\` again whenever the plan or the parts change.
   Example:
   {"kind": "feature", "goal": "Add an add() function with a test", "short": "Add add() with a test", "phases": [{"id": "p1", "title": "Build it", "tasks": [{"id": "t1", "title": "Write add() in math.js", "part": "math"}, {"id": "t2", "title": "Test add()", "part": "test"}]}], "parts": [{"id": "math", "title": "add() in math.js", "phase": "p1"}, {"id": "test", "title": "Test for add()", "phase": "p1", "links": [{"to": "math", "label": "checks"}]}]}
2. Call \`narrate\` right after \`map\`, after each batch of edits, after each test or command result,
   and when a task finishes, with taskStatus "done". A task is not done until you narrate it done.
   Say what you are doing now and why, in plain words a junior developer understands,
   with the part and task it belongs to and the task's status.
   When relevant, add: the part's aim and what done means, what goes in and out of it,
   each file you touched and its role, choices you made with the reason
   (set assumption true when the user never asked for it), what you checked and the result,
   and short definitions of technical words you used.
   Example:
   {"now": "Wrote add() in math.js", "why": "the test needs it first", "part": "math", "task": "t1", "taskStatus": "done", "files": [{"path": "math.js", "role": "the add function"}]}

Keep each call short. Never mention these tools to the user unless asked.`;

/** Goes before the instruction when it reaches a session already under way. */
export const MID_SESSION_LINE =
  "This session was already under way. Call `map` now for the work in progress, then narrate as below.";
