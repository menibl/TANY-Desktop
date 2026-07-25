import * as babelParser from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import type { SelectorKind, Step, StepType } from "@tany-desktop/shared";

interface ChainCall {
  name: string;
  args: unknown[];
  isProperty: boolean;
}

interface Chain {
  base: string | null;
  calls: ChainCall[];
}

function literalToValue(node: t.Node | null | undefined): unknown {
  if (!node) return undefined;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isObjectExpression(node)) {
    const obj: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        obj[prop.key.name] = literalToValue(prop.value as t.Node);
      }
    }
    return obj;
  }
  if (t.isRegExpLiteral(node)) return node.pattern;
  return "<expr>";
}

function unwindChain(node: t.Node): Chain {
  if (t.isIdentifier(node)) {
    return { base: node.name, calls: [] };
  }
  if (t.isCallExpression(node)) {
    const callee = node.callee;
    const args = node.arguments.map((a) => literalToValue(a as t.Node));
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      const inner = unwindChain(callee.object as t.Node);
      inner.calls.push({ name: callee.property.name, args, isProperty: false });
      return inner;
    }
    return { base: null, calls: [] };
  }
  if (t.isMemberExpression(node) && t.isIdentifier(node.property)) {
    const inner = unwindChain(node.object as t.Node);
    inner.calls.push({ name: node.property.name, args: [], isProperty: true });
    return inner;
  }
  return { base: null, calls: [] };
}

const LOCATOR_KIND: Record<string, SelectorKind> = {
  getByRole: "role",
  getByText: "text",
  getByLabel: "label",
  getByTestId: "testId",
  getByPlaceholder: "placeholder",
  getByAltText: "altText",
  getByTitle: "title",
  locator: "css",
};

const ACTION_TYPE: Record<string, StepType> = {
  click: "click",
  dblclick: "click",
  hover: "click",
  check: "click",
  uncheck: "click",
  fill: "fill",
  type: "fill",
  press: "press",
  selectOption: "select",
  waitForSelector: "waitForSelector",
};

/**
 * Converts Playwright codegen's generated JS into our structured Step[].
 * This deliberately only understands the call shapes codegen actually
 * emits (page.goto / page.getByX(...).action(...) / page.keyboard.press) -
 * it is not a general-purpose Playwright script interpreter.
 */
export function parseCodegenScript(code: string): Step[] {
  const ast = babelParser.parse(code, { sourceType: "script" });
  const steps: Step[] = [];

  traverse(ast, {
    AwaitExpression(nodePath) {
      const arg = nodePath.node.argument;
      if (!t.isCallExpression(arg)) return;
      const chain = unwindChain(arg);
      if (chain.base !== "page" || chain.calls.length === 0) return;

      const action = chain.calls[chain.calls.length - 1];
      const locatorCalls = chain.calls.slice(0, -1);

      if (action.name === "goto" && locatorCalls.length === 0) {
        steps.push({ index: steps.length, type: "goto", url: String(action.args[0] ?? "") });
        return;
      }

      const stepType = ACTION_TYPE[action.name];
      if (!stepType) return; // unsupported/no-op action (e.g. waitForLoadState) - skip

      const step: Step = { index: steps.length, type: stepType };

      if (stepType === "press") {
        step.key = String(action.args[0] ?? "");
      } else if (stepType === "fill") {
        step.value = String(action.args[0] ?? "");
      } else if (stepType === "select") {
        step.value = String(action.args[0] ?? "");
      }

      // Find the locator-producing call closest to the action (last real
      // call, skipping bare property access like `.keyboard`).
      const locatorCall = [...locatorCalls].reverse().find((c) => !c.isProperty);
      if (locatorCall && LOCATOR_KIND[locatorCall.name]) {
        step.selectorKind = LOCATOR_KIND[locatorCall.name];
        if (locatorCall.name === "getByRole") {
          step.role = String(locatorCall.args[0] ?? "");
          const opts = locatorCall.args[1] as { name?: string } | undefined;
          if (opts?.name) step.name = opts.name;
        } else {
          step.selector = String(locatorCall.args[0] ?? "");
        }
      }

      steps.push(step);
    },
  });

  return steps;
}
