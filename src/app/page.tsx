import { Checker } from "@/components/Checker";
import { getContent } from "./content";
import { MAX_COPY_LENGTH } from "./limits";

// Rendered on the server: reads the rules file and the test set, then hands
// the samples to the interactive checker. The API key stays on the server;
// the page only learns whether AI checks are available.
export default function Home() {
  const { rules, samples } = getContent();
  return (
    <Checker
      samples={samples}
      rulesVersion={rules.version}
      ruleCount={rules.rules.length}
      aiAvailable={Boolean(process.env.ANTHROPIC_API_KEY?.trim())}
      maxLength={MAX_COPY_LENGTH}
    />
  );
}
