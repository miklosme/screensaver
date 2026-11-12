# Direction

The owner's channel into the loop. The director reads this at the start of every pass.

## From the owner

```
let's make the rail more smooth

there should be one rail, that have interesting loops, with good variety to have the animation interesting

then segment this rail into four pieces, i'd call them spring, summer, fall, and winter segments

each seson have it's own index, and scenes when more then 4 of them, can be togged on the same rail (if index is seven, then 7 % 4 = 3 means the 7. scene goes on to the currently playing fall season)

once the new rail system is in place, existing four scenes needs to be aligned with it

then use fable 5.2 subagents to give up a new scene design, then use opus 5.5 subagents to implement it

think about how to make the fable 5.2 designer agent creative: how do you add enthropy to the kick off prompt?
```

Clarifications to the note above, from the owner on 2026-11-12:

- The index example was a mistake. Indices count from zero and `index % 4` picks the season:
  0 spring, 1 summer, 2 fall, 3 winter. The seventh scene is index 6, so it rides fall.
- "the new rail should be designed fresh": its shape is a new design, with loops and variety,
  not the four existing tracks joined end to end.
- "i'd love to see the original four scenes again on the new rail system": helix, burrow,
  dollhouse and orbit stay in the show, each rebuilt around its season's segment while keeping
  the premise and palette `DESIGN.md` gives it.

## Questions for the owner

The director writes here when something needs a decision only the owner can make, such as
raising a budget or changing something `DESIGN.md` lists as fixed. The loop carries on with
other work in the meantime.

## Handled

Notes the director has acted on, each with the pass number.
