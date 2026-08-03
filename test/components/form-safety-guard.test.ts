/**
 * Structural guard: the "I press the button and nothing happens" bug class.
 *
 * This exact class has now reached the operator FOUR times, each time in a
 * different form, each time fixed at the instance:
 *
 *   1. A `required` control inside a CSS-HIDDEN (not unmounted) step. The
 *      browser's validator scans it, tries to focus an invisible input, and
 *      most browsers swallow the click. Nothing happens, no error.
 *      Fixed with noValidate / formNoValidate.
 *   2. React 19 resets UNCONTROLLED fields once a `<form action={fn}>`
 *      action settles — including when the action early-returns without
 *      doing anything. A validation bounce wiped a filled agreement.
 *      Fixed by converting to controlled state.
 *   3. A dispatch after an `await` fell outside React's transition, so
 *      isPending never flipped and the button sat there looking dead.
 *   4. Three more instances of (2): quick booking, feedback, add-site.
 *
 * Fixing instances has not stopped it recurring, so this is the check.
 * It reads the SOURCE and parses it with the TypeScript compiler, because
 * the risk is a NEW form written next month, which no behavioural test on
 * any existing component would ever notice.
 *
 * Why a test and not an ESLint rule — see the file's own README block at
 * the bottom of this comment:
 *
 *   - The dangerous pattern crosses FILES. `add-site-form.tsx` owns the
 *     `<form action>`; the fields it would have got wrong live in
 *     `site-form-fields.tsx`. An ESLint rule sees one file at a time and
 *     would have missed exactly the instance we shipped. This walks the
 *     component graph.
 *   - The repo already has two structural guards of this shape
 *     (no-invoice-creation-path, no-invoice-surface), so this is the
 *     idiom people here already read.
 *   - `npm run lint` currently reports 60+ warnings and does not fail on
 *     them. A new rule would have to be an error to bite; the test suite
 *     is what actually gates.
 *   - No new dependency: typescript is already here, and parsing a real
 *     AST beats regex for something meant to be trusted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];

// ─── Deliberate exceptions ──────────────────────────────────────────
//
// Visible, not silent. Every entry needs a real reason; the test below
// fails on an empty one AND on a STALE one, so this list cannot rot into
// a graveyard of things nobody re-checked.

interface Exception {
  /** Repo-relative file the control lives in. */
  file: string;
  /** The control, as `<tag name=…>` or the attribute that trips the check. */
  control: string;
  /** Why this one is genuinely fine. Required. */
  reason: string;
}

const UNCONTROLLED_ALLOWED: Exception[] = [
  // The audit that found the other three instances (quick booking,
  // feedback, add-site) looked at these two and deliberately left them.
  // Recording that decision here rather than in a chat log is the point of
  // this list: the next person sees the call and its reasoning, and if they
  // disagree they can delete the entry and fix it.
  {
    file: "components/settings/change-password-form.tsx",
    control: "<input name=current_password type=password>",
    reason:
      "Password fields clearing on a failed submit is the behaviour you " +
      "want, not a bug: a half-typed or mistyped password should not sit " +
      "in the box, and password managers re-fill on demand.",
  },
  {
    file: "components/settings/change-password-form.tsx",
    control: "<input name=new_password type=password>",
    reason:
      "Same as current_password: a reset here is correct, and re-entry is " +
      "the safe default for a credential the operator got wrong.",
  },
  {
    file: "components/settings/change-password-form.tsx",
    control: "<input name=confirm_password type=password>",
    reason:
      "Same as current_password. Keeping a stale confirmation around after " +
      "a failure would be worse than clearing it.",
  },
  {
    file: "components/settings/invite-user-form.tsx",
    control: "<input name=email type=email>",
    reason:
      "One short email on an occasional admin path. Blast radius is a " +
      "retype, not lost field work, so it was consciously not converted.",
  },
  {
    file: "components/settings/invite-user-form.tsx",
    control: "<input name=full_name type=text>",
    reason:
      "Optional name beside the invite email, same occasional admin path " +
      "and the same one-retype cost.",
  },
];

const HIDDEN_REQUIRED_ALLOWED: Exception[] = [
  // (empty — the two multi-step forms both carry noValidate.)
];

// ─── Source loading ─────────────────────────────────────────────────

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".tsx")) out.push(full);
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return out;
}

const rel = (f: string) => f.slice(ROOT.length + 1);

const parsed = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
  const cached = parsed.get(file);
  if (cached) return cached;
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX
  );
  parsed.set(file, sf);
  return sf;
}

/** Resolve an `@/…` import to a real file on disk, or null for packages. */
function resolveImport(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = join(ROOT, spec.slice(2));
  for (const ext of [".tsx", ".ts"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/** localName → file, for every `@/…` import in a file. */
function importMap(sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const target = resolveImport(stmt.moduleSpecifier.text);
    if (!target) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) map.set(el.name.text, target);
    }
    if (stmt.importClause?.name) {
      map.set(stmt.importClause.name.text, target);
    }
  }
  return map;
}

// ─── JSX helpers ────────────────────────────────────────────────────

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function tagName(el: Opening, sf: ts.SourceFile): string {
  return el.tagName.getText(sf);
}

function attr(el: Opening, name: string): ts.JsxAttribute | undefined {
  for (const p of el.attributes.properties) {
    if (ts.isJsxAttribute(p) && p.name.getText() === name) return p;
  }
  return undefined;
}

function hasAttr(el: Opening, name: string): boolean {
  return attr(el, name) !== undefined;
}

/** Source text of an attribute's value, or "" for a bare boolean attr. */
function attrText(el: Opening, name: string, sf: ts.SourceFile): string {
  const a = attr(el, name);
  if (!a || !a.initializer) return "";
  return a.initializer.getText(sf);
}

/** Walk every JSX opening element under a node, in order. */
function eachElement(
  node: ts.Node,
  sf: ts.SourceFile,
  visit: (el: Opening) => void
) {
  const walk = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) visit(n);
    ts.forEachChild(n, walk);
  };
  walk(node);
}

/** The declaration of a component by name, for scanning its own JSX. */
function findComponent(sf: ts.SourceFile, name: string): ts.Node | null {
  let found: ts.Node | null = null;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      found = n;
      return;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return found;
}

// ─── The form controls in scope of a <form>, across files ───────────

interface Control {
  tag: string;
  file: string;
  line: number;
  el: Opening;
  sf: ts.SourceFile;
  /** True when this control sits inside a CSS-hidden region. */
  hidden: boolean;
}

/**
 * Is this element a region hidden by a className rather than unmounted?
 *
 * The shape both multi-step forms use is
 * `className={step === 1 ? "space-y-5" : "hidden"}` — a conditional whose
 * false branch is the bare Tailwind `hidden`. A static className that
 * merely contains the word (responsive `md:flex hidden` chrome) is not a
 * conditionally-hidden form step and must not trip this.
 */
function isCssHiddenRegion(el: Opening, sf: ts.SourceFile): boolean {
  const a = attr(el, "className");
  if (!a?.initializer) return false;
  if (!ts.isJsxExpression(a.initializer)) return false; // static string
  const text = a.initializer.getText(sf);
  return /["'`]\s*hidden\s*["'`]/.test(text) || /\shidden["'`]/.test(text);
}

const FIELD_TAGS = new Set(["input", "textarea", "select"]);

/**
 * Collect every form control reachable from `root`, following custom
 * components into their own files so a shared field-set is not a blind
 * spot (this is the case an ESLint rule cannot see).
 */
function collectControls(
  root: ts.Node,
  sf: ts.SourceFile,
  file: string,
  visited: Set<string>,
  hiddenDepth = 0
): Control[] {
  const out: Control[] = [];
  const imports = importMap(sf);

  const walk = (n: ts.Node, hidden: number) => {
    let nextHidden = hidden;
    // Check hidden-ness on the JsxElement, using its opening tag. Checking
    // the JsxOpeningElement itself does NOT work: in the AST the opening
    // tag is a SIBLING of the element's JSX children, so the flag would
    // only ever reach the tag's own attributes and never the fields
    // inside the region. (Caught by the deliberate-violation proof —
    // pattern B was passing vacuously until this was fixed.)
    if (ts.isJsxElement(n) && isCssHiddenRegion(n.openingElement, sf)) {
      nextHidden = hidden + 1;
    }

    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = tagName(n, sf);
      if (FIELD_TAGS.has(tag)) {
        out.push({
          tag,
          file,
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          el: n,
          sf,
          hidden: nextHidden > 0,
        });
      } else if (/^[A-Z]/.test(tag)) {
        // A custom component. Follow it into its own file once.
        const target = imports.get(tag.split(".")[0]);
        const key = `${target}#${tag}`;
        if (target && !visited.has(key)) {
          visited.add(key);
          const childSf = parse(target);
          const decl = findComponent(childSf, tag);
          if (decl) {
            out.push(
              ...collectControls(decl, childSf, target, visited, nextHidden)
            );
          }
        }
      }
    }

    ts.forEachChild(n, (c) => walk(c, nextHidden));
  };

  walk(root, hiddenDepth);
  return out;
}

// ─── Findings ───────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  control: string;
  detail: string;
}

function describeControl(c: Control): string {
  const name = attrText(c.el, "name", c.sf).replace(/["'{}]/g, "");
  const type = attrText(c.el, "type", c.sf).replace(/["'{}]/g, "");
  return `<${c.tag}${name ? ` name=${name}` : ""}${type ? ` type=${type}` : ""}>`;
}

/** Controls React cannot control, or that carry no user data. */
function isExemptControl(c: Control): boolean {
  const type = attrText(c.el, "type", c.sf).replace(/["'{}]/g, "");
  // A file input's value is read-only in the DOM; it cannot be controlled.
  if (type === "file") return true;
  // Buttons carry no value to lose.
  if (["submit", "button", "reset"].includes(type)) return true;
  return false;
}

const uncontrolledFindings: Finding[] = [];
const hiddenRequiredFindings: Finding[] = [];

// Non-vacuity counters. A guard that silently stops finding anything
// passes for the wrong reason — pattern B did exactly that until the
// deliberate-violation proof caught it, so both walks now count what they
// actually saw and the tests below assert the counts are still sane.
let actionFormControlCount = 0;
let hiddenControlCount = 0;

for (const file of sourceFiles()) {
  const sf = parse(file);

  eachElement(sf, sf, (el) => {
    if (tagName(el, sf) !== "form") return;

    const formNode = ts.isJsxOpeningElement(el) ? el.parent : el;
    const controls = collectControls(formNode, sf, file, new Set());

    // ── A: uncontrolled fields in a <form action={…}> ──
    const actionAttr = attr(el, "action");
    const isActionForm =
      actionAttr !== undefined &&
      actionAttr.initializer !== undefined &&
      ts.isJsxExpression(actionAttr.initializer);

    if (isActionForm) {
      actionFormControlCount += controls.length;
      for (const c of controls) {
        if (isExemptControl(c)) continue;
        const hasDefault =
          hasAttr(c.el, "defaultValue") || hasAttr(c.el, "defaultChecked");
        const hasBinding = hasAttr(c.el, "value") || hasAttr(c.el, "checked");
        const named = hasAttr(c.el, "name");
        if (hasDefault) {
          uncontrolledFindings.push({
            file: rel(c.file),
            line: c.line,
            control: describeControl(c),
            detail: "uses defaultValue/defaultChecked",
          });
        } else if (named && !hasBinding) {
          uncontrolledFindings.push({
            file: rel(c.file),
            line: c.line,
            control: describeControl(c),
            detail: "is a bare named field with no value/checked binding",
          });
        }
      }
    }

    // ── B: required inside a CSS-hidden region, no validation opt-out ──
    const formOptsOut =
      hasAttr(el, "noValidate") ||
      // Every submit control in the form opting out counts too.
      (() => {
        const submits: Opening[] = [];
        eachElement(formNode, sf, (n) => {
          const t = tagName(n, sf);
          if (t === "button" || t === "input") {
            const type = attrText(n, "type", sf).replace(/["'{}]/g, "");
            if (type === "submit") submits.push(n);
          }
        });
        return (
          submits.length > 0 &&
          submits.every((s) => hasAttr(s, "formNoValidate"))
        );
      })();

    hiddenControlCount += controls.filter((c) => c.hidden).length;
    if (!formOptsOut) {
      const CONSTRAINTS = [
        "required",
        "pattern",
        "min",
        "max",
        "minLength",
        "maxLength",
      ];
      for (const c of controls) {
        if (!c.hidden) continue;
        const tripped = CONSTRAINTS.filter((k) => hasAttr(c.el, k));
        if (tripped.length > 0) {
          hiddenRequiredFindings.push({
            file: rel(c.file),
            line: c.line,
            control: describeControl(c),
            detail: `carries ${tripped.join("/")} inside a CSS-hidden region`,
          });
        }
      }
    }
  });
}

// ─── Reporting ──────────────────────────────────────────────────────

function matches(f: Finding, e: Exception): boolean {
  return f.file === e.file && f.control === e.control;
}

function unallowed(findings: Finding[], list: Exception[]): Finding[] {
  return findings.filter((f) => !list.some((e) => matches(f, e)));
}

function report(findings: Finding[], guidance: string): string {
  const lines = findings.map(
    (f) => `  ${f.file}:${f.line}  ${f.control}  ${f.detail}`
  );
  return `\n${lines.join("\n")}\n\n${guidance}\n`;
}

const CONTROLLED_GUIDANCE = `
WHY THIS FAILS
  React 19 resets UNCONTROLLED fields once a <form action={fn}> action
  settles — including when the action early-returns without dispatching
  anything. The operator gets an inline error AND loses everything they
  typed, in the same instant. This has shipped to the customer four times.

HOW TO FIX
  Hold each field in React state and pass value={…} / checked={…} with an
  onChange. The state survives the round trip; the DOM value does not.

  Reference: components/bookings/booking-modal.tsx (its header comment
  explains the failure), and components/sites/site-form-fields.tsx for a
  field-set shared between an action form and a plain onSubmit form.

IF IT IS GENUINELY FINE
  Add an entry to UNCONTROLLED_ALLOWED at the top of this file with a real
  reason. Exceptions are allowed; silent ones are not.`;

const HIDDEN_GUIDANCE = `
WHY THIS FAILS
  A constraint attribute on a control inside a region hidden with CSS
  (rather than unmounted) makes the browser's validator try to focus an
  invisible input on submit. Most browsers swallow the click silently:
  the button is dead and there is no error anywhere.

HOW TO FIX
  Either put noValidate on the <form> (or formNoValidate on every submit
  button) and validate in code, or unmount the region instead of hiding
  it, or drop the constraint attribute and enforce the rule in your
  validation schema.

  Reference: components/jobs/service-sheet-form.tsx (noValidate on the
  form, Zod as the source of truth) and
  components/agreements/add-agreement-form.tsx (formNoValidate on both
  submit buttons, with the trap documented inline).

IF IT IS GENUINELY FINE
  Add an entry to HIDDEN_REQUIRED_ALLOWED at the top of this file with a
  real reason.`;

describe("form safety guard: uncontrolled fields in an action form", () => {
  it("no <form action={…}> contains an uncontrolled field", () => {
    const bad = unallowed(uncontrolledFindings, UNCONTROLLED_ALLOWED);
    expect(
      bad.length,
      bad.length === 0 ? "" : report(bad, CONTROLLED_GUIDANCE)
    ).toBe(0);
  });

  it("actually inspected the action forms (the guard is not a no-op)", () => {
    // If the AST walk silently stopped finding forms, the assertion above
    // would pass vacuously. Floors are well under today's real numbers
    // (123 controls across 10+ action forms) so ordinary refactors do not
    // trip them, but a broken walk collapses to zero and fails here.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    const actionForms = files.filter((f) =>
      /<form[\s\S]{0,200}?action=\{/.test(readFileSync(f, "utf8"))
    );
    expect(actionForms.length).toBeGreaterThan(8);
    expect(
      actionFormControlCount,
      "the JSX walk found no controls inside any action form — it has gone " +
        "blind and every assertion above is passing for the wrong reason"
    ).toBeGreaterThan(60);
  });
});

describe("form safety guard: constraints inside CSS-hidden regions", () => {
  it("no constraint attribute hides behind CSS on a validating form", () => {
    const bad = unallowed(hiddenRequiredFindings, HIDDEN_REQUIRED_ALLOWED);
    expect(
      bad.length,
      bad.length === 0 ? "" : report(bad, HIDDEN_GUIDANCE)
    ).toBe(0);
  });

  it("still recognises the two multi-step forms it exists for", () => {
    // Both hide their steps with `hidden` rather than unmounting. If this
    // stops matching, the check above has gone blind and would pass for
    // the wrong reason.
    for (const f of [
      "components/jobs/service-sheet-form.tsx",
      "components/agreements/add-agreement-form.tsx",
    ]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} should still use CSS-hidden steps`).toMatch(
        /:\s*"hidden"/
      );
    }
    // And the walk must actually be MARKING controls as hidden. This is the
    // assertion that would have caught the propagation bug the deliberate-
    // violation proof found: hidden-ness was being read off the opening tag,
    // whose JSX children are siblings in the AST, so the flag never reached
    // a single field and pattern B matched nothing at all.
    expect(
      hiddenControlCount,
      "no control anywhere was marked as living inside a CSS-hidden region, " +
        "so the constraint check above cannot fire — the hidden-region walk " +
        "is broken, not the codebase clean"
    ).toBeGreaterThan(15);
  });
});

describe("form safety guard: the allowlists stay honest", () => {
  it("every exception carries a real reason", () => {
    for (const e of [...UNCONTROLLED_ALLOWED, ...HIDDEN_REQUIRED_ALLOWED]) {
      expect(
        e.reason.trim().length,
        `${e.file} ${e.control} needs a reason, not a blank`
      ).toBeGreaterThan(20);
    }
  });

  it("no allowlist entry is stale", () => {
    // An exception that no longer matches anything means the code was
    // fixed and nobody removed the licence. Fail so the list cannot rot.
    const stale = [
      ...UNCONTROLLED_ALLOWED.filter(
        (e) => !uncontrolledFindings.some((f) => matches(f, e))
      ),
      ...HIDDEN_REQUIRED_ALLOWED.filter(
        (e) => !hiddenRequiredFindings.some((f) => matches(f, e))
      ),
    ];
    expect(
      stale.length,
      stale.length === 0
        ? ""
        : `\nThese allowlist entries no longer match anything — the code was ` +
          `fixed. Delete them:\n${stale
            .map((e) => `  ${e.file}  ${e.control}`)
            .join("\n")}\n`
    ).toBe(0);
  });
});


/**
 * Bug class 3 (a dispatch after an `await` falling outside React's
 * transition, so isPending never fires) is NOT checked at the call sites,
 * deliberately.
 *
 * Detecting it there needs real control-flow analysis: which identifier is
 * the dispatcher, whether an await reaches this call on some path, and
 * whether the call is already inside a startTransition callback. A lexical
 * approximation is worse than nothing here — tried against the tree, the
 * only two files it flags are `add-agreement-form.tsx`, which is the
 * REFERENCE FIX (it awaits its document-readiness gate and then dispatches
 * inside startTransition), and `settings-actions.tsx`, where the await
 * belongs to an unrelated handler. A check whose only hits are false
 * positives on the correct pattern trains people to ignore it.
 *
 * So this guards the ROOT CAUSE instead, which is a single place and is
 * checkable exactly. `useLocalFirstAction` is the wrapper nearly every
 * mutating form dispatches through, and the reason a post-await dispatch
 * is safe today is that it opens its own transition SYNCHRONOUSLY when
 * called, rather than relying on the caller's. If someone moves that, the
 * hazard comes back everywhere at once and this fails.
 */
describe("form safety guard: the local-first wrapper owns its transition", () => {
  it("useLocalFirstAction opens the transition around the whole dispatch", () => {
    const src = readFileSync(join(ROOT, "lib/actions/wrap.ts"), "utf8");
    const start = src.indexOf("const wrappedDispatch");
    expect(start, "wrappedDispatch should still exist in wrap.ts").toBeGreaterThan(-1);
    const body = src.slice(start);

    const transitionAt = body.indexOf("startTransition(");
    const applyLocalAt = body.indexOf("meta.applyLocal(");
    const enqueueAt = body.indexOf("enqueueAction(");

    expect(
      transitionAt,
      "wrappedDispatch no longer opens a transition at all — every caller's " +
        "pending state (Completing…, Saving…) is dead again, which is the " +
        "exact 'I press the button and nothing happens' report"
    ).toBeGreaterThan(-1);

    for (const [name, at] of [
      ["applyLocal", applyLocalAt],
      ["enqueueAction", enqueueAt],
    ] as const) {
      expect(
        at > transitionAt,
        `${name} is called OUTSIDE the transition in useLocalFirstAction. ` +
          `isPending then covers only part of the work, so the button goes ` +
          `idle mid-operation. Keep the whole dispatch inside ` +
          `startTransition — see the note above wrappedDispatch in wrap.ts.`
      ).toBe(true);
    }
  });

  it("keeps the synchronous re-entry guard that stops a double-tap", () => {
    const src = readFileSync(join(ROOT, "lib/actions/wrap.ts"), "utf8");
    expect(
      src,
      "the inFlight ref is what stops a double-tap landing before React " +
        "re-renders the disabled button — on the create wrappers that means " +
        "two rows, because each dispatch mints fresh client ids"
    ).toContain("inFlightRef");
  });
});
