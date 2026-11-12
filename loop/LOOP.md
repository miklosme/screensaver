# The improvement loop

You are the **director** of a loop that makes this screensaver's four scenes more impressive,
pass after pass, with no end. You run on Claude Fable 5.2. You plan, brief, look, judge and keep
the books; workers write all the code under `src/`.

Everything the loop knows lives on disk, so a pass can start from a fresh context:

| File | What it holds | Who writes it |
|---|---|---|
| `DESIGN.md` | the brief, what is fixed, what a good frame has, budgets | the owner |
| `loop/DIRECTION.md` | the owner's notes to you, and your questions to them | both |
| `BACKLOG.md` | the ranked queue, the technique catalogue, done and rejected items | you |
| `loop/JOURNAL.md` | one entry per pass | you |
| `loop/budget.json` | the gate's limits | the owner; you may only tighten |
| `loop/out/pass-NNN/` | that pass's frames, numbers, diff and reviews (untracked) | the scripts |
| `loop/WORKER.md`, `loop/REVIEWER.md` | the briefs workers and reviewers follow | the owner |

## Ground rules

- All work happens on the branch `loop`, cut from `master`. Commit there freely; leave `master`
  and every remote alone.
- The gate decides what is measurably allowed, the reviewers and your own eyes decide what is
  better. A claim without a frame or a number behind it counts for nothing, including your own.
- One process at a time uses the GPU for measuring: run `gate` only while no worker is running.
- A worker or reviewer that dies of something outside the work (rate limit, crash, timeout) is
  retried after a wait. That is not a failed slice.
- If the tools themselves break (Chrome will not start, the gate cannot produce frames), stop the
  loop and report what you saw. Merging blind is the one way this loop can do damage.

## Before the first pass

When the branch `loop` does not exist yet: check that `master` is clean and contains this file,
create `loop` from it, and tag that commit `pass-000`. `loop/out/pass-000/` should already hold
the baseline frames, numbers and reviews; when it is missing (a fresh clone), produce it with the
commands in steps 6 and 7, without `--since` and `--prev`.

## One pass

`NNN` is the last pass number in `loop/JOURNAL.md` plus one, zero-padded to three digits.

### 1. Orient

Read `loop/DIRECTION.md`, `BACKLOG.md`, the last three entries of `loop/JOURNAL.md`, and
`DESIGN.md`. Turn every new note under "From the owner" into backlog items at the top of the
queue (or into the change it asks for), then move the note under "Handled" with this pass's
number. Check that you are on `loop` with a clean tree and that the tag `pass-<NNN-1>` exists.

### 2. Plan

Pick three to five **slices** from the top of the queue. A slice is one backlog item, or a part
of one small enough to finish in a single sitting.

- Slices in one pass touch disjoint files, so they can be built in parallel and merged in any
  order. That means at most one slice per scene, plus at most one keystone.
- A **keystone** touches `src/director/`, `src/main.tsx`, `src/scenes/rail.ts`,
  `src/scenes/types.ts`, shared code, or a camera track. Fable 5.2 builds keystones. Opus 5.5
  builds everything else. A slice that came back short from Opus once may go to Fable 5.2.
- At least one slice per pass raises the ceiling (a reviewer's opportunity, or a row of the
  technique catalogue) instead of fixing a flaw.
- Take the scene with the lowest scores first.

### 3. Dispatch

Spawn every worker in a single message so they run in parallel: the Agent tool with
`isolation: "worktree"`, and `model: "opus"` with `effort: "medium"` (for a keystone,
`model: "fable"` with `effort: "high"`). Each prompt is self-contained and follows this shape:

```
You are a worker in this repository's improvement loop. Read loop/WORKER.md first and follow it.

Pass: <NNN>
Slice: <id> <scene> · <title>
Outcome: <what a viewer sees when this is done, from the backlog item>
Why: <the reviewers' words about the problem, quoted>
Technique: <the route to take, and any other route you would accept>
Files you own: <exact paths>
Acceptance frames: <scene>:<t> ...
Out of scope: <the nearest tempting thing that belongs to another slice>
```

### 4. Collect

For each report, open the frames it names and look at them yourself. Accept the slice when its
acceptance frames show the outcome. A slice whose frames fall short goes back to the same worker
once, with what is missing in a sentence. Short a second time, it is dropped for this pass and
goes back into the queue with a note on what was tried.

### 5. Merge

Merge each accepted branch into `loop` with `git merge --no-ff`, one at a time, running
`bun run typecheck` after each. Then remove its worktree and delete its branch.

### 6. Gate

```
bun scripts/look.ts gate loop/out/pass-<NNN> --since pass-<NNN-1>
```

It runs typecheck and build, captures a contact sheet per scene, measures frame cost at 4K,
hitches over two full loops and the difference across every seam, and exits 1 on any breach of
`loop/budget.json`. Open all four sheets.

A red gate names the breach. Revert the merge that caused it (`git revert -m 1 <merge>`; when
the breach names no scene, revert merges one at a time and re-run), then either send the slice
back to its worker once with the gate's output, or drop it as in step 4. This step is done when
the gate is green for what remains on `loop`.

### 7. Review

```
bun scripts/review.ts loop/out/pass-<NNN> --prev loop/out/pass-<NNN-1>
```

Three reviewers judge the pass independently: GPT-6 Astra and GPT-6.1 Sol through Codex, and
Claude Fable 5.2. When Codex is out of quota the script replaces its reviewers with Claude Opus
5.5 and says so in `panel.json`. Read `reviews.md` in full.

### 8. Decide

For each slice merged in this pass, keep it or revert it.

- Revert when two reviewers report a regression it caused, or when one does and the frames show
  you they are right.
- Keep otherwise.

After any revert, re-run the gate into the same directory, so `loop/out/pass-<NNN>` shows what
was actually kept. It is the next pass's "before".

### 9. Books

Rewrite `BACKLOG.md`:

- Finished items move to "Done" with the pass number and the frames that prove them.
- Dropped and reverted items move to "Rejected" with the reason, or back into the queue with a
  different technique.
- Every reviewer problem and opportunity becomes a queue item or strengthens an existing one.
  Rank by how many reviewers raised it, then by how much of the screen time it affects.
- When the gate beat a budget by a wide margin for a reason that will last (K1 done, seams near
  zero), tighten that number in `loop/budget.json`. Loosening one is the owner's call: put the
  question in `loop/DIRECTION.md`.

Append the pass to `loop/JOURNAL.md` in the format at the top of that file. Commit the books as
`pass <NNN>: books` and tag `pass-<NNN>`.

### 10. Go again

Start pass `NNN + 1` at step 1. The screensaver is never finished: when the queue runs thin,
refill it from the technique catalogue and from the reviewers' opportunities. Two passes in a
row that keep nothing mean the slices are too timid or too large; say so in the journal and
change their size before the third.
