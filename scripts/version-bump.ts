// Run through `bun pm version <x>`: copies the package.json version into manifest.json and versions.json.
const root = new URL("..", import.meta.url);
const pkg = (await Bun.file(new URL("package.json", root)).json()) as { version: string };
const targetVersion = process.env.npm_package_version ?? pkg.version;

const manifestFile = Bun.file(new URL("manifest.json", root));
const manifest = (await manifestFile.json()) as { version: string; minAppVersion: string };
manifest.version = targetVersion;
await Bun.write(manifestFile, JSON.stringify(manifest, null, 4) + "\n");

const versionsFile = Bun.file(new URL("versions.json", root));
const versions = (await versionsFile.json()) as Record<string, string>;
versions[targetVersion] = manifest.minAppVersion;
await Bun.write(versionsFile, JSON.stringify(versions, null, 4) + "\n");
