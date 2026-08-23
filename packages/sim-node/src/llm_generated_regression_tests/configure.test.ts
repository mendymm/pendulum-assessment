import type { Angle, PendulumConfig, PendulumConfigPatch } from "@pendulum/shared/src/types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, transition } from "../simulation";
import { angle, configPatch, simWith, status, velocity } from "./testSupport";

const configure = (patch: PendulumConfigPatch): Command => ({ type: "configure", config: patch });

const configKeys = [
  "angle",
  "mass",
  "length",
  "anchorX",
  "wind",
  "gravity",
] as const satisfies (keyof PendulumConfig)[];

describe("configure", () => {
  it("resets angular velocity when the launch angle changes", () => {
    fc.assert(
      fc.property(angle, angle, velocity, (current, next, v) => {
        fc.pre(current !== next); // the property is about a *changed* angle

        const sim = simWith(current, v);
        const { sim: after } = transition(sim, configure({ angle: next }));

        expect(after.pendulumState.angularVelocity).toBe(0);
        expect(after.config.angle).toBe(next); // and the new angle is applied
      }),
    );
  });

  it("preserves angular velocity when the angle is unchanged or absent", () => {
    fc.assert(
      fc.property(angle, velocity, fc.boolean(), (a, v, includeAngle) => {
        const sim = simWith(a, v);
        // patch either omits angle, or sets it to the *same* value — neither should reset velocity
        const patch: PendulumConfigPatch = includeAngle ? { angle: a } : { mass: sim.config.mass };
        const { sim: after } = transition(sim, configure(patch));

        expect(after.pendulumState.angularVelocity).toBe(v);
      }),
    );
  });

  it("applies patched fields and leaves the rest untouched", () => {
    fc.assert(
      fc.property(angle, configPatch, (a, patch) => {
        const sim = simWith(a, 0);
        const { sim: after } = transition(sim, configure(patch));

        for (const key of configKeys) {
          // a field present in the patch takes the patched value, otherwise it's carried over
          const expected = key in patch ? patch[key] : sim.config[key];
          expect(after.config[key]).toBe(expected);
        }
      }),
    );
  });

  it("is accepted from every status", () => {
    fc.assert(
      fc.property(status, angle, configPatch, (s, a, patch) => {
        const outcome = transition(simWith(a, 0, s), configure(patch));
        expect(outcome.result).toBe("ok");
      }),
    );
  });

  it("never changes the status", () => {
    fc.assert(
      fc.property(status, angle, configPatch, (s, a, patch) => {
        const sim = simWith(a, 0, s);
        const { sim: after } = transition(sim, configure(patch));
        expect(after.status).toBe(s);
      }),
    );
  });

  it("is a no-op for an empty patch", () => {
    const sim = simWith(0.5 as Angle, 3.2);
    const { sim: after } = transition(sim, configure({}));

    expect(after.config).toEqual(sim.config);
    expect(after.pendulumState).toEqual(sim.pendulumState);
  });
});
