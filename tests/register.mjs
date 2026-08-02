/** Registers the resolver hook (see resolver.mjs) for `node --test`. */
import { register } from "node:module";
register("./resolver.mjs", import.meta.url);
