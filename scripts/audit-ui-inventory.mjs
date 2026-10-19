// Source inventory, not a substitute for behavioral or authorization testing.
import ts from "typescript";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
async function files(dir) {
  const all = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) all.push(...(await files(path)));
    else if (path.endsWith(".tsx")) all.push(path);
  }
  return all;
}
const root = resolve(new URL("..", import.meta.url).pathname),
  inventory = [];
for (const path of [
  ...(await files(join(root, "app"))),
  ...(await files(join(root, "components"))),
]) {
  const source = ts.createSourceFile(
    path,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (
        [
          "form",
          "ActionForm",
          "ConfirmedAdminForm",
          "button",
          "Link",
          "input",
          "select",
          "textarea",
          "summary",
          "FileDownload",
          "FileUpload",
          "Submit",
        ].includes(tag)
      ) {
        const attributes = {};
        for (const a of node.attributes.properties)
          if (
            ts.isJsxAttribute(a) &&
            [
              "action",
              "href",
              "name",
              "type",
              "aria-label",
              "submitLabel",
              "onClick",
              "onChange",
              "method",
            ].includes(a.name.text)
          )
            attributes[a.name.text] = a.initializer?.getText(source) ?? true;
        inventory.push({
          file: path.slice(root.length + 1),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          element: tag,
          attributes,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const output = resolve(
  process.argv.find((v) => v.startsWith("--output="))?.slice(9) ??
    "/tmp/ion-os-v1-ui-inventory.json",
);
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      scope:
        "Static inventory only; real execution evidence is recorded separately",
      pages: (await files(join(root, "app")))
        .filter((p) => p.endsWith("/page.tsx"))
        .map((p) => p.slice(root.length + 1)),
      controls: inventory,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    pages: (await files(join(root, "app"))).filter((p) =>
      p.endsWith("/page.tsx"),
    ).length,
    controls: inventory.length,
    output,
  }),
);
