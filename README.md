# Distributed Pendulum Sim

This distributed sim is comprised of 3 main components.

- A simulation node, who is responsible for a single pendulum simulation 
- A gateway, who will allow communication between nodes, serve the UI, and send location updates to the UI
- A React UI

Assumptions:

The assignment specified 5 node, and noted that we want to make the number of nodes configurable.
I will assume that the upper bound on the number of nodes is 50, and working from this assumption, my design decisions will make more sense.

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

The easy part. Calculating the pendulums location over time. This is done with some pure maths.

The fun part. Reacting to outside change, and talking to the outside world
 
1. Allowing the UI (through the gateway) to configure the angel, mass, length, anchor position, wind, and gravity.
2. Keeping an up to date view of all other neighbors, allowing the sim to detect collisions
3. Each time the pendulums location changes notifying the gateway about it


The approach I decided to take is to model the simulation node as a state machine,
which lets me reason about the simulation as a pure function which I can easily test, it looks something like this

```ts
type Outcome = 
    | { ok, nextSimState, sideEffects } 
    | { rejected, rejectionReason }
function transition(sim: Sim, command: Command): Outcome
```

Then in a "shell" loop I call the `transition` function with the current sim state, and replace the current state with the newly returned state.

And since the sim needs to update the gateway with the sim current location, and to announce a collision. The sim returns a list of side effects from each transition of the state machine.
The effects are then executed by the "shell".

Modeling the simulation like this has 2 main advantages for me

1. (The **Primary** reason). It makes it easier to reason about the simulation.
2. It allows extensive, and thorough testing.

There are 3 different sources of a `Command`

1. An HTTP control plane, who emit life-cycle events (`start`, `stop`, etc.), and configuration events who change the parameters of a running simulation.
2. A ws listener, who listen's for `PendulumCollisionUpdate` events to be sent from the gateway
3. A timer, who sends out the `tick` command every `N = SimUpdateHz` (which in development I arbitrarily set to 120Hz)

Since the simulation is a state machine, and each time we `transition` the state machine we need to discard the old sim state, and save the new sim state.
And having 3 places who arbitrarily modify a global `sim` variable felt like it would get out of hand, I opted for an in-memory queue approach.

The queue is an MPSC (multi producer, single consumer) queue, every 3 of the above "command emitters" send to the `inbox`, and the "shell" will loop through each `Command` in the inbox, call `transition(sim, commandFromQueue)`, and update `sim = simFromTransisionStep` for the next iteration of the loop.

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


# Collision Detection 


# Tests

The simulation nodes are modeled as a state machine, allowing me to thoroughly test them with fast-check.
Unlike the rest of the backend code, the test are 100% generated by claude, and I review them before committing.