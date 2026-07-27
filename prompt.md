# The prompt

This repository is a test of the [Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty)
prompt pattern on a target where the quality bar is actually reachable. The original
prompt asked for a Call of Duty-grade FPS; its own README admits every blind critic
picked the real game. We adapted the prompt using that repo's two process lessons:
sequential single-owner passes beat parallel fan-out, and critics must review
reproducible captures.

```
Build an Arkanoid/Breakout at the level of a modern commercial arcade remake
(Arkanoid: Eternal Battle, Shatter). Single HTML file territory, no assets —
every pixel and sound from code.

One owner writes the whole game (no parallel fan-out — coupled visual systems
break under split ownership). Then /loop a harsh-critic pass: three separate
sub-agent critics with distinct lenses (composition/color, game-feel juice,
HUD/typography) review deterministic screenshots against the commercial bar,
tag defects FRAME-RUINING / MAJOR / MINOR, and demand concrete fixes. Apply
the consensus fixes as a single owner, re-capture, re-score. Critics must
grade against the bar, not against improvement, and must call out any claimed
fix that didn't land in the pixels. Loop until the score plateaus, then
report the honest final number.
```
