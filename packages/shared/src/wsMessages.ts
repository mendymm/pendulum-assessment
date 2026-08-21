import { z } from "zod";

// message sent by the sim-nodes to the gateway, and by the gateway back to the sim-nodes at a frequency of simHz
export const PendulumLocationUpdateSchema = z.object({
  nodeId: z.number(),
  x: z.number(),
  y: z.number(),
  anchorX: z.number(),
});
export type PendulumLocationUpdate = z.infer<typeof PendulumLocationUpdateSchema>;

export const PendulumCollisionUpdateSchema = z.object({
  // the node who detected the collision, and sent the broadcast
  reportingNode: z.number(),
  // the node who was involved in the collision
  otherNode: z.number(),
});

export type PendulumCollisionUpdate = z.infer<typeof PendulumCollisionUpdateSchema>;

export const WsEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PendulumLocationUpdate"), data: PendulumLocationUpdateSchema }),
  z.object({ type: z.literal("PendulumCollisionUpdate"), data: PendulumCollisionUpdateSchema }),
]);

export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

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
