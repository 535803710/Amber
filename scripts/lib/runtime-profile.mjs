export const RUNTIME_PROFILES = Object.freeze(["core", "full"]);

export function resolveRuntimeProfile(args = [], defaultProfile = "core") {
  const index = args.indexOf("--profile");
  const profile = index === -1
    ? defaultProfile
    : String(args[index + 1] || "").toLowerCase();
  if (!RUNTIME_PROFILES.includes(profile)) {
    throw new Error("--profile 只接受 core 或 full");
  }
  return profile;
}

export function runtimeWatcherLabels(profile) {
  if (!RUNTIME_PROFILES.includes(profile)) {
    throw new Error("profile 只接受 core 或 full");
  }
  return profile === "full"
    ? ["toast", "ui", "records", "commits"]
    : ["records", "commits"];
}
