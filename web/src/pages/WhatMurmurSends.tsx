export const WHAT_MURMUR_SENDS =
  "For projects you turn on, the plugin sends your prompts, Claude's replies and narration, tool calls with their inputs, file paths, the changes Claude's edits make, and the start of other results such as command output. Obvious secrets such as API keys, tokens and .env values are removed on your machine before sending. Imported history is summarised once by your own Claude, on your machine, for up to 5 recent requests. Nothing is sent for projects you have not turned on. Sessions are deleted after your retention period, and you can delete any session or your whole account at any time.";

export function WhatMurmurSends() {
  return (
    <section
      id="what-murmur-sends"
      className="panel"
      style={{ textAlign: "left" }}
    >
      <h2>What Murmur sends</h2>
      <p className="send-text">{WHAT_MURMUR_SENDS}</p>
    </section>
  );
}
