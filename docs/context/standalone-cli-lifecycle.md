# Standalone CLI lifecycle

The packaged `praxity.mjs` is a small bootstrap. It installs Studio's stop
handlers before importing the command module. The build keeps that module in a
separate ESM chunk so DOM runtime initialization cannot delay the handlers.

The first INT, TERM, HUP or QUIT owns the exit status, using 128 plus the signal
number. Repeated signals do not restart the ten-second shutdown allowance. That
allowance includes startup. Shutdown stops request admission, cancels exports,
drains admitted operations, and attempts session and preview cleanup independently
of HTTP close callbacks. Errors are reported after the cleanup attempts settle.
A genuinely hung operation can exceed the deadline and leave temporary files.

On Unix, a direct foreground start watches its original parent every second.
An initial parent of PID 1 is supported for init and launchd starts. Windows
uses IPC disconnect when that channel exists. Without IPC, it probes whether
the creator PID still exists; this is best effort because PIDs can be reused.

Launchers that need to cover death before Studio's first instruction must retain
their identity or lifetime across startup. A Node launcher can spawn with an IPC
stdio entry. Studio treats that channel's disconnect as HUP, including an already
closed channel. A Unix launcher can instead set `PRAXITY_PARENT_PID` to its own
PID in the child's environment. It must set the value for each spawn and keep
that process as Studio's direct parent. Studio rejects malformed PID values and
compares the expected parent before loading the command module.
The bootstrap consumes and removes `PRAXITY_PARENT_PID` before loading that
module, for every invocation, so browsers, export tools and other descendants
inherit no launcher identity. The captured value still drives parent checks.

Without either contract, an already orphaned process cannot distinguish its
adoptive parent from a legitimate launchd/init start. The fallback watcher covers
parent death after the bootstrap captures its parent. The toolkit must supply
one of these contracts to cover its earliest startup race.
