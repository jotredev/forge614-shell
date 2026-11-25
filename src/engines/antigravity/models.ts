import type { NativeModel } from "../types.ts";

/** Reasoning effort levels Antigravity CLI supports (`--effort` / ACP `thought_level`). */
export const ANTIGRAVITY_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const EFFORT_SET = new Set<string>(ANTIGRAVITY_EFFORTS);

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

const ACRONYMS: Record<string, string> = {
  gpt: "GPT",
  oss: "OSS",
  pro: "Pro",
  flash: "Flash",
  lite: "Lite",
  mini: "Mini",
};

/**
 * Turns a raw technical Antigravity model slug into a readable display label when the catalog has
 * no explicit friendly name (for example: `"gemini-4-neon-high"` → `"Gemini 4 Neon (High)"`,
 * `"claude-sonnet-5-5"` → `"Claude Sonnet 5.5"`, `"gpt-oss-120b-medium"` → `"GPT-OSS 120B (Medium)"`).
 * Never overrides a friendly name reported by Antigravity itself.
 */
export function prettifyAntigravityModelId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return id;
  const parts = trimmed.split("-").filter(Boolean);
  if (!parts.length) return trimmed;
  let effortSuffix: string | undefined;
  const last = parts[parts.length - 1]!.toLowerCase();
  if (parts.length > 1 && EFFORT_SET.has(last)) {
    effortSuffix = EFFORT_LABELS[last] ?? last;
    parts.pop();
  }
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const lower = part.toLowerCase();
    // Collapse consecutive single-number version parts like `claude-opus-5-5` → `5.5`.
    if (/^\d+$/.test(part) && i + 1 < parts.length && /^\d+$/.test(parts[i + 1]!)) {
      tokens.push(`${part}.${parts[i + 1]!}`);
      i++;
      continue;
    }
    if (/^\d+[a-z]$/i.test(part)) {
      tokens.push(part.toUpperCase());
      continue;
    }
    if (ACRONYMS[lower]) {
      tokens.push(ACRONYMS[lower]!);
      continue;
    }
    if (/^\d/.test(part)) {
      tokens.push(part);
      continue;
    }
    tokens.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  const base = tokens.join(" ").replace(/\bGPT OSS\b/g, "GPT-OSS");
  return effortSuffix ? `${base} (${effortSuffix})` : base;
}

/** Splits an effort-suffixed model slug (e.g. `"gemini-3.8-flash-high"`) into its base slug and effort. */
export function splitModelEffort(modelId: string): { base: string; effort?: string } {
  const match = modelId.match(/^(.+)-(low|medium|high|xhigh|max)$/i);
  if (!match) return { base: modelId };
  return { base: match[1]!, effort: match[2]!.toLowerCase() };
}

/** Strips a trailing parenthesized effort suffix (`"Gemini 4 Neon (High)"` → `"Gemini 4 Neon"`). */
function stripEffortLabel(name: string): string {
  return name.replace(/\s*\((Low|Medium|High|XHigh|Extra|Max)\)\s*$/i, "").trim();
}

export interface AcpModelEntry {
  modelId?: unknown;
  name?: unknown;
}

export interface AcpConfigOption {
  id?: unknown;
  category?: unknown;
  currentValue?: unknown;
  options?: unknown;
}

export interface ParsedAntigravityCatalog {
  /** Base models shown in Shell's `/model` picker, each with its valid `efforts` (empty when fixed). */
  models: NativeModel[];
  /** Currently active base model id (matches a row in `models`). */
  currentModel?: string;
  /** Currently active thinking/reasoning effort (`low|medium|high|xhigh|max`), or undefined when fixed/unreported. */
  currentEffort?: string;
  /** Valid thinking/reasoning efforts for the currently active model (from `thought_level` configOption or variants). */
  currentEfforts: string[];
  /** Friendly display names keyed by both base model id and full variant `modelId`. */
  displayNames: Map<string, string>;
  /** Full variant `modelId`s reported by `models.availableModels`, for direct `/model <slug>` lookups. */
  variantIds: Set<string>;
}

interface ConfigSelectItem { value: string; name?: string }

function readSelectOptions(option: AcpConfigOption | undefined): ConfigSelectItem[] {
  if (!option || !Array.isArray(option.options)) return [];
  return option.options.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { value?: unknown; name?: unknown };
    if (typeof record.value !== "string" || !record.value) return [];
    return [{ value: record.value, ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim() } : {}) }];
  });
}

function findConfigOption(configOptions: unknown, id: string): AcpConfigOption | undefined {
  if (!Array.isArray(configOptions)) return undefined;
  return configOptions.find((entry): entry is AcpConfigOption =>
    Boolean(entry && typeof entry === "object" && ((entry as AcpConfigOption).id === id || (entry as AcpConfigOption).category === id)),
  );
}

/**
 * Builds Shell's model catalog from ACP's `models` and `configOptions` payloads.
 *
 * When `configOptions` includes the `model` select list, Shell uses those base ids (so `/model`
 * lists each family once and pairs it with only the efforts that model actually supports, avoiding
 * conflicting slug+effort combinations). Fixed-effort models whose id already encodes its single
 * effort (e.g. `gpt-oss-120b-medium`) or orchestrator presets get an empty `efforts` list so Shell
 * never sends a conflicting `thought_level`.
 */
export function parseAntigravityCatalog(
  modelsPayload: { availableModels?: unknown; currentModelId?: unknown } | undefined,
  configOptions?: unknown,
): ParsedAntigravityCatalog {
  const displayNames = new Map<string, string>();
  const variantIds = new Set<string>();
  const variantsByBase = new Map<string, { efforts: string[]; firstEffort?: string; friendlyBase?: string }>();

  const available = Array.isArray(modelsPayload?.availableModels) ? modelsPayload!.availableModels as AcpModelEntry[] : [];
  for (const entry of available) {
    if (!entry || typeof entry !== "object" || typeof entry.modelId !== "string" || !entry.modelId) continue;
    const modelId = entry.modelId;
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : prettifyAntigravityModelId(modelId);
    variantIds.add(modelId);
    displayNames.set(modelId, name);
    const { base, effort } = splitModelEffort(modelId);
    if (effort) {
      let bucket = variantsByBase.get(base);
      if (!bucket) { bucket = { efforts: [], firstEffort: effort, friendlyBase: stripEffortLabel(name) }; variantsByBase.set(base, bucket); }
      if (!bucket.efforts.includes(effort)) bucket.efforts.push(effort);
    }
  }

  const modelConfig = findConfigOption(configOptions, "model");
  const effortConfig = findConfigOption(configOptions, "thought_level");
  const modelOptions = readSelectOptions(modelConfig);
  const activeEffortOptions = readSelectOptions(effortConfig).map(item => item.value).filter(value => EFFORT_SET.has(value));

  const rawCurrentModelId = typeof modelsPayload?.currentModelId === "string" ? modelsPayload.currentModelId : undefined;
  let currentModel = typeof modelConfig?.currentValue === "string" && modelConfig.currentValue ? modelConfig.currentValue : undefined;
  let currentEffort = typeof effortConfig?.currentValue === "string" && effortConfig.currentValue ? effortConfig.currentValue : undefined;

  const models: NativeModel[] = [];

  if (modelOptions.length > 0) {
    for (const option of modelOptions) {
      const id = option.value;
      const name = option.name && option.name !== id ? option.name : prettifyAntigravityModelId(id);
      displayNames.set(id, name);
      const isCurrent = id === currentModel;
      const bucket = variantsByBase.get(id);
      // A slug that already ends with an effort (e.g. `gpt-oss-120b-medium`) is a fixed variant, not a family.
      const fixedSlug = splitModelEffort(id).effort !== undefined;
      const efforts = fixedSlug
        ? []
        : isCurrent && activeEffortOptions.length > 0
          ? activeEffortOptions
          : bucket ? sortEfforts(bucket.efforts) : [];
      const defaultEffort = isCurrent && currentEffort && efforts.includes(currentEffort)
        ? currentEffort
        : bucket?.firstEffort && efforts.includes(bucket.firstEffort) ? bucket.firstEffort : efforts[0];
      models.push({ id, name, ...(efforts.length ? { efforts } : {}), ...(defaultEffort ? { defaultEffort } : {}) });
    }
  } else if (available.length > 0) {
    // Fallback when an ACP server reports only `models.availableModels` without `configOptions`.
    const seen = new Set<string>();
    for (const entry of available) {
      if (!entry || typeof entry !== "object" || typeof entry.modelId !== "string" || !entry.modelId) continue;
      const { base, effort } = splitModelEffort(entry.modelId);
      const bucket = effort ? variantsByBase.get(base) : undefined;
      if (bucket && bucket.efforts.length > 1) {
        if (seen.has(base)) continue;
        seen.add(base);
        const name = bucket.friendlyBase || prettifyAntigravityModelId(base);
        displayNames.set(base, name);
        const efforts = sortEfforts(bucket.efforts);
        models.push({ id: base, name, efforts, ...(bucket.firstEffort ? { defaultEffort: bucket.firstEffort } : {}) });
      } else {
        if (seen.has(entry.modelId)) continue;
        seen.add(entry.modelId);
        const name = displayNames.get(entry.modelId) ?? prettifyAntigravityModelId(entry.modelId);
        models.push({ id: entry.modelId, name });
      }
    }
  }

  if (!currentModel && rawCurrentModelId) {
    const { base, effort } = splitModelEffort(rawCurrentModelId);
    if (models.some(model => model.id === base)) {
      currentModel = base;
      if (!currentEffort && effort) currentEffort = effort;
    } else {
      currentModel = rawCurrentModelId;
    }
  }

  const activeModelEntry = currentModel ? models.find(model => model.id === currentModel) : undefined;
  const currentEfforts = activeEffortOptions.length > 0
    ? activeEffortOptions
    : activeModelEntry?.efforts ?? [];

  if (currentModel && !displayNames.has(currentModel)) {
    displayNames.set(currentModel, prettifyAntigravityModelId(currentModel));
  }

  return {
    models,
    ...(currentModel ? { currentModel } : {}),
    ...(currentEffort ? { currentEffort } : {}),
    currentEfforts,
    displayNames,
    variantIds,
  };
}

/** Resolves a model id to its friendly name, falling back to `prettifyAntigravityModelId` — never returning a raw technical slug when a friendly label can be built. */
export function resolveAntigravityModelDisplay(catalog: Pick<ParsedAntigravityCatalog, "models" | "displayNames">, modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  return catalog.models.find(model => model.id === modelId)?.name
    ?? catalog.displayNames.get(modelId)
    ?? prettifyAntigravityModelId(modelId);
}

/**
 * Parses plain-text output from `agy models` (`<slug>   <Friendly Name>` per line) into the same
 * grouped `NativeModel[]` structure. Exported as a pure helper for CLI catalog parsing and tests.
 */
export function parseAgyModelsCliOutput(stdout: string): NativeModel[] {
  const availableModels: AcpModelEntry[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    availableModels.push({ modelId: match[1]!, name: match[2]!.trim() });
  }
  return parseAntigravityCatalog({ availableModels }).models;
}

function sortEfforts(efforts: string[]): string[] {
  const order = new Map<string, number>(ANTIGRAVITY_EFFORTS.map((level, index) => [level, index]));
  return [...efforts].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}
