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

# Simulation Node (sim-ndoe)

To acutely model the pendulum the sim node has 2 main responsibilities

A relatively easy job of calculating the pendulum's location over time. This is done with some pure maths.

A more complex job, sending and receiving outside state.
 
1. Allowing the UI (through the gateway) to configure the angel, mass, length, anchor position, wind, and gravity.
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

The `transition` function can reject a command. For example, calling `pasue` when the simulation is not in it's `running` state is incorrect, and the `transition` function returns a `rejection`.

And you can imagine how if the sim gets a `pause` command over HTTP while the `status` is not `running`, we will be unable to return the `rejection` as an HTTP response.

The solution is kinda annoying, but it still works. The mailbox holds `Envelope`'s, and each envelope as an optional reply callback, allowing the outcome to be communicated back to the HTTP handler, and back to the user who called the endpoint.
```ts
export interface Envelope {
  command: Command;
  reply?: (outcome: Outcome) => void;
}
```

Another thing of note, since `tick` commands get sent to the MPSC at such high frequency, there is a concern that ticks will be processed before higher priority commands. For example, when the ws listener emits a `collision` event, we don't want the sim to process all the ticks in the inbox before stopping the sim.

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
  | { type: "tick"; dt: number; worldState: BobPosition[] };
```

The `tick` command's job it to compute the next state of the pendulum, and once reaching the next state, check for a collision with **any** node (not just nearest neighbor).

The `dt: number` is used in the pendulum's physics to advance the pendulum by a specific amount of Delta Time.
So at a simulation speed of 120Hz, each tick of the simulation will advance the pendulum by `1 / 120 = 0.0083 seconds`.
The timer will calculate the "real" `DT` for tick, taking into account that since the last time it sent a `tick` event more/less time than `DT` might have passed. It uses standard Delta Time correction logic which take into account potential clock drift, or other parts of the event loop taking executing first, etc.

The `worldState` is where this gets a little interesting. Since this simulation is modeled as a state machine, how can the simulation know about its neighbors? Considering that we don't want the simulation reading any global state not passed into it via a command.
Each sim maintains a ws connection with the gateway, which it uses to send location updates (on each tick), and collision notifications.

The gateway will fanout/broadcast the location updates to all other sim nodes, and each sim node will receive `PendulumLocationUpdate` from its neighbors at a rate of `(<SimUpdateHz = 120> * (<SimCount = 5> - 1)) = 480 / second`.

To send these updates into the simulation, I considered sending a `PendulumLocationUpdate` command into the simulation on each `PendulumLocationUpdate` message received on the ws. This immediately does not work, if we increase the node count to 25 (half of what I am considering the upper bound) we will jump the number of commands send to out MPSC from ~120/sec to 3000, so this is nonstarter.

I ended up going with a global `Map<nodeId,PendulumLocationUpdate>` and updating it on each `PendulumLocationUpdate` received by the sim node. Then every time the "timer" wakes to send a `tick` event, it takes a snapshot of the global map, and passes it into the sim as `worldState: BobPosition[]`


# Collision Triggered Restarts

The spec says 
- "When a collision is detected, send a **STOP message** to all instances" 
- "After a STOP, the simulation should halt. The pendulum sends a **RESTART message** and waits until all instances receive **RESTART messages** from all other instances, at which point each pendulum waits 5 seconds and **restarts**"

I interpret this as the following.

*Once a collision is detected, all nodes must stop. And after 5 seconds, they should all restart.*

My implementation achieves the outcome the spec is looking for, without following the letter of the spec.

I don't want the nodes to directly talk to each other (see [Why Use a Gateway](#why-use-a-gateway) for why). So the collision induced restart is not sent directly from the node who detected the collision to all other nodes.




# Why Use a Gateway

Early on in the design process I ruled out nodes talking to each other directly. And instead, nodes send messages to a central gateway, who will broadcast the messages to all other nodes.

Consider that to detect collisions between nodes, each node must keep a **very** up to date map of each other node it might collide into. And that **any** node can collide with **any other** node.
One approach I might take is to have a node mesh, where each node talks to every other node. This is O(n^2) and does not scale. At just 50 nodes (see [assumptions](#assumptions)) we would have 1225 connections (and 2450 open sockets)

So having a central gateway solves this problem, each node updates the gateway, the gateway then updates each other node.

The gateway does not broadcast `PendulumLocationUpdate` events. If we have 50 nodes emiting `PendulumLocationUpdate` 120hz, that would required the gateway to send 294000 ws messages/second.
Instead, the gateway updates an in-memory map, and sends the content of that map to all nodes at 120hz. This results in about the same acuuracy as the a strict broadcast appraoch would give us (each node is updated with the location of all other nodes at 120hz). But we only send 6000 events/sec. 

If effect the number of events goes from `O(<N = simCount * simHz>^2)` to `O(<N = simCount * simHz>)`. Please note that the we are still `O(N^2)` on the number of bytes we send to each node, but that is much less of a issue, and if we really cared we can easly switch to protobuf, or even just a simple zstd/brotli compression

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