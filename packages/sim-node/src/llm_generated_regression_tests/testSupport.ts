import {
  type Angle,
  type Gravity,
  type Length,
  type Mass,
  type NodeId,
  type PendulumConfig,
  type PendulumConfigPatch,
  type SimStatus,
  SimStatusSchema,
} from "@pendulum/shared/src/types";
import fc from "fast-check";
import { createSim, type Sim } from "../simulation";

// arbitrary launch angle within the domain's [-PI, PI] bound
export const angle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }) as fc.Arbitrary<Angle>;

// arbitrary angular velocity, so we can watch whether a command resets it
export const velocity = fc.double({ min: -100, max: 100, noNaN: true });

// arbitrary values for the remaining config fields, kept within the domain's bounds
const mass = fc.double({ min: 0.1, max: 100, noNaN: true }) as fc.Arbitrary<Mass>;
const length = fc.double({ min: 0.1, max: 7, noNaN: true }) as fc.Arbitrary<Length>;
const gravity = fc.double({ min: 0, max: 20, noNaN: true }) as fc.Arbitrary<Gravity>;
const anchorX = fc.double({ min: -50, max: 50, noNaN: true });
const wind = fc.double({ min: -10, max: 10, noNaN: true });

// an arbitrary partial config patch: each field is independently present or absent
export const configPatch: fc.Arbitrary<PendulumConfigPatch> = fc.record(
  { angle, mass, length, gravity, anchorX, wind },
  { requiredKeys: [] },
);

// every possible sim status: running | paused | stopped
export const status: fc.Arbitrary<SimStatus> = fc.constantFrom(...SimStatusSchema.options);

// a config with an arbitrary launch angle; other fields are left at their defaults
export const configWithAngle = (a: Angle): PendulumConfig => ({ ...createSim(0 as NodeId).config, angle: a });

// an arbitrary sim carrying a (possibly nonzero) angular velocity
export const simWith = (a: Angle, angularVelocity: number, status: Sim["status"] = "running"): Sim => ({
  ...createSim(0 as NodeId),
  config: configWithAngle(a),
  pendulumState: { angle: a, angularVelocity },
  status,
});
