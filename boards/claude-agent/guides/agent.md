---
title: "Agent Chat for agents"
audience: agent
summary: "Send messages to Agent Chat sessions, read their transcripts, wait for them to finish, and manage saved profiles."
---

# Agent Chat for agents

Find the Agent Chat page and use its model at `pages["<id>"].editor.app`. The examples below use
synthetic values; replace the placeholders with IDs and text from the current task.

```js
const app = pages["<id>"].editor.app
```

## Sessions

Send a prompt without waiting for the turn to finish:

```js
app.send("<session-id>", "<prompt>", { wait: false })
// { status: "sent", reply: "" }
```

Read the latest transcript entry. Messages return an array of entries with `role` and `text` fields;
tool entries can also include `name`, `args`, and timestamps.

```js
app.messages("<session-id>", { limit: 1 })
// [{ role: "assistant", text: "<short synthetic reply>" }]
```

Wait for a known session to become idle. This does not connect a stored session.

```js
app.waitIdle("<session-id>")
// { status: "idle", reply: "" }
```

## Saved profiles

Create a profile. `name`, `roleTitle`, `instructions`, and `summary` are required. The other fields
use the shown defaults when omitted.

```js
app.create({
  name: "Example profile",
  roleTitle: "Reviewer",
  instructions: "<synthetic instructions>",
  summary: "<synthetic summary>"
})
// {
//   id: "<generated id>", name: "Example profile", roleTitle: "Reviewer",
//   instructions: "<synthetic instructions>", summary: "<synthetic summary>",
//   provider: "claude", model: "opus", effort: "medium",
//   permissionMode: "read-only", color: ""
// }
```

Update a profile with a partial patch. The returned value is the saved profile object.

```js
app.update("<profile-id>", { summary: "<synthetic summary>" })
// { id: "<profile-id>", name: "<saved name>", ... }
```

Duplicate a profile. The service assigns the duplicate's ID and unique name.

```js
app.duplicate("<profile-id>")
// { id: "<generated id>", name: "<service-generated name>", ... }
```

Delete a saved profile. This takes effect immediately and returns the deleted ID.

```js
app.delete("<profile-id>")
// "<profile-id>"
```
