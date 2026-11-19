import assert from "node:assert/strict";
import { chooseRouting } from "./provider_routing_service.ts";

const courseTenant = { capability: "image", excludedProvider: "vendor-a" };
assert.deepEqual(chooseRouting(courseTenant), { capability: "image", exclude: "vendor-a" });
assert.deepEqual(chooseRouting({ capability: "email" }), { capability: "email" });
console.log("routing decision test passed");
