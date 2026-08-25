# Distributed Pendulum Sim

This distributed sim is comprised of 3 main components.

- A simulation node, who is responsible for a single pendulum simulation 
- A gateway, who will allow communication between nodes, serve the UI, and send location updates to the UI
- A React UI

# Assumptions:

- The number of simulation nodes is between 1 and 50
- The nodes are all running on the same machine
  - They have a synchronized clock
  - There is very low latency between the gateway and nodes (since they are all on localhost) 
- Simulation is running at 120hz
- Ui is updated with the latest locations of the nodes at 60hz


# Quick Start Guide

You will need to have these tools installed 

- `git`
- `npm`
- `nodejs`


```bash
# clone the repo
git clone https://github.com/mendymm/pendulum-assessment.git

cd pendulum-assessment

# run the distributed pendulum
npm install
npm start
```

Open the web-ui at <http://127.0.0.1:8000>

# Gateway

The gateway is the only way for the UI to control the sim nodes, and is responsible for sending update to the UI
with the latest pendulum locations.

# Simulation Node (sim-node)

To accurately model the pendulum the sim node has 2 main responsibilities

A relatively easy job of calculating the pendulum's location over time. This is done with some pure maths.

A more complex job, sending and receiving outside state.
 
1. Allowing the UI (through the gateway) to configure the angle, mass, length, anchor position, wind, and gravity.
2. Keeping an up to date view of all other neighbors, allowing the sim to detect collisions
3. Each time the pendulums location changes notifying the gateway about it


The approach I decided to take is to model the simulation as a state machine,
which lets me reason about the simulation as a pure function which I can easily test. The function looks something like this.

```ts
type Outcome = 
    | { ok, nextSimState, sideEffects } 
    | { rejected, rejectionReason }
function transition(sim: Sim, command: Command): Outcome
```

The simulation is split into a *shell* and a *core*. The *core* is a pure state machine, relying only on it's inputs, and is 100% deterministic. And the *shell* is the rest of the program.

The *shell* can further be split into 2 main components

1. (multiple) *producers* who send *commands* into an in-memory MPSC.
2. (single) *consumer*: The *consumer* holds the simulation state, and for every new *command* sent to the queue, it calls `transition(state,command): Outcome` replacing the old state with the result of `Outcome`. It also executes side effects returned by the state machine (such as sending messages to the ws)

There are 3 "kinds" of *producers*

1. An HTTP control plane, who emit life-cycle events (`start`, `stop`, etc.), and configuration events who change the parameters of a running simulation.
2. A ws listener, who listen's for broadcast messages from other simulations.
3. A timer, who sends out the `tick` command every `N = SimUpdateHz` (which in development I arbitrarily set to 120Hz)


Modeling the simulation like this has 2 main advantages for me

1. (The **Primary** reason). It makes it easier to reason about the simulation.
2. It allows extensive, and thorough testing.


Since the simulation is a state machine, and each time we `transition` the state machine we need to discard the old sim state, and save the new sim state.
And having 3 places who arbitrarily modify a global `sim` variable felt like it would get out of hand, I opted for an in-memory queue approach.

The `transition` function can reject a command. For example, calling `pause` when the simulation is not in it's `running` state is incorrect, and the `transition` function returns a `rejection`.

And you can imagine how if the sim gets a `pause` command over HTTP while the `status` is not `running`, we will be unable to return the `rejection` as an HTTP response.

The solution is kinda annoying, but it still works. The mailbox holds `Envelope`'s, and each envelope as an optional reply callback, allowing the outcome to be communicated back to the HTTP handler, and back to the user who called the endpoint.
```ts
export interface Envelope {
  command: Command;
  reply?: (outcome: Outcome) => void;
}
```

Another thing of note, since `tick` commands get sent to the MPSC at such high frequency, there is a concern that ticks will be processed before higher priority commands. For example, when the ws listener emits a `haltForRestart` event (the gateway's STOP, see [Collision Triggered Restarts](#collision-triggered-restarts)), we don't want the sim to process all the ticks in the inbox before halting the sim.

The solution is to *tightly* couple the MPSC to the `Command` type, and based on `Command.type` send the event into a different buffer, and simply prioritize the non `tick` commands buffer when the "shell" calls `recv`

To see a full list of the commands, please check `packages/sim-node/src/simulation.ts`, I will explain the most important command.

```ts
interface BobPosition {
  nodeId: number;
  anchorX: number;
  x: number;
  y: number;
}
type Command = 
  | ...
  | { type: "tick"; dt: number; worldState: BobPosition[]; now: number };
```

The `tick` command's job it to compute the next state of the pendulum, and once reaching the next state, check for a collision with **any** node (not just nearest neighbor).

The `dt: number` is used in the pendulum's physics to advance the pendulum by a specific amount of Delta Time.
So at a simulation speed of 120Hz, each tick of the simulation will advance the pendulum by `1 / 120 = 0.0083 seconds`.
The timer will calculate the "real" `DT` for tick, taking into account that since the last time it sent a `tick` event more/less time than `DT` might have passed. It uses standard Delta Time correction logic which take into account potential clock drift, or other parts of the event loop taking executing first, etc.

The `worldState` is where this gets a little interesting. Since this simulation is modeled as a state machine, how can the simulation know about its neighbors? Considering that we don't want the simulation reading any global state not passed into it via a command.
Each sim maintains a ws connection with the gateway, which it uses to send location updates (on each tick), and collision notifications.

The gateway keeps an in-memory map of every node's latest location, and on a fixed 120hz cadence it broadcasts that whole map to every node in a single `WorldSnapshot` message (see [Why Use a Gateway](#why-use-a-gateway) for why it sends one snapshot rather than fanning out an event per location). So a sim node receives the entire world in one message per broadcast, ~120/second, no matter how many nodes there are.

To send these updates into the simulation, I considered pushing a command into the MPSC on each `WorldSnapshot` message received on the ws. But that couples the (bursty, high-frequency) ws traffic to the command queue for no real gain — the core only ever looks at its neighbors at `tick` time anyway, and it must not read any global state that wasn't handed to it by a command.

So I ended up going with a `Map<nodeId, PendulumLocation>` that the ws listener replaces wholesale on each `WorldSnapshot` received by the sim node. Then every time the "timer" wakes to send a `tick` event, it takes a snapshot of that map, and passes it into the sim as `worldState: BobPosition[]`


# Collision Triggered Restarts

The spec says 
- "When a collision is detected, send a **STOP message** to all instances" 
- "After a STOP, the simulation should halt. The pendulum sends a **RESTART message** and waits until all instances receive **RESTART messages** from all other instances, at which point each pendulum waits 5 seconds and **restarts**"

I interpret this as: once any node detects a collision, every node halts, they all agree that everyone has stopped, and then — 5 seconds later — they all restart together.

The one liberty I take is the *topology*. The spec describes an all-to-all handshake (every instance hears a RESTART from every other instance). I don't want the nodes talking to each other directly (see [Why Use a Gateway](#why-use-a-gateway) for the O(n²) reason), so I run the same handshake as a **star**, with the gateway as the coordinator. Adding a node is then just one more socket for the gateway to wait on, rather than a new edge in a mesh.

### The barrier

The gateway runs a little state machine for the duration of a collision episode:

```
running ──collisionDetected──▶ collecting-acks ──all acks / timeout──▶ counting-down ──5s──▶ running
```

1. A node's `tick` detects that its bob overlaps another. It halts itself immediately (a new `restarting` state) and sends `collisionDetected` to the gateway.
2. The gateway sets a "collision detected" marker (ignoring any further collisions for this episode), bumps an **episode** counter, snapshots who is connected, and broadcasts `collisionInducedRestart` to everyone. This doubles as the spec's STOP — a node halts the moment it receives it.
3. Each node acks with `collisionAck`, echoing the episode. This is the "RESTART message" — every node confirming it has stopped and is ready.
4. Once the gateway has an ack from every node in the snapshot (the **barrier**), it starts a 5 second countdown, then broadcasts `restart { at }`.
5. Every node — and the UI — restarts at the same absolute instant `at`, so despite any network jitter they all snap back together.

### Decisions and trade-offs

Making the gateway the coordinator means it is now **stateful** for the length of an episode (it used to be a near-dumb relay). In exchange, the "wait for everyone" logic lives in exactly one place, keyed off the number of connected sockets rather than the number `5`.

A pure barrier blocks forever if one node never acks (crash, disconnect, GC pause). I don't want a single stuck node to freeze the whole simulation, so:

- **Ack timeout (`config.ackTimeoutMs`).** If the acks aren't all in within the timeout, the gateway completes the barrier anyway and proceeds with whoever answered. The dropped nodes just miss this restart.
- **Membership snapshot.** "All instances" is the set of nodes connected *when the handshake opens*. A node that connects mid-handshake is ignored until the next episode (otherwise "everyone" is a moving target and the barrier can never close). A node that *disconnects* mid-handshake is dropped from the pending set right away, so the barrier still completes — the ack timeout is only the last resort.

I count the 5 seconds **after** the barrier completes, not from the moment of impact — matching the spec's "waits until all instances receive RESTART messages ... at which point each pendulum waits 5 seconds". And the `restart` message carries an **absolute** timestamp rather than "restart on receipt", so every node lands on the same instant regardless of who got the message first.

The **episode** counter travels on the wire but does *not* fence the nodes' own logic — each node decides what to do purely from its status (`running` / `paused` / `stopped` / `restarting`). That's safe because the gateway serializes episodes (the marker is held until the countdown ends), so a node only ever re-enters `running` at the shared restart instant, and no leftover timer from one episode can bleed into the next. The episode is there so the *gateway* can discard a stale ack from a closed episode, and so the UI can label its countdown.

### Known limitations

- A node that a user had **paused or stopped** still joins the barrier and restarts with everyone else. This follows the spec's "each pendulum restarts" literally, but it does mean a collision elsewhere will relaunch a node you had deliberately stopped. `Stop` while a restart is pending is honored as an escape hatch (the scheduled relaunch then no-ops).
- If two bobs are configured so that they overlap **at rest**, the restart will immediately re-detect a collision and loop. This is inherent to the configuration rather than the protocol, but there is no back-off — the episodes will just keep firing.




# Why Use a Gateway

Early on in the design process I ruled out nodes talking to each other directly. And instead, nodes send messages to a central gateway, who will broadcast the messages to all other nodes.

Consider that to detect collisions between nodes, each node must keep a **very** up to date map of each other node it might collide into. And that **any** node can collide with **any other** node.
One approach I might take is to have a node mesh, where each node talks to every other node. This is O(n^2) and does not scale. At just 50 nodes (see [assumptions](#assumptions)) we would have 1225 connections (and 2450 open sockets)

So having a central gateway solves this problem, each node updates the gateway, the gateway then updates each other node.

The gateway does not broadcast `PendulumLocationUpdate` events. If we have 50 nodes emitting `PendulumLocationUpdate` at 120hz, that would require the gateway to send 294000 ws messages/second.
Instead, the gateway updates an in-memory map, and sends the content of that map to all nodes at 120hz. This results in about the same accuracy as a strict broadcast approach would give us (each node is updated with the location of all other nodes at 120hz). But we only send 6000 events/sec. 

In effect the number of events goes from `O(<N = simCount * simHz>^2)` to `O(<N = simCount * simHz>)`. Please note that we are still `O(N^2)` on the number of bytes we send to each node, but that is much less of an issue, and if we really cared we can easily switch to protobuf, or even just a simple zstd/brotli compression

# Tests

The simulation nodes are modeled as a state machine, allowing me to thoroughly test them, and fuzz them with fast-check.
There are some tests missing due to limited amount of time.

- Testing the gateway's HTTP command broadcast. we would want to regression test that
- Testing the shell non function parts I.E. does a rejected command correctly result in a http response with an error? 
- E2E UI testing
- Some more I forgot to list.


Unlike the rest of the backend code, the test are llm generated by, and I review them, and ensure they are correct before committing.



# Known bugs
Bugs that I found but did not yet have the chance to fix


- If you run `npm start` go to UI and mess with the ghosts, then ctl+x on the server, and start it again, the server does not push up updated ghost locations, and the UI ends up with stale ghost state