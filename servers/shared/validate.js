// Checks a request body against its contract (contracts\v1\requests.json):
// the small part of JSON Schema those contracts use. Returns null when the
// value fits, or a short reason when it does not.
import contracts from "../contracts/v1/requests.json" with { type: "json" };

export function check(name, value) {
  const schema = contracts[name];
  if (!schema) {
    return `no contract named ${name}`;
  }
  return fits(schema, value, "body");
}

function fits(schema, value, where) {
  switch (schema.type) {
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return `${where} must be an object`;
      }
      for (const key of schema.required || []) {
        if (!(key in value)) {
          return `${where}.${key} is missing`;
        }
      }
      for (const [key, item] of Object.entries(value)) {
        const sub = (schema.properties || {})[key];
        if (!sub) {
          if (schema.additionalProperties === false) {
            return `${where}.${key} is not allowed`;
          }
          continue;
        }
        const reason = fits(sub, item, `${where}.${key}`);
        if (reason) {
          return reason;
        }
      }
      return null;
    }
    case "string":
      if (typeof value !== "string") {
        return `${where} must be text`;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `${where} is too long`;
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        return `${where} has the wrong form`;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return `${where} must be one of ${schema.enum.join(", ")}`;
      }
      return null;
    case "integer":
      return Number.isInteger(value) ? null : `${where} must be a whole number`;
    case "boolean":
      return typeof value === "boolean" ? null : `${where} must be true or false`;
    default:
      return `${where}: unknown type in contract`;
  }
}
