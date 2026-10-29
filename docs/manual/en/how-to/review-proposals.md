**English** | [한국어](../../ko/how-to/review-proposals.md)

# Review proposals

This guide accepts or rejects proposals sent to the guideline server.
It is for admins of the server, and for agents that hold an `admin` scope token.

## Review on the web

1. Log in with the admin token and open **Proposals**.
2. Look at each file's diff.
   - If the source changed in the meantime and the changes do not overlap, you see the merged result.
   - If both changed the same place, you see a conflict (Outdated) and the accept button is disabled.
3. Resolve a conflict with **Edit**, remove that file from the proposal, or reject the proposal.
4. Accept or reject.

Accepting creates one revision. Its source is `proposal`, its author is the token name, and its message is "proposal #<number>: <title>".

## Review through the API

An agent with the admin token or an `admin` scope token can see every proposal and accept or reject it.

1. List the proposals with `guideline proposals --status pending`, or `GET /api/v1/proposals?status=pending`.
2. Look at one proposal with `guideline proposals <number>`. It shows whether the proposal is Outdated, the conflicting paths and each file's diff.
   - Through the API, `GET /api/v1/proposals/<number>?diff=1` adds each file's diff, and `?content=1` adds each file's content.
3. Accept or reject it:
   - `POST /api/v1/proposals/<number>/accept`
   - `POST /api/v1/proposals/<number>/reject`

A conflict returns 409 with `conflicts`.
How proposals are merged is described in [Proposals](../reference.md#proposals).

## Next

- [Propose changes to the source](propose-changes.md)
- [Server API](../reference.md#server-api)
