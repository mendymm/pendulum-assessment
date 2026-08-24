/** parse, don't validate ;) */

import { z } from "zod";
import { RUNTIME_CONFIG } from "./config";

export const NodeIdSchema = z.number().nonnegative().max(100).brand<"NodeId">();

// radians from vertical (0 = hanging straight down)
export const AngleSchema = z.number().min(-Math.PI).max(Math.PI).brand<"Angle">();

// in kg
export const MassSchema = z.number().positive().brand<"Mass">();

// in meters
export const LengthSchema = z.number().positive().max(7).brand<"Length">();

// in meters
export const BobRadiusSchema = z.number().positive().brand<"BobRadius">();

// m/s^2
export const GravitySchema = z.number().nonnegative().brand<"Gravity">();

const PendulumConfigShape = z
  .object({
    angle: AngleSchema,
    mass: MassSchema,
    length: LengthSchema,
    anchorX: z.number(),
    wind: z.number(),
    gravity: GravitySchema,
  })
  .strict();

// all required, used in the Sim type
export const PendulumConfigSchema = PendulumConfigShape;

// all optional, used in the patch request
export const PendulumConfigPatchSchema = PendulumConfigShape.partial();

export const SimStatusSchema = z.enum(["running", "paused", "stopped", "restarting", "countdown", "collided"]);

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const SimSnapshotSchema = z.object({
  nodeId: NodeIdSchema,
  config: PendulumConfigSchema,
  status: SimStatusSchema,
  posistion: PointSchema,
  bobRadius: BobRadiusSchema,
  commandsCompleted: z.record(z.string(), z.number()),
  commandsRejected: z.record(z.string(), z.number()),
  generation: z.number(),
});

export const CollisionSchema = z.object({
  reportingNode: NodeIdSchema,
  with: NodeIdSchema,
  timestamp: z.number(),
});

// websocket message types

export const PendulumLocationSchema = z.object({
  nodeId: NodeIdSchema,
  bobRadius: BobRadiusSchema,
  posistion: PointSchema,
  anchorX: z.number(),
});

export const WsEnvelopeSchema = z.discriminatedUnion("type", [
  // node → gateway: one node's latest position
  z.object({ type: z.literal("PendulumLocationUpdate"), data: PendulumLocationSchema }),
  // gateway → nodes: every node's latest position, in a single message
  z.object({ type: z.literal("WorldSnapshot"), data: z.array(PendulumLocationSchema) }),
  // both directions: a collision report
  z.object({ type: z.literal("PendulumCollisionUpdate"), data: CollisionSchema }),
]);

export type BobRadius = z.infer<typeof BobRadiusSchema>;
export type Point = z.infer<typeof PointSchema>;
export type PendulumConfigPatch = z.infer<typeof PendulumConfigPatchSchema>;
export type PendulumConfig = z.infer<typeof PendulumConfigSchema>;
export type Angle = z.infer<typeof AngleSchema>;
export type Mass = z.infer<typeof MassSchema>;
export type Length = z.infer<typeof LengthSchema>;
export type Gravity = z.infer<typeof GravitySchema>;
export type NodeId = z.infer<typeof NodeIdSchema>;
export type SimStatus = z.infer<typeof SimStatusSchema>;
export type SimSnapshot = z.infer<typeof SimSnapshotSchema>;
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;
export type PendulumLocation = z.infer<typeof PendulumLocationSchema>;
export type Collision = z.infer<typeof CollisionSchema>;

export function defaultPendulumConfig(nodeId: number): PendulumConfig {
  return PendulumConfigSchema.parse({
    angle: 0.7,
    length: 3.5,
    mass: 5,
    anchorX: nodeId * 5,
    wind: 0,
    gravity: 9.81,
  });
}

// uniform sample in [min, max)
const between = (min: number, max: number) => min + Math.random() * (max - min);

// spacing between adjacent nodes' default anchors (matches defaultPendulumConfig)
const NODE_SPACING = 5;

// Randomize within *sensible* ranges so pendulums stay visible and behave: no
// hair-thin strings, no absurd masses, gravity near Earth-ish, gentle wind. The
// anchor jitters around this node's slot (nodeId * NODE_SPACING) so nodes stay
// roughly in place rather than scattering across the plane.
export function randomPendulumConfig(nodeId: number): PendulumConfig {
  return PendulumConfigSchema.parse({
    angle: between(-Math.PI / 2, Math.PI / 2), // drop angle within ±90° of vertical
    mass: between(2, 20), // kg — a plausible, well-sized bob
    length: between(1.5, 5), // m — LengthSchema caps at 7
    anchorX: nodeId * NODE_SPACING + between(-1.5, 1.5), // jitter around this node's slot
    wind: between(-3, 3), // gentle sideways force
    gravity: between(8, 12), // m/s² — Earth-ish
  });
}

const BOB_DENSITY = RUNTIME_CONFIG.maxBobR / Math.sqrt(RUNTIME_CONFIG.maxBobMass);

// meters
export function bobRadius(mass: Mass): BobRadius {
  return BobRadiusSchema.parse(Math.min(BOB_DENSITY * Math.sqrt(mass), RUNTIME_CONFIG.maxBobR));
}

export function parseWsEnvelope(raw: string): WsEnvelope | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = WsEnvelopeSchema.safeParse(json);
  return result.success ? result.data : null;
}
