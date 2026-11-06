export const WHAT_MURMUR_SENDS =
  "For projects you turn on, the plugin sends your prompts, Claude's replies and narration, tool calls with their inputs and results, file paths, code changes and command output. Obvious secrets such as API keys, tokens and .env values are removed on your machine before sending. Nothing is sent for projects you have not turned on. Sessions are deleted after your retention period, and you can delete any session or your whole account at any time.";

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
