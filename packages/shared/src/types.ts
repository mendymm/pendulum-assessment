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

export const SimStatusSchema = z.enum(["running", "paused", "stopped", "restarting", "countdown"]);

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
  commandsCompleted: z.number(),
  commandsRejected: z.number(),
});

// websocket message types

export const PendulumLocationSchema = z.object({
  nodeId: NodeIdSchema,
  bobRadius: BobRadiusSchema,
  posistion: PointSchema,
  anchorX: z.number(),
});

export const PendulumCollisionUpdateSchema = z.object({
  // the node who detected the collision, and sent the broadcast
  reportingNode: z.number(),
  // the node who was involved in the collision
  otherNode: z.number(),
});

export const WsEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PendulumLocationUpdate"), data: PendulumLocationSchema }),
  z.object({ type: z.literal("PendulumCollisionUpdate"), data: PendulumCollisionUpdateSchema }),
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
export type PendulumCollisionUpdate = z.infer<typeof PendulumCollisionUpdateSchema>;
export type PendulumLocation = z.infer<typeof PendulumLocationSchema>;

export function defaultPendulumConfig(nodeId: number): PendulumConfig {
  return PendulumConfigSchema.parse({
    angle: 0,
    length: 1.5,
    mass: 5,
    anchorX: nodeId,
    wind: 0,
    gravity: 9.81,
  });
}

// uniform sample in [min, max)
const between = (min: number, max: number) => min + Math.random() * (max - min);

export function randomPendulumConfig(): PendulumConfig {
  return PendulumConfigSchema.parse({
    angle: between(-Math.PI, Math.PI), // AngleSchema: [-π, π]
    mass: between(0.1, 100), // MassSchema: positive
    length: between(0.1, 7), // LengthSchema: positive, ≤ 7
    anchorX: between(-50, 50), // unbounded number
    wind: between(-10, 10), // unbounded number
    gravity: between(0, 20), // GravitySchema: non-negative
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

