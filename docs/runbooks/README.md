# Runbooks

Procedures a support engineer or operator runs against a live project, written
to be followed by someone who did not build the thing.

**This directory is new as of the cluster-replacement work.** The repo had
`docs/adr/` for decisions and `docs/supabase-setup.md` for standing up a
project, and nowhere for "somebody is on the phone and I have to do something
about it". A runbook is neither a decision nor a setup step, and putting one in
either place buries it.

## What belongs here

An operation that is **deliberately not in the app**, because putting it in the
app would be worse than the support cost. Each of those needs a written
procedure or it becomes folklore: the first person to do it works it out, and
the second one asks them.

Every runbook here states, in this order:

1. **The symptom**, in the words the customer uses.
2. **How to verify the claim** before touching anything. A support action that
   runs on the customer's say-so is an attack surface with a help desk in front
   of it.
3. **What to run**, exactly.
4. **What to check afterwards**, so "it worked" is observed rather than assumed.
5. **What it leaves behind** — the audit trail, and how to read it.

## What does not belong here

- Decisions and their reasoning → `docs/adr/`.
- Standing up a project, keys, extensions → `docs/supabase-setup.md`.
- Anything a customer can do themselves. If a runbook is being followed weekly,
  that is the signal to build the screen instead.

## Index

| Runbook                                                            | For                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [odometer-cluster-replacement.md](odometer-cluster-replacement.md) | A car whose instrument cluster was replaced and whose odometer readings are now all refused |
