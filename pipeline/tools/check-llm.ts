import { z } from "zod";
import { LLM } from "../config.ts";
import { generate } from "../llm.ts";

/**
 * A one-call preflight per pass, so a misconfigured key or model is found in
 * seconds rather than after two minutes of collection.
 */
const Probe = z.object({
  ok: z.boolean().describe("Always true."),
  word: z.string().describe("The single word: ready"),
});

async function main(): Promise<void> {
  console.log("");
  let failed = false;

  for (const pass of ["triage", "select"] as const) {
    const { provider, model, effort } = LLM[pass];
    process.stdout.write(`  ${pass.padEnd(7)} ${provider}/${model} (effort ${effort}) … `);
    try {
      const result = await generate({
        pass,
        schema: Probe,
        schemaName: "Probe",
        system: "You are a connectivity probe. Answer exactly as instructed.",
        user: 'Return ok=true and word="ready".',
      });
      console.log(`OK — ${JSON.stringify(result)}`);
    } catch (error) {
      failed = true;
      console.log(`FAILED\n           ${(error as Error).message.slice(0, 300)}`);
    }
  }

  console.log("");
  if (failed) {
    console.log("  Set MODEL_API_KEY for Meta, or LLM_PROVIDER=anthropic to use Claude.\n");
    process.exitCode = 1;
  }
}

main();
