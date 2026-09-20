const SUPPORTED_PRODUCTS = ["engram"] as const;

/** Validates `forge614-shell init --product <name>` arguments; throws a clear error otherwise. */
export function requireEngramProduct(args: string[]): void {
  const index = args.indexOf("--product");
  if (index === -1 || !args[index + 1]) {
    throw new Error("forge614-shell init requires --product <name>.");
  }
  const product = args[index + 1]!;
  const remaining = [...args];
  remaining.splice(index, 2);
  if (remaining.length) {
    throw new Error(`forge614-shell init does not accept: ${remaining.join(" ")}`);
  }
  if (!SUPPORTED_PRODUCTS.includes(product as (typeof SUPPORTED_PRODUCTS)[number])) {
    throw new Error(`forge614-shell init --product ${product} is not supported. Only "engram" is supported today.`);
  }
}
