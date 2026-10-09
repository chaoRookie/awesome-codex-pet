// Shared by the website, its exported catalog, and README generation.
export function npmInstallCommand(slug, ref = "main") {
  if (
    slug !== "<pet-slug--author-slug>" &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  )
    throw new Error("Invalid pet id for install command");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes(".."))
    throw new Error("Invalid install ref");
  const source =
    ref === "main"
      ? ""
      : ` --raw-base https://raw.githubusercontent.com/legeling/awesome-codex-pet/${ref}`;
  return `npx --yes @legeling/codex-pet install ${slug}${source}`;
}
