

- use hono for web server
- UI will create SVG of the pendulum state, if we want to increase pendulum number to 50+ pendulum we should switch to canvas
- UI will use color/icon to communicate the pendulum's mass (instead of using a larger bob radius)

# Neighbor Monitoring

The spec says "Make each pendulum aware of its neighbors and monitor their positions"

I will interpret this as each server can talk to it's 2 adjacent neighbors, this is also the more reasonable approach

1. Allowing each node to talk to each other node will result in O(n^2)
2. It does not make sense for node 1 to collide with node 5, so there is no reason for node 1 and 5 to talk to each other



# simulation

Wind will be a horizontal force applied on the pendulum.


# sim node api

POST /start includes the configuration of the pendulum
POST /pause /resume (start/resume the simulation)
GET /snapshot return a snapshot of the simulation, along with the config
POST /configure configure a running simulation





TODO:
- fix the relative path include in the gateway UI dist
- write tests for 
    1. sim inital startup state
    2. sim keeps state between pause/resume
    3. sim correctly resets the pendulum state on