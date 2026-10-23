# Print focus return

Settled in October 2026 for choice and highlight practice.

The shared owner captures the focused activity control on print entry. It also captures a native focusout while print media matches: Chromium can hide a control before delivering the media change. Screen-media exit restores that connected, enabled control only while focus remains on the document body/root. Later focus, keyboard or pointer input, page exit and mount destruction cancel the return. The owner never starts printing or changes content, disclosure state or learner state.

The earlier media-change/beforeprint capture missed Chromium's earlier CSS blur. Keeping only afterprint also misses emulated print and browsers that order screen styles later. Both media and print events share one capture, avoiding replacement with body focus.

Regression checks cover event order, CSS blur before media delivery, later input and teardown. Browser checks wait for both native print-media transitions; an emulation command can resolve before its change event is delivered.

A failed platform listener registration removes every partial registration before rethrowing. Explicit cleanup cancels a captured return even if the activity remains connected.
