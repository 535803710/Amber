#!/usr/bin/env node

import { runAmberCli } from "../scripts/cli/main.mjs";

const { exitCode } = await runAmberCli(process.argv.slice(2));
process.exitCode = exitCode;
