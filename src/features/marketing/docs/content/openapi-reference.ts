/**
 * THE API REFERENCE, GENERATED FROM THE SPEC (P3). `buildApiReference(spec)` turns the parsed
 * `docs/specs/device-sdk/openapi.yaml` into one record per operation: method, path, auth, every
 * path / query / header parameter and every body field with its type and required flag, and the
 * response codes. `openapi-reference.generated.json` is its output, committed, and
 * `openapi-reference.test.ts` regenerates it from the YAML and fails on any difference, so a spec
 * change that is not regenerated cannot ship. Regenerate:
 *
 *   UPDATE_API_REFERENCE=1 npx vitest run src/features/marketing/docs/content/openapi-reference.test.ts
 *
 * STRUCTURE comes from here and only here. The pages (`pages-api.ts`) add prose per parameter
 * name, examples and notes; the test also fails when that prose names a parameter the spec does
 * not have, or a generated parameter has no description from either side.
 *
 * Pure and dependency free: the caller parses the YAML.
 */

export interface RefParam {
  name: string;
  in: "path" | "query" | "header" | "body";
  /** Rendered type: `string`, `integer`, `string | null`, `DeviceKind`, `CapabilityScope[]` … */
  type: string;
  required: boolean;
  /** The spec's own description, if it has one. Pages may override it per name. */
  description: string | null;
}

export interface RefResponse {
  status: string;
  /** The success schema's name, or null (errors are the one `ErrorResponse`). */
  schema: string | null;
}

export interface RefOperation {
  operationId: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  tag: string;
  summary: string;
  /** `publishable` = also callable with a `pk_` key (the spec lists `publishableKey`). */
  auth: "secret" | "publishable";
  params: RefParam[];
  responses: RefResponse[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function refName(ref: string): string {
  return ref.split("/").pop() ?? ref;
}

function resolve(spec: Obj, node: unknown): Obj {
  if (isObj(node) && typeof node.$ref === "string") {
    const parts = node.$ref.replace(/^#\//, "").split("/");
    let cur: unknown = spec;
    for (const p of parts) cur = isObj(cur) ? cur[p] : undefined;
    if (!isObj(cur)) throw new Error(`openapi-reference: unresolved ${node.$ref}`);
    return cur;
  }
  if (!isObj(node)) throw new Error("openapi-reference: expected an object");
  return node;
}

/**
 * A schema's type as a reader sees it. A `$ref` to a scalar schema reads as that scalar (an enum of
 * up to 4 values as the values, a longer one as `string`); a `$ref` to an object reads as the
 * object's name.
 */
export function typeOf(schema: unknown, spec: Obj = {}): string {
  if (!isObj(schema)) return "any";
  if (typeof schema.$ref === "string") {
    let target: Obj | null = null;
    try {
      target = resolve(spec, schema);
    } catch {
      target = null;
    }
    const scalar = target && target.type !== "object" && !target.properties && (target.type === "string" || Array.isArray(target.oneOf));
    return scalar ? typeOf(target, spec) : refName(schema.$ref);
  }
  if (Array.isArray(schema.oneOf)) {
    return [...new Set(schema.oneOf.map((s) => typeOf(s, spec)))].join(" | ");
  }
  const t = schema.type;
  const one = (x: unknown): string => {
    if (x === "null") return "null";
    if (x === "array") {
      const item = typeOf(schema.items, spec);
      return item.includes(" | ") ? `(${item})[]` : `${item}[]`;
    }
    if (x === "string" && Array.isArray(schema.enum) && schema.enum.length <= 4) {
      return schema.enum.map((e) => JSON.stringify(e)).join(" | ");
    }
    return typeof x === "string" ? x : "any";
  };
  if (Array.isArray(t)) return t.map(one).join(" | ");
  return one(t ?? (schema.properties ? "object" : "any"));
}

function paramOf(spec: Obj, raw: unknown): RefParam {
  const p = resolve(spec, raw);
  const where = p.in;
  if (where !== "path" && where !== "query" && where !== "header") throw new Error(`openapi-reference: param in ${String(where)}`);
  const schema = isObj(p.schema) ? p.schema : {};
  return {
    name: String(p.name),
    in: where,
    type: typeOf(schema, spec),
    required: p.required === true,
    description: typeof p.description === "string" ? p.description.trim() : typeof schema.description === "string" ? schema.description.trim() : null,
  };
}

function bodyOf(spec: Obj, op: Obj): RefParam[] {
  const rb = op.requestBody;
  if (!isObj(rb)) return [];
  const content = isObj(rb.content) ? rb.content["application/json"] : undefined;
  if (!isObj(content)) return [];
  const schema = resolve(spec, content.schema);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const props = isObj(schema.properties) ? schema.properties : {};
  return Object.entries(props).map(([name, s]) => ({
    name,
    in: "body" as const,
    type: typeOf(s, spec),
    required: required.has(name),
    description: isObj(s) && typeof s.description === "string" ? s.description.trim() : null,
  }));
}

const METHODS = ["get", "post", "delete"] as const;

/** Every operation in path order, then method order. */
export function buildApiReference(spec: unknown): RefOperation[] {
  if (!isObj(spec) || !isObj(spec.paths)) throw new Error("openapi-reference: no paths");
  const root = spec;
  const out: RefOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!isObj(item)) continue;
    for (const m of METHODS) {
      const op = item[m];
      if (!isObj(op)) continue;
      const security = Array.isArray(op.security) ? op.security : [];
      const publishable = security.some((s) => isObj(s) && "publishableKey" in s);
      const responses = isObj(op.responses) ? op.responses : {};
      out.push({
        operationId: String(op.operationId),
        method: m.toUpperCase() as RefOperation["method"],
        path,
        tag: Array.isArray(op.tags) ? String(op.tags[0]) : "",
        summary: String(op.summary ?? ""),
        auth: publishable ? "publishable" : "secret",
        params: [
          ...(Array.isArray(op.parameters) ? op.parameters.map((p) => paramOf(root, p)) : []),
          ...bodyOf(root, op),
        ],
        responses: Object.entries(responses).map(([status, r]) => {
          const content = isObj(r) && isObj(r.content) ? r.content["application/json"] : undefined;
          const schema = isObj(content) && isObj(content.schema) && typeof content.schema.$ref === "string" ? refName(content.schema.$ref) : null;
          return { status, schema };
        }),
      });
    }
  }
  return out;
}
