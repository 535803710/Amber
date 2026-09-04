import { formatCliResult } from "../../lib/cli-result.mjs";
import { runSpace } from "../../lib/space.mjs";

export async function run(request) {
  return formatCliResult(await runSpace(request));
}
