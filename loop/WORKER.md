# Worker brief

You build one **slice** of one pass of the improvement loop. The director's message names the
slice: the outcome a viewer should see, the files you own, and the acceptance frames
(`<scene>:<t>`) where that outcome must be visible. This file is how every slice is done.

`AGENTS.md` holds the rules of the code (scenes are pure functions of `clock.t`, everything is
built at mount) and `DESIGN.md` holds the taste. Read both before writing anything.

## Scope

- Edit only the files the slice names. Other workers are changing the other scenes right now, and
  the director merges all of you.
- New three.js objects are created with `new` at mount and mounted with `<primitive object={...}>`,
  which keeps `src/main.tsx` out of your diff. Edit its `extend` list only when the slice names it.
- A slice that turns out to need a file outside its scope stops there and says so in the report.

## Steps

1. **Set up.** `bun install`, then `bun scripts/look.ts sheet loop/out/before <scene>`. Done when
   the "before" sheet exists and you have looked at it.
2. **Build** the outcome.
3. **Look.** `bun scripts/look.ts shots loop/out/after <scene>:<t> ...` for the acceptance frames
   and `bun scripts/look.ts sheet loop/out/after <scene>` for the whole ride. Open the images and
   compare them with "before" against "What a good frame has" in `DESIGN.md`. Repeat steps 2 and 3
   until every acceptance frame shows the outcome at full size, and the sheet shows a clear line
   of flight with the portal filling the screen at `t` = 24.5.
4. **Measure.** `bun run typecheck`, then
   `bun scripts/look.ts perf loop/out/after/perf.json --frames <scene>`. A slice that adds a
   material, texture or geometry also runs `bun scripts/look.ts perf loop/out/after/loop.json --loop`,
   the only check that catches work done in flight. Done when typecheck passes and nothing is over
   budget. Other workers share the GPU, so trust the comparison with your own "before" more than
   the absolute numbers.
5. **Commit** on your worktree's branch as `pass <NNN>: <slice id> <title>`. Leave pushing and
   merging to the director.
6. **Report**, as your final message:
   - slice id, branch, commit
   - what a viewer now sees, in two or three sentences
   - absolute paths of the frames that prove it, before and after
   - frame cost before and after, and the loop run's worst frame if you ran it
   - what falls short of the brief, and what you are unsure of
   - up to three things you noticed that belong in the backlog

A slice that falls short is reported as short, with the frames that show how far it got. The
director decides what happens to it; an honest partial result is worth more than a claimed one.
