/**
 * `configure` accepted-path behavior. configure is accepted from *every* status
 * (the generic ./simulation.transitions.test.ts owns that outcome and the counter
 * bumping) — this file pins down what an accepted configure does to the sim:
 *
 *   - merges the (partial) patch over config, leaving unpatched fields alone;
 *   - status is never changed;
 *   - the bob is only disturbed when the *launch angle* changes: a new angle drops
 *     it from rest there (velocity zeroed); any other change leaves the bob as-is;
 *   - no effects.
 *
 * Patches are built through PendulumConfigPatchSchema so the branded/validated
 * shape matches what the real control plane would hand `transition`.
 */

import { PendulumConfigPatchSchema } from "@pendulum/shared/src/types";
import { describe, expect, it } from "vitest";
import { transition } from "../simulation";
import { ALL_STATUSES, movingSim, simInState } from "./testSupport";

describe("configure command", () => {
  it("merges the patch over config, leaving unpatched fields and the bob untouched, no effects", () => {
    const moving = movingSim();
    const patch = PendulumConfigPatchSchema.parse({ wind: moving.config.wind + 3 });
    const out = transition(moving, { type: "configure", config: patch });

    expect(out.result).toBe("ok");
    expect(out.sim.status).toBe(moving.status); // configure never changes status
    expect(out.sim.config).toEqual({ ...moving.config, wind: moving.config.wind + 3 });
    expect(out.sim.pendulumState).toEqual(moving.pendulumState); // non-angle change: bob untouched
    if (out.result === "ok") expect(out.effects).toEqual([]);
  });

  it("drops the bob from rest at the new angle when the launch angle changes", () => {
    const moving = movingSim();
    const newAngle = 0.3; // ≠ the default launch angle (0.7)
    expect(moving.config.angle).not.toBe(newAngle);
    expect(moving.pendulumState.angularVelocity).not.toBe(0); // it's swinging before we reconfigure

    const patch = PendulumConfigPatchSchema.parse({ angle: newAngle });
    const { sim } = transition(moving, { type: "configure", config: patch });

    expect(sim.config.angle).toBe(newAngle);
    expect(sim.pendulumState).toEqual({ angle: newAngle, angularVelocity: 0 });
  });

  it("leaves the bob alone when the patched angle equals the current angle", () => {
    const moving = movingSim();
    const patch = PendulumConfigPatchSchema.parse({ angle: moving.config.angle });
    const { sim } = transition(moving, { type: "configure", config: patch });

    expect(sim.pendulumState).toEqual(moving.pendulumState); // unchanged angle → velocity preserved
  });

  it("is a no-op on state for an empty patch", () => {
    const moving = movingSim();
    const { sim } = transition(moving, { type: "configure", config: {} });

    expect(sim.config).toEqual(moving.config);
    expect(sim.pendulumState).toEqual(moving.pendulumState);
  });

  it("applies from every status without changing status", () => {
    for (const status of ALL_STATUSES) {
      const before = simInState(status);
      const patch = PendulumConfigPatchSchema.parse({ wind: before.config.wind + 1 });
      const { result, sim } = transition(before, { type: "configure", config: patch });

      expect(result).toBe("ok");
      expect(sim.status).toBe(status);
      expect(sim.config.wind).toBe(before.config.wind + 1);
    }
  });
});
