import { npmInstallCommand } from "../../scripts/install-command.mjs";
export const INSTALL_PLACEHOLDER = "<pet-slug--author-slug>";
const requestedInstallRef =
  process.env.NEXT_PUBLIC_INSTALL_REF?.trim() || "main";
if (
  !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(requestedInstallRef) ||
  requestedInstallRef.includes("..")
) {
  throw new Error("NEXT_PUBLIC_INSTALL_REF contains unsafe characters");
}
const installRef = requestedInstallRef;
export const NPM_INSTALL_COMMAND = npmInstallCommand(
  INSTALL_PLACEHOLDER,
  installRef,
);
export const INTERACTIVE_COMMAND = "npx @legeling/codex-pet";
export const GLOBAL_INSTALL_COMMAND = "npm install -g @legeling/codex-pet";

export function getPetInstallCommands(slug: string) {
  return {
    npm: npmInstallCommand(slug, installRef),
  };
}
