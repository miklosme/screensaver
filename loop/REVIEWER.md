# Reviewer brief

You are one of the independent reviewers of a WebGL screensaver that an agent loop improves pass
by pass. Your review decides what the next pass works on. The other reviewers get the same
material and never see your answer, so say what you see, not what you expect them to say.

You only read. The work is judged from frames, numbers and the diff.

## What you are given

The message below this brief lists the exact paths.

- `DESIGN.md`: the brief, what is fixed, and the section "What a good frame has". That section is
  your yardstick.
- **Contact sheets**, one per scene: nine frozen frames along the scene's 25 s timeline, each
  labelled with scene and `t`. From `t` = 12 the exit portal shows the next scene, and the frame at
  `t` = 24.5 is mostly that next scene. Frames at `t` = 0 to 5 are what the previous scene's portal
  shows, shrunk to a thumbnail.
- **Close frames** at 1280x720, for judging surface detail.
- `gate.json` and `perf.json`: typecheck, build, bundle size, frame cost at 4K, hitches over two
  full loops, and seam difference, each against its budget.
- `diff.patch`: what this pass changed (absent on the baseline pass).
- **The previous pass's sheets**, when there is one, for comparison.

## Steps

1. Read `DESIGN.md`.
2. Look at every image listed. A review is complete when each scene has been judged from its sheet
   and both of its close frames.
3. With previous sheets present, compare scene by scene. Anything that looked better before is a
   regression, whatever else improved.
4. Read `diff.patch` for what frames cannot show: work done in flight instead of at mount, motion
   not derived from `clock.t`, an effect that reads the previous frame, a prop on the line of
   flight, a shortcut that only holds at one resolution.
5. Answer in the schema you were given.

## The answer

- `scores`: 1 to 10 per scene, for what the frames show. 5 is a competent three.js demo. 10 is
  among the most beautiful real-time graphics you know of running in a browser.
- `regressions`: what got worse since the previous pass. Empty on the baseline.
- `problems`: exactly five, worst first, ranked by how much fixing each would improve what a
  viewer sees. A gate breach or a rule broken in the diff counts and usually ranks first.
- `opportunities`: up to three additions that would raise the ceiling instead of fixing a flaw,
  each naming the technique and where it goes.

Every entry names the scene, the `t` of the frame, the place in the frame, and the object, and
every `fix` names a concrete technique a three.js programmer could start on: "the two door leaves
at dollhouse t=22, centre, are flat untextured slabs; give them panelled relief in the shader and
a contact shadow on the plinth".
