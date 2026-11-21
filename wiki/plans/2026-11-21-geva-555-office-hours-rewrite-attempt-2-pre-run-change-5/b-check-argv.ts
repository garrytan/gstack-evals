// Prints the Sol arm's exec argv after the binary and the lane's launch script, as run/codex.ts builds them, for a stub at
// the given base URL, with Codex's directory moved to the given one. Run from the repository root.
const { solArgv, codexLaunch } = await import(process.cwd() + "/lanes/office-hours-rewrite/run/codex.ts");
const { CODEX } = await import(process.cwd() + "/lanes/office-hours-rewrite/frozen.ts");
const proxy = { baseUrl: process.argv[2]!, slot: "check", token: "gse_stub-not-a-key" };
console.log(JSON.stringify({ argv: solArgv({ proxy }, null), launch: (codexLaunch([])[2] as string).replaceAll(CODEX.path_dir, process.argv[3]!) }));
