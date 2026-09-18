import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { requireApiUser } from "@/lib/auth";

/** The Chrome extension (the `extension/` folder) as a zip, for "Load unpacked". */
export async function GET() {
  const { error } = await requireApiUser();
  if (error) return error;
  const dir = path.join(process.cwd(), "extension");
  const files: Record<string, Uint8Array> = {};
  for (const name of await readdir(dir)) {
    // Files sit at the zip's root: Windows "Extract All" already creates a folder named after the zip,
    // and a second folder inside it leaves manifest.json one level below the folder people select.
    files[name] = new Uint8Array(await readFile(path.join(dir, name)));
  }
  return new Response(Buffer.from(zipSync(files, { level: 6 })), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="collabglam-email-reveal.zip"',
      "Cache-Control": "no-store",
    },
  });
}
