import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { generateBuddyLine } from "../gemini.server";

export const getAiBuddyLine = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      event: z.enum(["danger", "narrow", "shield", "coin", "revive", "start"]),
      score: z.number().finite().min(0).max(1_000_000),
      coins: z.number().finite().min(0).max(100_000),
      mapName: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }) => generateBuddyLine(data));
