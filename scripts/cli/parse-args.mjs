export function parseCliArgs(argv = []) {
  const tokens = [...argv];
  const flags = {
    json: false,
    help: false,
    target: null,
    userHome: null,
    skipLive: false,
    skipOpen: false,
    skipSystem: false,
    skipSpace: false
  };
  const positional = [];
  const extras = {};

  while (tokens.length) {
    const token = tokens.shift();
    if (token === "--json") {
      flags.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      flags.help = true;
      continue;
    }
    if (token === "--skip-live") {
      flags.skipLive = true;
      continue;
    }
    if (token === "--skip-open") {
      flags.skipOpen = true;
      continue;
    }
    if (token === "--skip-system") {
      flags.skipSystem = true;
      continue;
    }
    if (token === "--skip-space") {
      flags.skipSpace = true;
      continue;
    }
    if (token === "--target" || token === "--user-home") {
      const value = tokens.shift();
      if (!value || value.startsWith("-")) {
        throw new Error(`${token} 需要一个路径参数。`);
      }
      if (token === "--target") flags.target = value;
      else flags.userHome = value;
      continue;
    }
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = tokens[0];
      extras[name] = next && !next.startsWith("-") ? tokens.shift() : true;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`未知选项：${token}`);
    }
    positional.push(token);
  }

  return {
    command: positional[0] || "help",
    subcommand: positional[1] || "",
    args: positional.slice(2),
    rest: positional.slice(1),
    positional,
    flags,
    extras
  };
}
