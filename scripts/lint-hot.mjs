import fs from "node:fs";
import path from "node:path";
import ts from "typescript5";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src");

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.name.endsWith(".hot.ts")) out.push(full);
  }
  return out;
}

const BANNED_NODES = new Map([
  [ts.SyntaxKind.ObjectLiteralExpression, "object literal"],
  [ts.SyntaxKind.ArrayLiteralExpression, "array literal"],
  [ts.SyntaxKind.NewExpression, "new expression"],
  [ts.SyntaxKind.ArrowFunction, "arrow function closure"],
  [ts.SyntaxKind.FunctionExpression, "function expression closure"],
  [ts.SyntaxKind.ClassExpression, "class expression"],
  [ts.SyntaxKind.TemplateExpression, "template string"],
  [ts.SyntaxKind.TaggedTemplateExpression, "tagged template string"],
  [ts.SyntaxKind.SpreadElement, "spread"],
  [ts.SyntaxKind.RegularExpressionLiteral, "regular expression"],
  [ts.SyntaxKind.ForOfStatement, "for-of iterator"],
]);

const BANNED_CALLS = new Set([
  "map",
  "filter",
  "slice",
  "splice",
  "concat",
  "flat",
  "flatMap",
  "sort",
  "reverse",
  "push",
  "pop",
  "shift",
  "unshift",
  "Array.from",
  "Array.of",
  "Object.assign",
  "Object.create",
  "Object.keys",
  "Object.values",
  "Object.entries",
  "JSON.parse",
  "JSON.stringify",
  "structuredClone",
]);

const files = filesUnder(src);
let failures = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const report = (node, message) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    const relative = path.relative(root, file);
    console.error(`${relative}:${position.line + 1}:${position.character + 1} hot path ${message}`);
    failures += 1;
  };

  const visit = (node) => {
    const banned = BANNED_NODES.get(node.kind);
    if (banned) report(node, `cannot allocate: ${banned}`);
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression) && BANNED_CALLS.has(expression.name.text)) {
        report(node, `cannot call allocating method .${expression.name.text}()`);
      }
      const text = expression.getText(source);
      if (BANNED_CALLS.has(text)) report(node, `cannot call allocating function ${text}()`);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
}

if (failures > 0) {
  console.error(`\n${failures} hot-path allocation violation(s).`);
  process.exit(1);
}
console.log(`hot-path lint passed: ${files.length} files`);
